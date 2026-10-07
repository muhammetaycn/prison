import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildIntentSchema, IntentAnalysisSchema, type IntentAnalysis } from "@/models/intent";
import { analyzeIntent, checkIntent } from "@/core/intent-engine";
import { taskTypeIds } from "@/core/task-types/registry";
import { paymentIntent, ScriptedProvider } from "./helpers";

const tableQuote = "Çıktı yalnızca gün, içerik fikri, kısa metin ve görsel önerisi sütunlarından oluşan bir tablo olsun.";
const noPublishQuote = "Hesaba gönderi yayınlama;";
const contextQuote = "Bir kafeterya için bir haftalık Instagram içerik planı hazırla.";
const rawRequest = `${contextQuote} ${tableQuote} ${noPublishQuote} bu bir planlama görevidir.`;
const input = { rawRequest, language: "en" as const, targetAI: "claude" as const };

function cafeteriaIntent(overrides: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return paymentIntent({
    title: "Cafeteria Instagram Plan", primary_goal: "Prepare a weekly Instagram content plan for a cafeteria",
    secondary_goals: [], task_type: "social_media", secondary_task_types: [], domain: "social media",
    operation: "generate_content", target_ai_mentioned: null,
    expected_output: { format: "table", description: "A weekly content plan with the requested four columns", deliverables: ["Seven-day content plan table"] },
    existing_system: false, new_system: false, preserve_architecture: false,
    execution_required: false, analysis_required: false, research_required: false, coding_required: false,
    deployment_required: false, deployment_permission: "unspecified", visual_generation_required: false, advice_only: true,
    role: "a social media content planner", context_summary: contextQuote, current_system: "",
    known_facts: [], explicit_requirements: [tableQuote, noPublishQuote], implicit_requirements: [], constraints: [],
    protected_elements: [], allowed_operations: [], disallowed_operations: ["Publish posts to the account"],
    required_actions: ["Clarify the brand and audience", "Plan seven daily content ideas", "Check the four requested table columns"],
    assumptions: [], unknowns: ["The cafeteria's target audience"], conflicts: [],
    success_conditions: ["The table contains seven days and exactly the four requested columns"],
    execution_plan: {
      approach: "Clarify the missing brand context, prepare seven ideas and check the requested table.",
      steps: [
        { action: "Clarify the audience", purpose: "Avoid inventing the brand's audience", verification: "The audience is supplied or explicitly unresolved" },
        { action: "Prepare the daily ideas", purpose: "Cover the requested week", verification: "Seven distinct days are present" },
        { action: "Check the table", purpose: "Match the requested deliverable", verification: "Only the four requested columns are present" },
      ],
      clarifying_questions: ["Who is the cafeteria's target audience?"], recommended_target: "claude", target_rationale: "Respect the owner's selected Claude target.",
    },
    ...overrides,
  });
}

describe("new intent provider wire contract", () => {
  it("advertises non-empty bounded actions, outcomes, deliverables and literal source enums", () => {
    const schema = buildIntentSchema(taskTypeIds(), rawRequest);
    expect(schema.safeParse(cafeteriaIntent()).success).toBe(true);
    expect(z.toJSONSchema(schema, { io: "output", target: "draft-7" })).toMatchObject({
      properties: {
        title: { type: "string", minLength: 1 }, primary_goal: { type: "string", minLength: 1 }, role: { type: "string", minLength: 1 },
        required_actions: { minItems: 2, maxItems: 8, items: { type: "string", minLength: 1 } },
        success_conditions: { minItems: 1, maxItems: 12 },
        expected_output: { properties: { deliverables: { minItems: 1, maxItems: 12 } } },
        known_facts: { items: { enum: expect.arrayContaining([rawRequest, tableQuote, noPublishQuote]) } },
        explicit_requirements: { items: { enum: expect.arrayContaining([rawRequest, tableQuote, noPublishQuote]) } },
        context_summary: { enum: expect.arrayContaining(["", rawRequest, contextQuote]) },
        current_system: { enum: expect.arrayContaining(["", rawRequest, contextQuote]) },
      },
    });
  });

  it.each([
    { label: "too few actions", value: cafeteriaIntent({ required_actions: ["Prepare the table"] }) },
    { label: "too many actions", value: cafeteriaIntent({ required_actions: Array(9).fill("Prepare the table") }) },
    { label: "blank action", value: cafeteriaIntent({ required_actions: ["Prepare the table", " \t "] }) },
    { label: "empty outcomes", value: cafeteriaIntent({ success_conditions: [] }) },
    { label: "blank outcome", value: cafeteriaIntent({ success_conditions: [" \n "] }) },
    { label: "too many outcomes", value: cafeteriaIntent({ success_conditions: Array(13).fill("Seven days") }) },
    { label: "empty deliverables", value: cafeteriaIntent({ expected_output: { ...cafeteriaIntent().expected_output, deliverables: [] } }) },
    { label: "too many deliverables", value: cafeteriaIntent({ expected_output: { ...cafeteriaIntent().expected_output, deliverables: Array(13).fill("A table") } }) },
    ...(["title", "primary_goal", "role"] as const).map((key) => ({ label: `blank ${key}`, value: cafeteriaIntent({ [key]: " \t " }) })),
  ])("rejects $label before semantic approval", ({ value }) => {
    expect(buildIntentSchema(taskTypeIds(), rawRequest).safeParse(value).success).toBe(false);
  });

  it("retries empty model actions once using the schema limit, then preserves literal owner requirements", async () => {
    const provider = new ScriptedProvider().enqueue("prison_intent", cafeteriaIntent({ required_actions: [] }), cafeteriaIntent());
    const result = await analyzeIntent(input, provider);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain("required_actions");
    expect(result.intent.required_actions).toHaveLength(3);
    expect(result.intent.explicit_requirements).toEqual([tableQuote, noPublishQuote]);
    expect(result.intent.context_summary).toBe(contextQuote);
    expect(provider.calls[0]!.system).toContain("original language");
    expect(provider.calls[0]!.messages[0]!.content).toContain("must preserve the literal request wording");
  });

  it("rejects invented facts and paraphrased explicit requirements without a local fallback", async () => {
    const provider = new ScriptedProvider().enqueue("prison_intent",
      cafeteriaIntent({ known_facts: ["The cafeteria serves coffee and pastry"] }),
      cafeteriaIntent({ explicit_requirements: ["Write every caption in 30–50 words"] }),
    );
    await expect(analyzeIntent(input, provider)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain("known_facts");
  });

  it.each(["context_summary", "current_system"] as const)("rejects invented narrative facts in %s", async (field) => {
    const invented = cafeteriaIntent({ [field]: "The cafeteria serves pastry to a young local audience" });
    const provider = new ScriptedProvider().enqueue("prison_intent", invented, invented);
    await expect(analyzeIntent(input, provider)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain(field);
  });

  it("requires a real question for unresolved content-planning choices and preserves repository inspection", async () => {
    const valid = cafeteriaIntent();
    const bad = cafeteriaIntent({ execution_plan: { ...valid.execution_plan!, clarifying_questions: [] } });
    expect(checkIntent(bad, input)).toContain("clarifying_questions");
    const provider = new ScriptedProvider().enqueue("prison_intent", bad, valid);
    expect((await analyzeIntent(input, provider)).intent.execution_plan!.clarifying_questions).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
    const repository = paymentIntent({ execution_plan: { ...paymentIntent().execution_plan!, clarifying_questions: [] } });
    expect(checkIntent(repository, { rawRequest: "Add payments to the existing repository; inspect its configured provider.", language: "en", targetAI: "codex" })).toBeNull();
  });

  it("allows empty source lists and unresolved-free plans without inventing source text", () => {
    const valid = cafeteriaIntent({ known_facts: [], explicit_requirements: [], context_summary: "", current_system: "", unknowns: [], execution_plan: { ...cafeteriaIntent().execution_plan!, clarifying_questions: [] } });
    expect(buildIntentSchema(taskTypeIds(), rawRequest).safeParse(valid).success).toBe(true);
    expect(checkIntent(valid, input)).toBeNull();
    const noQuotes = buildIntentSchema(taskTypeIds(), "a".repeat(2001));
    expect(noQuotes.safeParse(valid).success).toBe(true);
    expect(noQuotes.safeParse({ ...valid, known_facts: ["a"] }).success).toBe(false);
  });

  it("keeps older saved intents resilient instead of applying new source or minimum rules to them", () => {
    const legacy = IntentAnalysisSchema.parse({
      ...cafeteriaIntent(), title: undefined, role: undefined, required_actions: undefined,
      known_facts: "A previously stored model summary", explicit_requirements: "An older paraphrase",
      success_conditions: [], expected_output: "table",
    });
    expect(legacy.title).toBe("");
    expect(legacy.role).toBe("");
    expect(legacy.required_actions).toEqual([]);
    expect(legacy.known_facts).toEqual(["A previously stored model summary"]);
    expect(legacy.explicit_requirements).toEqual(["An older paraphrase"]);
    expect(legacy.expected_output.deliverables).toEqual([]);
  });
});
