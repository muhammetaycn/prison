import { describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyModifier } from "@/core/prison-engine/modifiers";
import { compilePrompt } from "@/core/prompt-compiler";
import { resolveRequirements } from "@/core/requirement-resolver";
import { CompileOptionsSchema, DEFAULT_COMPILE_OPTIONS, type ExecutionContext } from "@/models/options";
import { PrisonSchema, summarizePrison, type Prison } from "@/models/prison";
import { PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";
import { paymentIntent } from "./helpers";

const CONTEXTS = ["chat", "mobile", "browser", "agent"] as const;
const OWNER_REQUEST = "Prepare a seven-day content plan. Return only a JSON array of seven objects with day and idea. Do not access any account or publish anything.";

class MemoryRepository implements PrisonRepository {
  private readonly records = new Map<string, Prison>();
  async list() { return [...this.records.values()].map(summarizePrison); }
  async get(id: string) { return structuredClone(this.records.get(id) ?? null); }
  async save(prison: Prison) { this.records.set(prison.id, PrisonSchema.parse(structuredClone(prison))); }
  async delete(id: string) { return this.records.delete(id); }
}

async function planningTask(executionContext: ExecutionContext = "chat", jailbreakMode = false) {
  const base = await runAnalysisPipeline({ rawRequest: OWNER_REQUEST, language: "en", targetAI: "gpt", executionContext, jailbreakMode }, null);
  const intent = paymentIntent({
    title: "Seven-day content plan",
    primary_goal: "Prepare a seven-day content plan",
    task_type: "writing",
    domain: "content planning",
    operation: "create_new",
    target_ai_mentioned: "gpt",
    existing_system: false,
    new_system: true,
    preserve_architecture: false,
    execution_required: false,
    coding_required: false,
    role: "a content planning specialist",
    expected_output: {
      format: "JSON only",
      description: "A JSON array of seven objects, each containing only day and idea",
      deliverables: ["A JSON array of seven objects, each containing only day and idea"],
    },
    explicit_requirements: ["Return only a JSON array of seven objects with day and idea"],
    implicit_requirements: [],
    constraints: ["Do not access any account", "Do not publish anything"],
    protected_elements: [],
    allowed_operations: [],
    disallowed_operations: ["Do not access any account", "Do not publish anything"],
    required_actions: ["Prepare a seven-day content plan"],
    assumptions: [],
    unknowns: [],
    success_conditions: ["The JSON array contains exactly seven objects with only day and idea"],
    execution_plan: null,
  });
  const { spec, itemSeq } = resolveRequirements({ intent, language: "en", itemSeq: 0 });
  return { ...base, intent, spec, itemSeq };
}

describe("execution environment fidelity", () => {
  it.each(CONTEXTS)("records %s during analysis without changing the selected AI or JB mode", async (executionContext) => {
    const prison = await runAnalysisPipeline({ rawRequest: OWNER_REQUEST, language: "en", targetAI: "claude", executionContext, councilMode: "collaboration", jailbreakMode: true }, null);
    expect(prison.compileOptions).toMatchObject({ executionContext, agentMode: executionContext === "agent", councilMode: "collaboration", jailbreakMode: true });
    expect(prison.targetAI).toBe("claude");
    expect(prison.rawRequest).toBe(OWNER_REQUEST);
  });

  it.each(CONTEXTS)("preserves the owner output and permission contract in %s", async (executionContext) => {
    const prison = await planningTask(executionContext);
    const original = structuredClone(prison);
    const compiled = compilePrompt(toCompileInput(prison));
    const baseline = compilePrompt(toCompileInput(await planningTask("chat")));
    expect(compiled.blocks.find((block) => block.id === "OUTPUT_CONTRACT")).toEqual(baseline.blocks.find((block) => block.id === "OUTPUT_CONTRACT"));
    expect(compiled.text).toContain("Return only a JSON array of seven objects with day and idea");
    expect(compiled.text).toContain("Do not access any account");
    expect(compiled.text).toContain("Do not publish anything");
    expect(prison.spec.allowedOperations).toEqual([]);
    expect(prison.spec.assumptions).toEqual([]);
    expect(prison).toEqual(original);
    const role = compiled.blocks.find((block) => block.id === "ROLE");
    expect(role?.notes?.join(" ")).toContain({ chat: "Chat environment", mobile: "Mobile chat", browser: "Browser AI", agent: "Agent environment" }[executionContext]);
    expect(role?.notes?.join(" ")).toMatch(executionContext === "agent" ? /only for owner-authorized work/ : /Do not assume/);
    if (executionContext !== "agent") expect(compiled.text).not.toContain("Keep going until the task is completely resolved");
  });

  it("migrates a legacy agent setting without silently relabeling it as ordinary chat", () => {
    const { executionContext: _context, councilMode: _mode, ...legacy } = DEFAULT_COMPILE_OPTIONS;
    expect(CompileOptionsSchema.parse({ ...legacy, agentMode: true })).toMatchObject({ executionContext: "agent", agentMode: true, councilMode: "single" });
    expect(CompileOptionsSchema.parse(legacy)).toMatchObject({ executionContext: "chat", agentMode: false });
    expect(CompileOptionsSchema.safeParse({ ...legacy, executionContext: "unrestricted" }).success).toBe(false);
  });

  it("keeps the agent button and context consistent without changing JB or team settings", () => {
    const initial = { ...DEFAULT_COMPILE_OPTIONS, executionContext: "browser" as const, councilMode: "collaboration" as const, jailbreakMode: true };
    const enabled = applyModifier(initial, "toggle_agent");
    expect(enabled).toEqual({ ...initial, executionContext: "agent", agentMode: true });
    const disabled = applyModifier(enabled, "toggle_agent");
    expect(disabled).toEqual({ ...initial, executionContext: "chat", agentMode: false });
  });

  it.each(CONTEXTS)("persists first compile selection %s and synchronizes the old agent flag", async (executionContext) => {
    const repo = new MemoryRepository();
    const created = await planningTask(executionContext === "agent" ? "mobile" : "agent");
    await repo.save(created);
    const service = new PrisonService(repo, null);
    const compiled = await service.compile(created.id, { executionContext, councilMode: "collaboration" });
    expect(compiled.compileOptions).toMatchObject({ executionContext, agentMode: executionContext === "agent", councilMode: "collaboration" });
    expect(compiled.promptVersions).toHaveLength(1);
    expect(compiled.promptVersions[0]!.options).toEqual(compiled.compileOptions);
    expect(compiled.promptVersions[0]!.councilReview).toBeNull();
    const reloaded = await service.get(created.id);
    expect(reloaded.compileOptions).toEqual(compiled.compileOptions);
    expect(reloaded.targetAI).toBe(created.targetAI);
    expect(reloaded.rawRequest).toBe(created.rawRequest);
  });

  it("changes environments across saved versions without leaking settings to another task", async () => {
    const repo = new MemoryRepository();
    const service = new PrisonService(repo, null);
    const created = await planningTask("agent", true);
    const other = await planningTask("mobile");
    await repo.save(created);
    await repo.save(other);
    let latest = await service.compile(created.id);
    const outputContract = latest.promptVersions[0]!.specSnapshot.expectedOutput;
    for (const executionContext of CONTEXTS) {
      latest = await service.adjust(created.id, { kind: "context", executionContext });
      const version = latest.promptVersions.at(-1)!;
      expect(version.options).toMatchObject({ executionContext, agentMode: executionContext === "agent", jailbreakMode: true });
      expect(version.specSnapshot.expectedOutput).toEqual(outputContract);
      expect(version.text).toContain("Do not publish anything");
    }
    expect(latest.promptVersions).toHaveLength(5);
    expect(await service.get(other.id)).toEqual(other);
    const restored = await service.restore(created.id, 2);
    expect(restored.compileOptions).toMatchObject({ executionContext: "chat", agentMode: false, jailbreakMode: true });
    expect(restored.promptVersions.at(-1)!.options).toEqual(restored.compileOptions);
  });

  it("rejects an invalid first compile environment without saving a changed version or options", async () => {
    const repo = new MemoryRepository();
    const created = await planningTask("agent");
    await repo.save(created);
    const service = new PrisonService(repo, null);
    await expect(service.compile(created.id, { executionContext: "unrestricted" as ExecutionContext })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await service.get(created.id)).toEqual(created);
    expect(await service.getProgress(created.id)).toBeNull();
  });
});
