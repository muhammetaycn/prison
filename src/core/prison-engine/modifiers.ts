import type { CompileOptions, ModifierAction, ScopeMode, Verbosity } from "@/models/options";

const VERBOSITY_ORDER: Verbosity[] = ["concise", "standard", "detailed"];
const SCOPE_ORDER: ScopeMode[] = ["strict", "balanced", "open"];

function step<T>(order: T[], current: T, delta: number): T {
  const index = Math.min(Math.max(order.indexOf(current) + delta, 0), order.length - 1);
  return order[index]!;
}

/** Toolbar modifiers. Each one is a deterministic change to the prison's compile options. */
export function applyModifier(options: CompileOptions, action: ModifierAction): CompileOptions {
  switch (action) {
    case "more_technical":
      return { ...options, technicality: options.technicality === "technical" ? "standard" : "technical" };
    case "shorter":
      return { ...options, verbosity: step(VERBOSITY_ORDER, options.verbosity, -1) };
    case "longer":
      return { ...options, verbosity: step(VERBOSITY_ORDER, options.verbosity, 1) };
    case "stricter":
      return { ...options, scope: step(SCOPE_ORDER, options.scope, -1) };
    case "freer":
      return { ...options, scope: step(SCOPE_ORDER, options.scope, 1) };
    case "toggle_agent":
      return { ...options, agentMode: !options.agentMode, executionContext: options.agentMode ? "chat" : "agent" };
    case "toggle_jailbreak":
      return { ...options, jailbreakMode: !options.jailbreakMode };
  }
}

/** Whether pressing the modifier would change anything (used to disable buttons at the limit). */
export function modifierChanges(options: CompileOptions, action: ModifierAction): boolean {
  const next = applyModifier(options, action);
  return (
    next.verbosity !== options.verbosity ||
    next.technicality !== options.technicality ||
    next.scope !== options.scope ||
    next.agentMode !== options.agentMode ||
    next.jailbreakMode !== options.jailbreakMode
  );
}
