import type { ResolvedPrison } from "@/models/prison";
import type { CompiledPrompt } from "@/core/prompt-compiler";
import { validateOutput } from "@/core/output-validator";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";
import { PromptRefinementOutputSchema } from "./schema";
import { promptRefinementSystemPrompt, promptRefinementUserMessage } from "./system-prompt";

export interface GenerateRefinedPromptInput {
  provider: LLMProvider;
  prison: ResolvedPrison;
  compiled: CompiledPrompt;
  /** Feedback from the exact final-text review when the pipeline performs its one repair. */
  feedback?: string;
}

/** AI-authored directive for one isolated task. Provider failures propagate; no local substitution. */
export async function generateRefinedPrompt(input: GenerateRefinedPromptInput): Promise<{ prompt: string; strategies: string[] }> {
  const { provider, prison, compiled, feedback } = input;
  const lengthLimit = { concise: 1500, standard: 3500, detailed: 6000 }[prison.compileOptions.verbosity];
  const output = await generateStructured(provider, {
    system: promptRefinementSystemPrompt(compiled.target, prison.language),
    user: promptRefinementUserMessage(prison, compiled, feedback),
    schema: PromptRefinementOutputSchema.extend({ prompt: PromptRefinementOutputSchema.shape.prompt.max(lengthLimit) }),
    schemaName: "prison_prompt_refinement",
    effort: "high",
    maxTokens: 4096,
    maxAttempts: 2,
    check: (value) => {
      if (value.prompt.length > lengthLimit) return `The directive must be at most ${lengthLimit} characters for the selected verbosity setting.`;
      const validation = validateOutput({ ...compiled, text: value.prompt });
      return validation.ok ? null : validation.problems.join("; ");
    },
  });
  return { prompt: output.prompt, strategies: output.strategies_used };
}
