import { describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import type { Prison } from "@/models/prison";
import type { PrisonRepository } from "@/services/storage/repository";
import { PrisonService } from "@/services/prison-service";
import type { CouncilDeps } from "@/services/ai/council-config";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";

/** A council member that records every call and never answers. */
class SilentMember implements LLMProvider {
  readonly calls: string[] = [];
  constructor(private readonly index: number) {}
  get info() { return { mode: "ai" as const, provider: "nvidia" as const, model: `test/member-${this.index}` }; }
  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request.schemaName);
    throw new Error("the council was not asked for");
  }
}

function setup(stored: Prison) {
  let current = structuredClone(stored);
  const repo: PrisonRepository = { get: async () => structuredClone(current), save: vi.fn(async (next: Prison) => { current = structuredClone(next); }), list: async () => [], delete: async () => false };
  const members = [1, 2, 3].map((index) => new SilentMember(index));
  const council: CouncilDeps = { members: members.map((provider, index) => ({ id: `member_${index + 1}`, role: `Specialist ${index + 1}`, provider })) };
  return { service: new PrisonService(repo, null, undefined, council), members, current: () => current };
}

describe("the fast single-model path", () => {
  it("is the default for a new request", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Write a weekly study plan for learning SQL.", language: "en", targetAI: "gpt" }, null);
    expect(prison.compileOptions.councilMode).toBe("single");
  });

  it("produces the prompt without the council even when a council is configured", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Write a weekly study plan for learning SQL.", language: "en", targetAI: "gpt" }, null);
    const { service, members, current } = setup(prison);
    const done = await service.compile(prison.id);
    expect(members.every((member) => member.calls.length === 0)).toBe(true);
    expect(done.status).toBe("READY");
    expect(current().promptVersions.length).toBeGreaterThan(0);
  });

  it("still gathers the council when the user chose a table", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Write a weekly study plan for learning SQL.", language: "en", targetAI: "gpt", councilMode: "competition" }, null);
    const { service, members } = setup(prison);
    await expect(service.compile(prison.id)).rejects.toBeTruthy();
    expect(members.some((member) => member.calls.length > 0)).toBe(true);
  });
});
