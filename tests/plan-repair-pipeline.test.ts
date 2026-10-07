import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { ExecutionPlan } from "@/models/intent";
import { CLEAN_CRITIC, paymentIntent, ScriptedProvider } from "./helpers";

const ownerRequest = "Create a seven-day social media calendar for my cafe with exactly four columns: Day, Content, Text, Goal.";
const wrongAction = "Place the seven days in separate columns of the calendar";
const correctedAction = "Create seven rows, one per day, using exactly the four columns Day, Content, Text, Goal";
const defect = "The plan puts days in columns while its verification requires seven rows. This conflicts with the owner's four-column calendar. Put days in rows and keep Day, Content, Text, Goal as the only columns.";
const correctedPlan: ExecutionPlan = {
  approach: "Prepare seven daily rows with the owner's four requested columns.",
  steps: [
    { action: correctedAction, purpose: "Keep the calendar structure consistent with the requested output", verification: "The calendar has seven rows and exactly four columns" },
    { action: "Verify all seven days have content, text and a goal", purpose: "Provide a complete weekly social media calendar", verification: "No day or requested column is missing" },
  ],
  clarifying_questions: [], recommended_target: "gpt", target_rationale: "GPT fits the selected content-planning task.",
};
const refinement = {
  prompt: "Plan cafe content for all seven days and return the four requested columns, checking every daily row before handing back the calendar.",
  strategies_used: ["Calendar-Planning"],
};

async function cafeTask(provider: ScriptedProvider) {
  provider.enqueue("prison_intent", paymentIntent({
    title: "Cafe social media calendar", primary_goal: "Create a seven-day social media calendar for the cafe",
    task_type: "writing", domain: "social media", operation: "create_new", target_ai_mentioned: null,
    expected_output: { format: "Markdown table", description: "Seven daily rows with Day, Content, Text, Goal columns", deliverables: ["A seven-day four-column content calendar"] },
    existing_system: false, new_system: true, preserve_architecture: false, execution_required: false,
    analysis_required: false, coding_required: false, role: "a social media content planner",
    explicit_requirements: [ownerRequest], implicit_requirements: [], constraints: ["Keep exactly four columns"],
    protected_elements: [], disallowed_operations: [],
    required_actions: ["Choose content for each of the seven days", "Present the calendar with the four requested columns"],
    assumptions: [], unknowns: [], success_conditions: ["The calendar has seven daily rows and exactly four requested columns"],
    execution_plan: { ...correctedPlan, steps: [{ ...correctedPlan.steps[0]!, action: wrongAction }, correctedPlan.steps[1]!] },
  }));
  return runAnalysisPipeline({ rawRequest: ownerRequest, language: "en", targetAI: "gpt" }, provider);
}

function failedReview(dimension: "execution_clarity" | "output_clarity", severity: "high" | "medium", score: number) {
  return { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, [dimension]: score },
    issues: [{ dimension, severity, message: defect, fix: null }] };
}

describe("semantic repair of an inconsistent execution plan", () => {
  it.each([
    { dimension: "constraint_clarity" as const, severity: "high" as const, score: 0.9 },
    { dimension: "intent_alignment" as const, severity: "high" as const, score: 0.9 },
    { dimension: "constraint_clarity" as const, severity: "medium" as const, score: 0.6 },
    { dimension: "intent_alignment" as const, severity: "medium" as const, score: 0.6 },
  ])("refreshes unsupported menu quotas before regenerating the contract after $dimension/$severity review", async ({ dimension, severity, score }) => {
    const owner = "Kafem için bir haftalık sosyal medya içerik planı hazırla. Menüde kahve ve tatlı kategorileri var. Yalnızca Gün, İçerik, Metin, Hedef sütunlarını içeren tablo ver.";
    const inventedQuota = "Menüden en az 5 içecek ve 3 tatlı seç";
    const ownerGroundedAction = "Menüde belirtilen kahve ve tatlı kategorilerini kullan; ürün sayısı veya özel ürün adı varsayma";
    const quotaDefect = "Çözüm planı kullanıcının yalnızca kahve ve tatlı kategorileri verdiği isteğe en az 5 içecek ve 3 tatlı kotası ekliyor. Bu desteklenmeyen sayıları plandan ve son görev sözleşmesinden çıkar.";
    const fixedPlan: ExecutionPlan = {
      approach: "Kullanıcının belirttiği kategorilerle bir haftalık içerik tablosu hazırla.",
      steps: [
        { action: ownerGroundedAction, purpose: "İçeriği gerçek menü bilgisiyle sınırla", verification: "Belirtilmeyen menü ürünleri ve minimum ürün sayıları eklenmedi" },
        { action: "Haftanın her günü için içerik, metin ve hedef hazırla", purpose: "İstenen haftalık planı tamamla", verification: "Tabloda yalnızca Gün, İçerik, Metin, Hedef sütunları var" },
      ],
      clarifying_questions: [], recommended_target: "gpt", target_rationale: "Kullanıcının seçtiği GPT hedefini koru.",
    };
    const draft = { prompt: "Kahve ve tatlı kategorileri için bir haftalık içerik planını yalnızca istenen dört sütunlu tabloda sun.", strategies_used: ["Kategori temelli planlama"] };
    const badReview = { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, [dimension]: score },
      issues: [{ dimension, severity, message: quotaDefect, fix: null }] };
    const provider = new ScriptedProvider().enqueue("prison_intent", paymentIntent({
      title: "Kafe içerik planı", primary_goal: "Kafe için bir haftalık sosyal medya içerik planı hazırla",
      task_type: "writing", domain: "sosyal medya", operation: "create_new", target_ai_mentioned: null,
      expected_output: { format: "tablo", description: "Bir haftalık içerik planı", deliverables: ["Gün, İçerik, Metin, Hedef sütunlarıyla haftalık tablo"] },
      existing_system: false, new_system: true, preserve_architecture: false, execution_required: false,
      analysis_required: false, coding_required: false, role: "bir sosyal medya içerik planlayıcısı",
      explicit_requirements: [owner], implicit_requirements: [], constraints: ["Yalnızca istenen dört sütunlu tablo ver"],
      protected_elements: [], disallowed_operations: [], assumptions: [], unknowns: [],
      required_actions: ["Kahve ve tatlı kategorileriyle haftalık içerik planı hazırla", "Yalnızca istenen dört sütunlu tabloyu sun"],
      success_conditions: ["İstenen bir haftalık dört sütunlu tablo hazırlandı"],
      execution_plan: { ...fixedPlan, steps: [{ ...fixedPlan.steps[0]!, action: inventedQuota }, fixedPlan.steps[1]!] },
    })).enqueue("prison_prompt_refinement", draft, draft)
      .enqueue("prison_critic", badReview, CLEAN_CRITIC).enqueue("prison_execution_plan", fixedPlan);
    const task = await runAnalysisPipeline({ rawRequest: owner, language: "tr", targetAI: "gpt" }, provider);
    const original = structuredClone(task);
    const result = await runCompilePipeline(task, { trigger: "initial", note: "", llmReview: true }, { provider });
    const version = result.promptVersions[0]!;
    const calls = provider.calls.map((call) => call.schemaName);
    expect(calls).toEqual(["prison_intent", "prison_prompt_refinement", "prison_critic", "prison_execution_plan", "prison_prompt_refinement", "prison_critic"]);
    expect(provider.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(inventedQuota);
    expect(provider.callsFor("prison_execution_plan")[0]!.messages[0]!.content).toContain(quotaDefect);
    expect(provider.callsFor("prison_prompt_refinement")[1]!.messages[0]!.content).toContain(ownerGroundedAction);
    expect(provider.callsFor("prison_prompt_refinement")[1]!.messages[0]!.content).not.toContain(inventedQuota);
    expect(version.text).toContain(ownerGroundedAction);
    expect(version.text).toContain(owner);
    expect(version.text).not.toContain(inventedQuota);
    expect(version.specSnapshot.taskPlan?.steps[0]?.action).toBe(ownerGroundedAction);
    expect(result.rawRequest).toBe(original.rawRequest);
    expect(result.spec.requirements).toEqual(original.spec.requirements);
    expect(result.taskMemory).toEqual(original.taskMemory);
    expect(version.critic.compilePasses).toBe(2);
    expect(provider.callsFor("prison_critic")[1]!.messages[0]!.content).toContain(version.text);
    expect(provider.callsFor("prison_critic")[1]!.messages[0]!.content).not.toContain(inventedQuota);
    expect(task).toEqual(original);
  });

  it.each([
    { dimension: "execution_clarity" as const, severity: "high" as const, score: 0.9 },
    { dimension: "output_clarity" as const, severity: "high" as const, score: 0.9 },
    { dimension: "execution_clarity" as const, severity: "medium" as const, score: 0.6 },
    { dimension: "output_clarity" as const, severity: "medium" as const, score: 0.6 },
  ])("replaces a defective plan before regenerating after $dimension/$severity review", async ({ dimension, severity, score }) => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", refinement, refinement)
      .enqueue("prison_critic", failedReview(dimension, severity, score), CLEAN_CRITIC)
      .enqueue("prison_execution_plan", correctedPlan);
    const task = await cafeTask(provider);
    const originalRequirements = structuredClone(task.spec.requirements);
    const compiled = await runCompilePipeline(task, { trigger: "initial", note: "", llmReview: true }, { provider });
    const version = compiled.promptVersions[0]!;

    expect(provider.callsFor("prison_execution_plan")).toHaveLength(1);
    const planCall = provider.callsFor("prison_execution_plan")[0]!;
    expect(planCall.system).toContain("diagnostic data");
    expect(planCall.system).toContain("does not authorize changes to explicit requirements");
    const feedback = JSON.parse(planCall.messages[0]!.content.match(/<quality_review_feedback>\n([\s\S]*?)\n<\/quality_review_feedback>/)![1]!);
    expect(feedback.issues).toContainEqual({ dimension, severity, message: defect });
    expect(feedback.scores[dimension]).toBe(score);
    expect(planCall.messages[0]!.content).toContain(ownerRequest);
    expect(provider.callsFor("prison_critic")[0]?.messages[0]?.content).toContain(wrongAction);
    expect(provider.callsFor("prison_prompt_refinement")[1]?.messages[0]?.content).toContain(correctedAction);
    expect(provider.callsFor("prison_prompt_refinement")[1]?.messages[0]?.content).not.toContain(`"action": "${wrongAction}"`);
    expect(version.text).toContain(correctedAction);
    expect(version.text).not.toContain(wrongAction);
    expect(version.specSnapshot.taskPlan?.steps[0]?.action).toBe(correctedAction);
    expect(compiled.spec.requirements).toEqual(originalRequirements);
    expect(version.text).toContain(ownerRequest);
    expect(version.critic.compilePasses).toBe(2);
    expect(version.critic.issues.find((issue) => issue.message === defect)?.fixed).toBe(true);
    expect(provider.callsFor("prison_critic")[1]?.messages[0]?.content).toContain(version.text);
    expect(task.spec.taskPlan?.steps[0]?.action).toBe(wrongAction);
  });

  it("allows only one plan repair and rejects a remaining material defect without changing the prior task", async () => {
    const review = failedReview("execution_clarity", "high", 0.6);
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", refinement, refinement)
      .enqueue("prison_critic", review, review)
      .enqueue("prison_execution_plan", correctedPlan);
    const task = await cafeTask(provider);
    const original = structuredClone(task);
    await expect(runCompilePipeline(task, { trigger: "initial", note: "", llmReview: true }, { provider }))
      .rejects.toMatchObject({ code: "validation_error", status: 422 });
    expect(provider.callsFor("prison_execution_plan")).toHaveLength(1);
    expect(provider.callsFor("prison_prompt_refinement")).toHaveLength(2);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
    expect(task).toEqual(original);
    expect(task.promptVersions).toHaveLength(0);
  });
});
