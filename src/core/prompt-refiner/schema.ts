import { z } from "zod";

/** A complementary directive, followed by the immutable compiler contract in the pipeline. */
export const PromptRefinementOutputSchema = z.object({
  prompt: z.string().trim().min(100).max(6000),
  strategies_used: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
});
export type PromptRefinementOutput = z.infer<typeof PromptRefinementOutputSchema>;
