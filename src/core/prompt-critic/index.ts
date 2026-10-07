import { ITEM_LIST_KEYS, type ItemListKey } from "@/models/spec";
import { QUALITY_DIMENSIONS, type CriticIssue, type QualityScores, type Severity } from "@/models/prompt";
import type { StatePatch } from "@/core/prison-engine/patch";
import type { CriticFinding } from "./rules";

export { runRules, CRITIC_RULES, type CriticFinding, type CriticRule, type RuleContext } from "./rules";
export { runLlmCritic, type LlmCriticResult } from "./llm";

/** Merges the fixes of all findings into one patch, or null when there is nothing to fix. */
export function mergeFixes(findings: CriticFinding[]): StatePatch | null {
  const add: Partial<Record<ItemListKey, string[]>> = {};
  const removeIds = new Set<string>();
  const ownerQuotes = new Map<string, { itemId: string; ownerQuote: string }>();
  for (const finding of findings) {
    if (!finding.fix) continue;
    for (const list of ITEM_LIST_KEYS) {
      const texts = finding.fix.add?.[list];
      if (texts?.length) add[list] = [...(add[list] ?? []), ...texts];
    }
    for (const id of finding.fix.removeIds ?? []) removeIds.add(id);
    for (const quote of finding.fix.restoreOwnerQuotes ?? []) ownerQuotes.set(quote.itemId, quote);
  }
  if (Object.keys(add).length === 0 && removeIds.size === 0 && ownerQuotes.size === 0) return null;
  return { add, removeIds: [...removeIds], ...(ownerQuotes.size ? { restoreOwnerQuotes: [...ownerQuotes.values()] } : {}) };
}

const PENALTY: Record<Severity, number> = { high: 0.35, medium: 0.2, low: 0.08 };

/**
 * Internal quality scores. Unfixed issues cost their full penalty, fixed ones a quarter.
 * When an LLM review ran, its scores are averaged in. Never shown to the user as numbers.
 */
export function scoreIssues(issues: CriticIssue[], llmScores: QualityScores | null): QualityScores {
  const scores = Object.fromEntries(QUALITY_DIMENSIONS.map((d) => [d, 1])) as QualityScores;
  for (const issue of issues) {
    const penalty = PENALTY[issue.severity] * (issue.fixed ? 0.25 : 1);
    scores[issue.dimension] = Math.max(0, (scores[issue.dimension] ?? 1) - penalty);
  }
  if (llmScores) {
    for (const d of QUALITY_DIMENSIONS) {
      scores[d] = Number((((scores[d] ?? 1) + (llmScores[d] ?? 1)) / 2).toFixed(3));
    }
  }
  return scores;
}

export function toIssue(finding: CriticFinding, fixed: boolean): CriticIssue {
  return {
    dimension: finding.dimension,
    severity: finding.severity,
    message: finding.message,
    source: finding.rule === "llm" ? "llm" : "rules",
    fixed,
  };
}
