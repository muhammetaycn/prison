import { z } from "zod";

export const VERBOSITY_LEVELS = ["concise", "standard", "detailed"] as const;
export const TECHNICALITY_LEVELS = ["standard", "technical"] as const;
/** strict = locked scope, balanced = default, open = free solution space inside hard limits. */
export const SCOPE_MODES = ["strict", "balanced", "open"] as const;
export const ExecutionContextSchema = z.enum(["chat", "mobile", "browser", "agent"]);
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
/**
 * How the prompt is produced. single = one AI API writes it directly (fast; the final text is still reviewed);
 * competition / collaboration = the multi-model council (arena or team table), only when the user asks for it.
 */
export const CouncilModeSchema = z.enum(["single", "competition", "collaboration"]);
export type CouncilMode = z.infer<typeof CouncilModeSchema>;

const CompileOptionsObject = z.object({
  verbosity: z.enum(VERBOSITY_LEVELS),
  technicality: z.enum(TECHNICALITY_LEVELS),
  scope: z.enum(SCOPE_MODES),
  agentMode: z.boolean(),
  jailbreakMode: z.boolean().default(false),
  executionContext: ExecutionContextSchema.default("chat"),
  councilMode: CouncilModeSchema.default("single"),
});
export const CompileOptionsSchema = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const options = value as Record<string, unknown>;
    if (options.executionContext === undefined && options.agentMode === true) return { ...options, executionContext: "agent" };
  }
  return value;
}, CompileOptionsObject);
export type CompileOptions = z.infer<typeof CompileOptionsSchema>;
export type Verbosity = CompileOptions["verbosity"];
export type ScopeMode = CompileOptions["scope"];

export const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  verbosity: "detailed",
  technicality: "standard",
  scope: "balanced",
  agentMode: false,
  jailbreakMode: false,
  executionContext: "chat",
  councilMode: "single",
};

/** Toolbar actions under the generated prompt ("Daha Teknik", "Daha Kısa", ...). */
export const MODIFIER_ACTIONS = [
  "more_technical",
  "shorter",
  "longer",
  "stricter",
  "freer",
  "toggle_agent",
  "toggle_jailbreak",
] as const;
export const ModifierActionSchema = z.enum(MODIFIER_ACTIONS);
export type ModifierAction = z.infer<typeof ModifierActionSchema>;
