import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { MAX_PROMPT_CHARS, validateOutput } from "@/core/output-validator";
import { compilePrompt } from "@/core/prompt-compiler";
import { PrisonService } from "@/services/prison-service";
import { FilePrisonRepository } from "@/services/storage/file-repository";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const initialRequest = { trigger: "initial" as const, note: "", llmReview: false };
const invalidCases = [
  { label: "a prompt exceeding the character limit", text: "x".repeat(MAX_PROMPT_CHARS + 1), problem: "Prompt çok uzun" },
  { label: "an object serialization artifact", text: "[object Object]", problem: "serileştirme artığı" },
  { label: "an undefined list item", text: "undefined", problem: "serileştirme artığı" },
  { label: "an unresolved template placeholder", text: "{goal}", problem: "şablon alanı" },
];
const temporaryDirs: string[] = [];

afterEach(async () => {
  for (const dir of temporaryDirs.splice(0)) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir())) throw new Error("Unexpected test directory");
    await rm(dir, { recursive: true, force: true });
  }
});

async function analyzedPrison() {
  return runAnalysisPipeline({ rawRequest: "Add a payment system to the existing project", language: "en", targetAI: "gpt" }, null);
}

describe("normal prompt validation", () => {
  it.each(invalidCases)("rejects $label before marking an initial version ready", async ({ text, problem }) => {
    const prison = await analyzedPrison();
    prison.spec.requirements.push({ id: "req_invalid", text, source: "revision" });
    const original = structuredClone(prison);
    await expect(runCompilePipeline(prison, initialRequest, { provider: null })).rejects.toMatchObject({
      code: "validation_error",
      status: 422,
      detail: expect.stringContaining(problem),
    });
    expect(prison).toEqual(original);
    expect(prison.status).toBe("READY_FOR_COMPILE");
    expect(prison.promptVersions).toHaveLength(0);
    expect(prison.history.some((event) => event.to === "PROMPT_VALIDATED")).toBe(false);
  });

  it.each(invalidCases)("keeps the saved version when critic refinement introduces $label", async ({ text, problem }) => {
    const dir = await mkdtemp(path.join(tmpdir(), "prison-validation-test-"));
    temporaryDirs.push(dir);
    const repo = new FilePrisonRepository(dir);
    const analyzed = await analyzedPrison();
    if (text.length > MAX_PROMPT_CHARS) {
      analyzed.spec.requirements.push({ id: "req_baseline", text: `Existing detailed requirement: ${"b".repeat(12000)}`, source: "explicit" });
    }
    const ready = await runCompilePipeline(analyzed, initialRequest, { provider: null });
    expect(validateOutput(compilePrompt(toCompileInput(ready))).ok).toBe(true);
    await repo.save(ready);
    const file = path.join(dir, `${ready.id}.json`);
    const saved = await readFile(file, "utf8");
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", {
      prompt: "Inspect the existing project, implement the requested payment integration inside the preserved architecture, and verify the required outcomes before reporting the deliverables.",
      strategies_used: ["Task-Specific-Workflow"],
    }).enqueue("prison_critic", {
      ...CLEAN_CRITIC,
      issues: [{
        dimension: "output_clarity",
        severity: "high",
        message: "Add the missing requirement.",
        fix: {
          add: {
            requirements: text.length > MAX_PROMPT_CHARS
              ? Array.from({ length: 20 }, (_, index) => `Independent requirement${index}: ${String.fromCharCode(65 + index).repeat(1300)}`)
              : [text],
            constraints: [], protected_elements: [], disallowed_operations: [],
            success_criteria: [], assumptions: [], unknowns: [],
          },
          remove_item_ids: [],
        },
      }],
    });
    const service = new PrisonService(repo, provider);
    await expect(service.compile(ready.id)).rejects.toMatchObject({
      code: "validation_error",
      status: 422,
      detail: expect.stringContaining(problem),
    });
    expect(provider.callsFor("prison_critic")).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe(saved);
    expect(await service.get(ready.id)).toEqual(ready);
  });
});
