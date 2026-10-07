import { z } from "zod";

/**
 * Structured output schema for the JB Engine's AI response.
 * The AI returns the complementary introduction and a brief editorial summary.
 * The application appends the immutable task contract; reasoning is not private model reasoning.
 */
export const JailbreakOutputSchema = z.object({
  strategies_used: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  reasoning: z.string().max(2000),
  prompt: z.string().trim().min(100).max(6000),
  confidence: z.number().min(0).max(1),
});
export type JailbreakOutput = z.infer<typeof JailbreakOutputSchema>;
