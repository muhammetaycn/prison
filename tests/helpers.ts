import type { IntentAnalysis } from "@/models/intent";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";

/**
 * Scripted LLM provider for tests. Responses are queued per schema name; each call pops one.
 * A response can be a string (raw model output) or an Error to throw.
 */
export class ScriptedProvider implements LLMProvider {
  readonly info = { mode: "ai" as const, provider: "scripted", model: "test-model" };
  readonly calls: JsonGenerationRequest[] = [];
  private readonly queues = new Map<string, Array<string | object | Error>>();

  enqueue(schemaName: string, ...responses: Array<string | object | Error>): this {
    const queue = this.queues.get(schemaName) ?? [];
    for (const response of responses) {
      queue.push(typeof response === "string" || response instanceof Error ? response : JSON.parse(JSON.stringify(response)));
    }
    this.queues.set(schemaName, queue);
    return this;
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    const next = this.queues.get(request.schemaName)?.shift();
    if (next === undefined) throw new Error(`No scripted response for ${request.schemaName}`);
    if (next instanceof Error) throw next;
    if (typeof next === "string") return next;
    return JSON.stringify(criticFixtureWithQuoteIds(next, request));
  }

  callsFor(schemaName: string): JsonGenerationRequest[] {
    return this.calls.filter((c) => c.schemaName === schemaName);
  }
}

/** Old object fixtures may name literal quotes; production wire and raw-string fixtures remain strict IDs. */
function criticFixtureWithQuoteIds(response: object, request: JsonGenerationRequest): object {
  if (request.schemaName !== "prison_critic") return response;
  const body = response as { corrections?: unknown };
  if (!Array.isArray(body.corrections)) return response;
  const focusText = request.messages[0]?.content.match(/<owner_review_focus>\n([\s\S]*?)\n<\/owner_review_focus>/)?.[1];
  if (!focusText) return response;
  const focus = JSON.parse(focusText) as { exact_owner_quote_options?: Array<{ id: string; quote: string }> };
  const choices = focus.exact_owner_quote_options ?? [];
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  return { ...response, corrections: body.corrections.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return entry;
    const correction = entry as Record<string, unknown>;
    if (typeof correction.owner_quote !== "string" || correction.owner_quote_id !== undefined) return entry;
    const choice = choices.find((option) => typeof option.quote === "string" && normalize(option.quote) === normalize(correction.owner_quote as string));
    if (!choice) return entry;
    const { owner_quote: _literal, ...rest } = correction;
    return { ...rest, owner_quote_id: choice.id };
  }) };
}

export function paymentIntent(overrides: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return {
    title: "Payment system integration",
    primary_goal: "Add a payment system to the existing project without breaking current functionality",
    secondary_goals: [],
    task_type: "coding",
    secondary_task_types: [],
    domain: "e-commerce payments",
    operation: "modify_existing",
    target_ai_mentioned: "codex",
    expected_output: {
      format: "Code changes in the repository",
      description: "A working payment flow integrated into the existing project",
      deliverables: ["Implemented payment flow", "Summary of changed files"],
    },
    existing_system: true,
    new_system: false,
    preserve_architecture: true,
    execution_required: true,
    analysis_required: false,
    research_required: false,
    coding_required: true,
    deployment_required: false,
    deployment_permission: "unspecified",
    visual_generation_required: false,
    advice_only: false,
    role: "a senior full-stack engineer experienced with payment integrations",
    context_summary: "",
    current_system: "",
    known_facts: [],
    // Tests use different owner requests; source-specific facts belong in each test's literal overrides.
    explicit_requirements: [],
    implicit_requirements: ["Handle failed payments safely"],
    constraints: ["Keep changes minimal"],
    protected_elements: ["Existing user flows"],
    allowed_operations: [],
    disallowed_operations: ["Deploy to production"],
    required_actions: ["Inspect the existing architecture", "Integrate the payment provider", "Test the payment flow"],
    assumptions: ["The repository is accessible to the target AI"],
    unknowns: ["Which payment provider to use"],
    conflicts: [],
    success_conditions: ["A test payment completes end to end"],
    execution_plan: {
      approach: "Inspect the existing payment flow, add the requested provider integration, then verify it without changing unrelated behavior.",
      steps: [
        { action: "Inspect the existing architecture", purpose: "Find the payment integration points without assuming the stack", verification: "Relevant modules and the provider choice are identified" },
        { action: "Integrate the payment provider", purpose: "Provide the requested payment flow", verification: "A test payment completes end to end" },
        { action: "Test the payment flow", purpose: "Protect existing flows and handle provider failures", verification: "Successful, failed and duplicate payments are checked" },
      ],
      clarifying_questions: ["Which payment provider should be used?"],
      recommended_target: "codex",
      target_rationale: "The request concerns changes and verification inside an existing repository.",
    },
    ...overrides,
  };
}

export const CLEAN_CRITIC = {
  scores: {
    intent_alignment: 0.9,
    context_completeness: 0.8,
    constraint_clarity: 0.9,
    execution_clarity: 0.9,
    output_clarity: 0.9,
    target_ai_compatibility: 0.95,
  },
  issues: [],
};
