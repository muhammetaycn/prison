import type { ConcreteTarget } from "@/models/common";
import type { ResolvedPrison } from "@/models/prison";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";
import { generateLocalJailbreak } from "./local";
import { JailbreakOutputSchema } from "./schema";
import { jailbreakSystemPrompt, jailbreakUserMessage } from "./system-prompt";
import { validateOutput } from "@/core/output-validator";
import { buildJailbreakStrategyPlan, JAILBREAK_FRAMING_LIMITS } from "./strategy";

export { buildJailbreakStrategyPlan, JAILBREAK_FRAMING_LIMITS } from "./strategy";
export type { JailbreakStrategyPlan } from "./strategy";

export interface GenerateJailbreakInput {
  prison: ResolvedPrison;
  target: ConcreteTarget;
  basePrompt: string;
  provider?: LLMProvider | null;
  feedback?: string;
}

/** Generates framing from one prison. Configured provider failures propagate to the service. */
export async function generateJailbreakPrompt(
  input: GenerateJailbreakInput,
): Promise<{ prompt: string; strategies: string[]; isAiGenerated: boolean }> {
  const { prison, target, basePrompt, provider, feedback } = input;

  if (provider) {
    const lengthLimit = JAILBREAK_FRAMING_LIMITS[prison.compileOptions.verbosity];
    const result = await generateStructured(provider, {
      system: jailbreakSystemPrompt(target, prison.language),
      user: jailbreakUserMessage(prison, target, basePrompt, feedback),
      schema: JailbreakOutputSchema.extend({ prompt: JailbreakOutputSchema.shape.prompt.max(lengthLimit) }),
      schemaName: "jailbreak_output",
      effort: "high",
      maxTokens: 4096,
      maxAttempts: 2,
      check: (value) => {
        if (value.prompt.length > lengthLimit) return `The framing must be at most ${lengthLimit} characters for the selected verbosity setting.`;
        const validation = validateOutput({ text: value.prompt, blocks: [{ id: "OBJECTIVE", text: prison.spec.primaryGoal }], target, targetReason: "user_selected" });
        return validation.ok ? null : validation.problems.join("; ");
      },
    });
    return {
      prompt: result.prompt.trim(),
      strategies: result.strategies_used,
      isAiGenerated: true,
    };
  }

  return {
    prompt: generateLocalJailbreak(
      prison.spec.primaryGoal,
      prison.spec.domain,
      prison.spec.role,
      prison.rawRequest,
      target,
      prison.language,
      { spec: prison.spec, options: prison.compileOptions },
    ),
    strategies: buildJailbreakStrategyPlan(prison, target).strategies,
    isAiGenerated: false,
  };
}
