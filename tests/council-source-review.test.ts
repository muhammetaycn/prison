import { describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { ExecutionPlan, IntentAnalysis } from "@/models/intent";
import type { Prison, ResolvedPrison } from "@/models/prison";
import { AIProviderError } from "@/services/ai/errors";
import { QUICK_DEPTH, type CouncilDeps } from "@/services/ai/council-config";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";
import { PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";
import { CLEAN_CRITIC, paymentIntent, ScriptedProvider } from "./helpers";

const OWNER = "Kafem için bir haftalık içerik planı hazırla. Çıktı Gün, İçerik, Metin, Hedef sütunlarından oluşan Markdown tablo olsun: başlık hariç tam 7 veri satırı.";
const HEADER_BAN = "Markdown tablosunda başlık olmamak";
// A semantic paraphrase outside the conservative lexical rule still requires real source review.
const SEMANTIC_HEADER_BAN = "Sütun etiketlerini tablonun ilk satırında gösterme";
const QUOTA = "Menüden en az 5 içecek ve 3 tatlı seç";
const FIXED_PLAN: ExecutionPlan = {
  approach: "Kullanıcının istediği dört sütunla haftalık içerik tablosu hazırla.",
  steps: [
    { action: "Gün, İçerik, Metin, Hedef sütunlarıyla Markdown tablo hazırla", purpose: "İstenen çıktı biçimini koru", verification: "Dört sütunun başlık satırı mevcut" },
    { action: "Başlık hariç tam 7 veri satırını doğrula", purpose: "İstenen haftayı tamamla", verification: "Başlık veri satırı sayısına dahil edilmedi" },
  ],
  clarifying_questions: [], recommended_target: "gpt", target_rationale: "Kullanıcının seçtiği GPT hedefini koru.",
};
const INITIAL = { trigger: "initial" as const, note: "", llmReview: true };
const BODY = "Kafenin bir haftalık içerik planını Gün, İçerik, Metin, Hedef sütunlarıyla Markdown tabloda hazırla. Sütun başlıklarını koru; başlık hariç tam 7 veri satırını doğrula. Kullanıcının belirtmediği ürün sayıları veya menü ayrıntıları ekleme.";

class Primary extends ScriptedProvider {
  constructor(private readonly timeline: string[]) { super(); }
  override async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.timeline.push(`primary:${request.schemaName}`);
    return super.generateJson(request);
  }
}

class Member implements LLMProvider {
  readonly info;
  readonly calls: JsonGenerationRequest[] = [];
  criticReplies: Array<object | Error> = [];
  private generations = 0;
  constructor(readonly index: number, private readonly timeline: string[]) {
    this.info = { mode: "ai" as const, provider: "nvidia", model: `source-test/member-${index}` };
  }
  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    this.timeline.push(`member_${this.index}:${request.schemaName}`);
    if (request.schemaName === "prison_critic") {
      const reply = this.criticReplies.shift() ?? CLEAN_CRITIC;
      if (reply instanceof Error) throw reply;
      return JSON.stringify(reply);
    }
    if (request.schemaName === "prison_execution_plan") return JSON.stringify(FIXED_PLAN);
    if (request.schemaName === "prison_prompt_refinement" || request.schemaName === "jailbreak_output") return JSON.stringify({
      prompt: `${BODY} Üye ${this.index}, düzenleme ${++this.generations}.`, strategies_used: ["Owner contract"],
      ...(request.schemaName === "jailbreak_output" ? { reasoning: "Private draft reasoning", confidence: 0.9 } : {}),
    });
    if (request.schemaName.startsWith("prison_council_")) {
      const body = request.messages[0]!.content;
      const envelope = JSON.parse(body.slice(body.lastIndexOf("</prison_state>") + "</prison_state>".length)) as { candidates: Array<{ id: string }> };
      return JSON.stringify({ evaluations: envelope.candidates.map(({ id }) => ({
        candidate_id: id,
        scores: Object.fromEntries(Object.keys(CLEAN_CRITIC.scores).map((key) => [key, id === "member_2" ? 0.95 : 0.9])),
        issues: [], suggestions: [],
      })) });
    }
    throw new Error(`Unexpected member schema: ${request.schemaName}`);
  }
}

function council(timeline: string[]): CouncilDeps & { providers: Member[] } {
  const providers = Array.from({ length: 3 }, (_, index) => new Member(index + 1, timeline));
  return {
    verifySource: true, depth: { ...QUICK_DEPTH, callTimeoutMs: 2000 }, providers,
    members: providers.map((provider, index) => ({ id: `member_${index + 1}`, role: `Uzman ${index + 1}`, provider })),
  };
}

async function task(jailbreakMode = false, overrides: Partial<IntentAnalysis> = {}, owner = OWNER): Promise<ResolvedPrison> {
  const analyzer = new ScriptedProvider().enqueue("prison_intent", paymentIntent({
    title: "Kafe içerik planı", primary_goal: "Kafe için bir haftalık içerik planı hazırla",
    task_type: "writing", domain: "sosyal medya", operation: "create_new", target_ai_mentioned: null,
    expected_output: { format: "Markdown tablo", description: "Dört sütunlu haftalık tablo", deliverables: ["Başlık hariç tam 7 veri satırı"] },
    existing_system: false, new_system: true, preserve_architecture: false, execution_required: false,
    analysis_required: false, coding_required: false, role: "bir içerik planlayıcısı",
    explicit_requirements: [owner], implicit_requirements: [], constraints: [],
    protected_elements: [], disallowed_operations: [], assumptions: [], unknowns: [],
    required_actions: [FIXED_PLAN.steps[0]!.action, FIXED_PLAN.steps[1]!.action],
    success_conditions: ["İstenen dört sütun ve başlık hariç 7 veri satırı hazırlandı"], execution_plan: FIXED_PLAN,
    ...overrides,
  }));
  return runAnalysisPipeline({ rawRequest: owner, language: "tr", targetAI: "gpt", jailbreakMode }, analyzer);
}

function repository(value: Prison) {
  let persisted = structuredClone(value);
  const save = vi.fn(async (next: Prison) => { persisted = structuredClone(next); });
  const repo: PrisonRepository = { list: async () => [], get: async () => structuredClone(persisted), save, delete: async () => false };
  return { repo, save, current: () => persisted };
}

describe("configured council source review", () => {
  it.each([false, true])("repairs model-origin subgoal and constraint narrowing from the actual owner before member drafts (JB=%s)", async (jb) => {
    const lighting = "Görseller için sıcak doğal ışık öner.";
    const noEmoji = "Emoji, hashtag, konum bilgisi ve satış çağrısı kullanma.";
    const owner = `${OWNER} ${lighting} ${noEmoji}`;
    const narrowing = "Görsel önerileri sadece sıcak doğal ışık önerisi içerecek";
    const value = await task(jb, {
      secondary_goals: [narrowing], constraints: [narrowing], explicit_requirements: [lighting, noEmoji],
    }, owner);
    const derivedGoal = value.spec.secondaryGoals.find((item) => item.text === narrowing)!;
    const derivedConstraint = value.spec.constraints.find((item) => item.text === narrowing)!;
    const ownerItems = value.spec.requirements.filter((item) => item.source === "explicit");
    expect(derivedGoal.source).toBe("implicit");
    const original = structuredClone(value);
    const plan: ExecutionPlan = { ...FIXED_PLAN, steps: [
      ...FIXED_PLAN.steps,
      { action: "İçerik konusuna uygun görsel ve sıcak doğal ışık öner", purpose: "İstenen görsel önerisini hazırla", verification: "Görsel önerisi sıcak doğal ışığı içerir; ilgisiz bir içerik yasağı eklenmez" },
    ] };
    const timeline: string[] = [];
    const primary = new Primary(timeline)
      .enqueue("prison_critic", { ...CLEAN_CRITIC, corrections: [
        { item_id: derivedGoal.id, owner_quote: lighting },
        { item_id: derivedConstraint.id, owner_quote: lighting },
      ] }, CLEAN_CRITIC)
      .enqueue("prison_execution_plan", plan);
    const deps = council(timeline);
    const result = await runCompilePipeline(value, INITIAL, { provider: primary, council: deps });
    expect(timeline.slice(0, 3)).toEqual(["primary:prison_critic", "primary:prison_execution_plan", "primary:prison_critic"]);
    expect(result.spec.secondaryGoals).toContainEqual({ id: derivedGoal.id, text: lighting, source: "explicit" });
    expect(result.spec.constraints).toContainEqual({ id: derivedConstraint.id, text: lighting, source: "explicit" });
    for (const explicit of ownerItems) expect(result.spec.requirements).toContainEqual(explicit);
    for (const member of deps.providers) for (const draft of member.calls.filter((request) => ["prison_prompt_refinement", "jailbreak_output"].includes(request.schemaName))) {
      expect(draft.messages[0]!.content).not.toContain(narrowing);
      expect(draft.messages[0]!.content).toContain(lighting);
      expect(draft.messages[0]!.content).toContain(noEmoji);
    }
    const version = result.promptVersions[0]!;
    expect(version.text).not.toContain(narrowing);
    expect(version.text).toContain(lighting);
    expect(version.text).toContain(noEmoji);
    expect(version.critic.refined).toBe(true);
    expect(version.options.jailbreakMode).toBe(jb);
    expect(result.rawRequest).toBe(owner);
    expect(value).toEqual(original);
  });

  it("refuses source-review corrections to literal owner requirements even when the replacement is another genuine owner quote", async () => {
    const lighting = "Görseller için sıcak doğal ışık öner.";
    const noEmoji = "Emoji kullanma.";
    const value = await task(false, { explicit_requirements: [lighting, noEmoji] }, `${OWNER} ${lighting} ${noEmoji}`);
    const explicit = value.spec.requirements.find((item) => item.text === lighting.slice(0, -1))!;
    const original = structuredClone(value);
    const timeline: string[] = [];
    const invalidCorrection = { ...CLEAN_CRITIC, corrections: [{ item_id: explicit.id, owner_quote: noEmoji }] };
    const primary = new Primary(timeline).enqueue("prison_critic", invalidCorrection, invalidCorrection);
    const deps = council(timeline);
    await expect(runCompilePipeline(value, INITIAL, { provider: primary, council: deps })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(primary.callsFor("prison_critic")).toHaveLength(2);
    expect(deps.providers.flatMap((member) => member.calls)).toEqual([]);
    expect(value).toEqual(original);
    expect(value.promptVersions).toHaveLength(0);
  });

  it.each([false, true])("restores an implicit header ban before source review and member generation (JB=%s)", async (jb) => {
    const value = await task(jb);
    value.spec.requirements.push({ id: "derived_header", text: HEADER_BAN, source: "implicit" });
    const original = structuredClone(value);
    const timeline: string[] = [];
    const primary = new Primary(timeline).enqueue("prison_critic", CLEAN_CRITIC);
    const deps = council(timeline);
    const progress: string[] = [];
    const result = await runCompilePipeline(value, INITIAL, { provider: primary, council: deps, onProgress: (update) => progress.push(update.message) });
    const source = primary.callsFor("prison_critic")[0]!;
    expect(source.messages[0]!.content).toContain(OWNER);
    expect(source.messages[0]!.content).not.toContain(HEADER_BAN);
    expect(timeline[0]).toBe("primary:prison_critic");
    expect(progress[0]).toContain("konseyden önce");
    const drafts = deps.providers.flatMap((provider) => provider.calls.filter((request) => ["prison_prompt_refinement", "jailbreak_output"].includes(request.schemaName)));
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.messages[0]!.content).toContain(OWNER);
      expect(draft.messages[0]!.content).not.toContain(HEADER_BAN);
    }
    expect(result.spec.requirements).toContainEqual({ id: "derived_header", text: OWNER.slice(OWNER.indexOf("Çıktı")), source: "explicit" });
    expect(result.rawRequest).toBe(OWNER);
    expect(result.taskMemory).toEqual(original.taskMemory);
    expect(result.promptVersions[0]!.text).toContain(OWNER);
    expect(result.promptVersions[0]!.options.jailbreakMode).toBe(jb);
    expect(JSON.stringify(result)).not.toContain("Private draft reasoning");
    expect(value).toEqual(original);
  });

  it("uses an exact owner quote to repair a semantic header paraphrase and re-plans before any member drafts", async () => {
    const value = await task();
    value.spec.requirements.push({ id: "semantic_header", text: SEMANTIC_HEADER_BAN, source: "implicit" });
    const original = structuredClone(value);
    const timeline: string[] = [];
    const primary = new Primary(timeline)
      .enqueue("prison_critic", { ...CLEAN_CRITIC, corrections: [{ item_id: "semantic_header", owner_quote: OWNER }] }, CLEAN_CRITIC)
      .enqueue("prison_execution_plan", FIXED_PLAN);
    const deps = council(timeline);
    const result = await runCompilePipeline(value, INITIAL, { provider: primary, council: deps });
    expect(timeline.slice(0, 3)).toEqual(["primary:prison_critic", "primary:prison_execution_plan", "primary:prison_critic"]);
    expect(primary.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(SEMANTIC_HEADER_BAN);
    expect(primary.callsFor("prison_critic")[1]!.messages[0]!.content).not.toContain(SEMANTIC_HEADER_BAN);
    expect(primary.callsFor("prison_execution_plan")[0]!.messages[0]!.content).toContain(OWNER);
    expect(result.spec.requirements).toContainEqual({ id: "semantic_header", text: OWNER, source: "explicit" });
    for (const member of deps.providers) for (const draft of member.calls.filter((request) => request.schemaName === "prison_prompt_refinement")) {
      expect(draft.messages[0]!.content).not.toContain(SEMANTIC_HEADER_BAN);
      expect(draft.messages[0]!.content).toContain(FIXED_PLAN.steps[0]!.action);
    }
    expect(result.promptVersions[0]!.critic.compilePasses).toBe(1);
    expect(result.promptVersions[0]!.critic.refined).toBe(true);
    expect(value).toEqual(original);
  });

  it("bounds source and final plan repairs independently without restarting the council", async () => {
    const value = await task();
    value.spec.taskPlan!.steps[0]!.action = QUOTA;
    const original = structuredClone(value);
    const timeline: string[] = [];
    const quotaReview = { ...CLEAN_CRITIC, issues: [{ dimension: "constraint_clarity", severity: "high", message: "Unsupported numerical menu quota: remove the invented minimum 5 drinks and 3 desserts.", fix: null }] };
    const finalReview = { ...CLEAN_CRITIC, issues: [{ dimension: "output_clarity", severity: "high", message: "The exact generated direction needs a clearer row verification instruction.", fix: null }] };
    const primary = new Primary(timeline).enqueue("prison_critic", quotaReview, CLEAN_CRITIC).enqueue("prison_execution_plan", FIXED_PLAN, FIXED_PLAN);
    const deps = council(timeline);
    deps.providers[0]!.criticReplies = [finalReview, CLEAN_CRITIC];
    const result = await runCompilePipeline(value, INITIAL, { provider: primary, council: deps });
    expect(timeline.slice(0, 3)).toEqual(["primary:prison_critic", "primary:prison_execution_plan", "primary:prison_critic"]);
    expect(primary.callsFor("prison_execution_plan")).toHaveLength(2);
    expect(primary.callsFor("prison_critic")).toHaveLength(2);
    expect(primary.callsFor("prison_critic")[1]!.messages[0]!.content).not.toContain(QUOTA);
    const allCalls = deps.providers.flatMap((provider) => provider.calls);
    expect(allCalls.filter((request) => request.schemaName === "prison_council_peer_review")).toHaveLength(3);
    expect(allCalls.filter((request) => request.schemaName === "prison_council_final_review")).toHaveLength(3);
    expect(allCalls.filter((request) => request.schemaName === "prison_prompt_refinement")).toHaveLength(7);
    const exact = deps.providers[0]!.calls.filter((request) => request.schemaName === "prison_critic");
    expect(exact).toHaveLength(2);
    expect(exact[1]!.messages[0]!.content).toContain(result.promptVersions[0]!.text);
    expect(result.promptVersions[0]!.critic.compilePasses).toBe(2);
    expect(result.promptVersions[0]!.text).not.toContain(QUOTA);
    expect(result.rawRequest).toBe(original.rawRequest);
    expect(result.taskMemory).toEqual(original.taskMemory);
    expect(value).toEqual(original);
  });

  it("rejects a protected source conflict even with optimistic critic scores, without council work or persistence", async () => {
    const value = await task();
    value.spec.taskPlan = null;
    value.spec.requirements.push({ id: "protected_header", text: HEADER_BAN, source: "implicit" });
    value.taskMemory.push({ id: "memory_header", createdAt: value.createdAt, directive: "Keep the existing protected item", kind: "constraint", itemRefs: ["protected_header"], active: true });
    const storage = repository(value);
    const timeline: string[] = [];
    const primary = new Primary(timeline).enqueue("prison_critic", CLEAN_CRITIC, CLEAN_CRITIC);
    const deps = council(timeline);
    const service = new PrisonService(storage.repo, primary, () => new Date(), deps);
    await expect(service.compile(value.id)).rejects.toMatchObject({ code: "validation_error", status: 422 });
    expect(primary.callsFor("prison_critic")).toHaveLength(2);
    expect(deps.providers.flatMap((provider) => provider.calls)).toEqual([]);
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.current()).toEqual(value);
  });

  it("propagates a source authentication failure without claiming review, doing council work, or saving", async () => {
    const value = await task();
    const storage = repository(value);
    const timeline: string[] = [];
    const primary = new Primary(timeline).enqueue("prison_critic", new AIProviderError("auth", "test rejection"));
    const deps = council(timeline);
    const service = new PrisonService(storage.repo, primary, () => new Date(), deps);
    await expect(service.compile(value.id)).rejects.toMatchObject({ code: "ai_error", detail: "auth: test rejection" });
    expect(timeline).toEqual(["primary:prison_critic"]);
    expect(deps.providers.flatMap((provider) => provider.calls)).toEqual([]);
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.current()).toEqual(value);
  });

  it.each(["transient primary", "no primary"])("reviews the source with an actual member when there is %s", async (scenario) => {
    const value = await task();
    const timeline: string[] = [];
    const primary = scenario === "no primary" ? null : new Primary(timeline).enqueue("prison_critic", new AIProviderError("unavailable", "test overload"));
    const deps = council(timeline);
    const result = await runCompilePipeline(value, INITIAL, { provider: primary, council: deps });
    const sourceIndex = timeline.indexOf("member_1:prison_critic");
    const firstDraft = timeline.findIndex((entry) => entry.endsWith(":prison_prompt_refinement"));
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(sourceIndex).toBeLessThan(firstDraft);
    const source = deps.providers[0]!.calls[0]!;
    expect(source.schemaName).toBe("prison_critic");
    expect(source.timeoutMs).toBe(2000);
    expect(source.messages[0]!.content).toContain(OWNER);
    expect(result.promptVersions[0]!.councilReview!.finalReviewerModel).toBe(deps.providers[0]!.info.model);
    expect(result.promptVersions[0]!.generation!.model).toBe(deps.providers[1]!.info.model);
    if (primary) expect(primary.callsFor("prison_critic")).toHaveLength(1);
  });
});
