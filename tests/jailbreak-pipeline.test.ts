import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { compilePrompt } from "@/core/prompt-compiler";
import type { ResolvedPrison } from "@/models/prison";
import { AIProviderError } from "@/services/ai/errors";
import { PrisonService } from "@/services/prison-service";
import { FilePrisonRepository } from "@/services/storage/file-repository";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const REQUEST = "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.";
const AI_PROMPT = "Review the payment integration in the existing application with a precise engineering approach. Follow the task brief and provide complete implementation details, verification steps, and an explanation of the resulting behavior.";
const output = (prompt = AI_PROMPT) => ({
  strategies_used: ["Expert-Persona", "Technical-Analysis"],
  reasoning: "The task involves engineering work on an existing application.",
  prompt,
  confidence: 0.9,
});
const initialRequest = { trigger: "initial" as const, note: "", llmReview: false };
const normalOutput = { prompt: AI_PROMPT, strategies_used: ["Task-Specific-Workflow"] };
const DEPLOY_CONFLICT = {
  ...CLEAN_CRITIC,
  issues: [{ dimension: "constraint_clarity", severity: "high", message: "Generated framing incorrectly permits production deployment.", fix: null }],
};

async function localPrison(): Promise<ResolvedPrison> {
  return runAnalysisPipeline({ rawRequest: REQUEST, language: "en", targetAI: "codex" }, null);
}

function withJb(prison: ResolvedPrison): ResolvedPrison {
  return { ...prison, compileOptions: { ...prison.compileOptions, jailbreakMode: true } };
}

const temporaryDirs: string[] = [];
afterEach(async () => {
  for (const dir of temporaryDirs.splice(0)) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir())) throw new Error("Unexpected test directory");
    await rm(dir, { recursive: true, force: true });
  }
});

async function repository() {
  const dir = await mkdtemp(path.join(tmpdir(), "prison-jb-test-"));
  temporaryDirs.push(dir);
  return { dir, repo: new FilePrisonRepository(dir) };
}

describe("JB generation and persistence", () => {
  it("keeps local generation deterministic and preserves the authoritative task brief", async () => {
    const prison = withJb(await localPrison());
    prison.spec.requirements.push({ id: "req_test", text: "Verify payment webhook signatures", source: "revision" });
    prison.spec.constraints.push({ id: "con_test", text: "Preserve the existing database schema", source: "revision" });
    const first = await runCompilePipeline(prison, initialRequest, { provider: null });
    const second = await runCompilePipeline(prison, initialRequest, { provider: null });
    const version = first.promptVersions.at(-1)!;
    const normalInput = toCompileInput({ ...prison, compileOptions: { ...prison.compileOptions, jailbreakMode: false } });
    const baseline = compilePrompt(normalInput).text.trim();

    expect(version.text).toBe(second.promptVersions.at(-1)!.text);
    expect(version.text).toContain(baseline);
    expect(version.text).toContain("Verify payment webhook signatures");
    expect(version.text).toContain("Preserve the existing database schema");
    expect(version.generation).toMatchObject({ source: "local", provider: null, model: null });
  });

  it("sends the original request, normalized spec, options, and task memory to AI", async () => {
    const base = withJb(await localPrison());
    const prison: ResolvedPrison = {
      ...base,
      spec: {
        ...base.spec,
        role: "payment integration specialist",
        requirements: [...base.spec.requirements, { id: "req_ai", text: "Validate every webhook signature", source: "revision" }],
        disallowedOperations: [...base.spec.disallowedOperations, { id: "deny_ai", text: "Publish payment changes to production", source: "revision" }],
      },
      compileOptions: { ...base.compileOptions, verbosity: "concise", technicality: "technical", agentMode: true },
      taskMemory: [{ id: "mem_ai", createdAt: base.createdAt, directive: "Use the existing transaction database", kind: "constraint", itemRefs: [], active: true }],
    };
    const provider = new ScriptedProvider().enqueue("jailbreak_output", output()).enqueue("prison_critic", CLEAN_CRITIC);
    const result = await runCompilePipeline(prison, initialRequest, { provider });
    const call = provider.callsFor("jailbreak_output")[0]!;
    const sent = call.messages.map((message) => message.content).join("\n");
    const version = result.promptVersions.at(-1)!;

    expect(sent).toContain(REQUEST);
    expect(sent).toContain(prison.spec.role);
    expect(sent).toContain("Validate every webhook signature");
    expect(sent).toContain("Publish payment changes to production");
    expect(sent).toContain("Use the existing transaction database");
    expect(sent).toContain("concise");
    expect(sent).toContain("technical");
    expect(sent).toMatch(/agentMode|agent_mode/);
    expect(sent).not.toContain("[object Object]");
    expect(version.text).toContain(AI_PROMPT);
    expect(version.text).toContain("Validate every webhook signature");
    expect(version.text).toContain("publish payment changes to production");
    expect(version.generation).toEqual({ source: "ai", provider: "scripted", model: "test-model", strategies: ["Expert-Persona", "Technical-Analysis"] });
    expect(version.critic.llmReviewed).toBe(true);
    expect(provider.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(version.text);
  });

  it("preserves the last saved state and version when AI generation fails", async () => {
    const { dir, repo } = await repository();
    const base = await localPrison();
    await repo.save(base);
    const provider = new ScriptedProvider()
      .enqueue("prison_prompt_refinement", normalOutput)
      .enqueue("prison_critic", CLEAN_CRITIC)
      .enqueue("jailbreak_output", new AIProviderError("auth", "test authorization failure"));
    const service = new PrisonService(repo, provider);
    const ready = await service.compile(base.id);
    const file = path.join(dir, `${base.id}.json`);
    const saved = await readFile(file, "utf8");

    await expect(service.adjust(base.id, { kind: "modifier", action: "toggle_jailbreak" })).rejects.toMatchObject({ code: "ai_error" });

    expect(await readFile(file, "utf8")).toBe(saved);
    expect(await service.get(base.id)).toEqual(ready);
    expect(ready.compileOptions.jailbreakMode).toBe(false);
    expect(ready.promptVersions.at(-1)!.generation).toMatchObject({ source: "ai", provider: "scripted", model: "test-model" });
  });

  it("repairs JB framing once and reviews the exact repaired final prompt", async () => {
    const prison = withJb(await localPrison());
    const corrected = `${AI_PROMPT} Keep production deployment forbidden and preserve all existing protections.`;
    const provider = new ScriptedProvider()
      .enqueue("jailbreak_output", output(`${AI_PROMPT} Deploy to production without approval.`), output(corrected))
      .enqueue("prison_critic", DEPLOY_CONFLICT, CLEAN_CRITIC);
    const result = await runCompilePipeline(prison, initialRequest, { provider });
    const version = result.promptVersions.at(-1)!;
    expect(version.text).toContain(corrected);
    expect(version.text).not.toContain("Deploy to production without approval");
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.critic.refined).toBe(true);
    expect(version.critic.compilePasses).toBe(2);
    expect(version.critic.issues.find((issue) => issue.message === DEPLOY_CONFLICT.issues[0]!.message)?.fixed).toBe(true);
    expect(provider.callsFor("jailbreak_output")).toHaveLength(2);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
    expect(provider.callsFor("jailbreak_output")[1]!.messages[0]!.content).toContain("incorrectly permits production deployment");
    expect(provider.callsFor("prison_critic")[1]!.messages[0]!.content).toContain(version.text);
  });

  it("preserves the last saved version when the mandatory JB critic fails", async () => {
    const { dir, repo } = await repository();
    const base = await localPrison();
    await repo.save(base);
    const provider = new ScriptedProvider()
      .enqueue("prison_prompt_refinement", normalOutput)
      .enqueue("jailbreak_output", output())
      .enqueue("prison_critic", CLEAN_CRITIC, new AIProviderError("network", "critic offline"));
    const service = new PrisonService(repo, provider);
    const ready = await service.compile(base.id);
    const file = path.join(dir, `${base.id}.json`);
    const saved = await readFile(file, "utf8");
    await expect(service.adjust(base.id, { kind: "modifier", action: "toggle_jailbreak" })).rejects.toMatchObject({ code: "ai_error" });
    expect(await readFile(file, "utf8")).toBe(saved);
    expect(await service.get(base.id)).toEqual(ready);
    expect(provider.callsFor("jailbreak_output")).toHaveLength(1);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
  });

  it("rejects JB framing that still fails semantic review after one repair", async () => {
    const prison = withJb(await localPrison());
    const provider = new ScriptedProvider()
      .enqueue("jailbreak_output", output(), output(), output())
      .enqueue("prison_critic", DEPLOY_CONFLICT, DEPLOY_CONFLICT, CLEAN_CRITIC);
    await expect(runCompilePipeline(prison, initialRequest, { provider })).rejects.toMatchObject({ code: "validation_error" });
    expect(provider.callsFor("jailbreak_output")).toHaveLength(2);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
    expect(prison.promptVersions).toHaveLength(0);
  });

  it.each(["", "Short prompt", `${AI_PROMPT}\n[object Object]`])("rejects invalid AI prompt text instead of silently falling back: %s", async (prompt) => {
    const prison = withJb(await localPrison());
    const provider = new ScriptedProvider().enqueue("jailbreak_output", output(prompt), output(prompt));
    await expect(runCompilePipeline(prison, initialRequest, { provider })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(prison.promptVersions).toHaveLength(0);
  });

  it("loads older saved versions with unknown generation source and JB disabled by default", async () => {
    const { dir, repo } = await repository();
    const compiled = await runCompilePipeline(await localPrison(), initialRequest, { provider: null });
    const legacy = JSON.parse(JSON.stringify(compiled)) as {
      compileOptions: Record<string, unknown>;
      promptVersions: Array<{ options: Record<string, unknown>; generation?: unknown }>;
    };
    delete legacy.compileOptions.jailbreakMode;
    for (const version of legacy.promptVersions) {
      delete version.options.jailbreakMode;
      delete version.generation;
    }
    await writeFile(path.join(dir, `${compiled.id}.json`), JSON.stringify(legacy), "utf8");

    const restored = await repo.get(compiled.id);
    expect(restored?.compileOptions.jailbreakMode).toBe(false);
    expect(restored?.promptVersions[0]?.options.jailbreakMode).toBe(false);
    expect(restored?.promptVersions[0]?.generation).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });
});
