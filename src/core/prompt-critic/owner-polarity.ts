import type { ResolvedPrison } from "@/models/prison";
import { ITEM_LIST_KEYS } from "@/models/spec";
import { activeOwnerRevisions } from "@/core/context-engine";
import { conflictingOwnerQuote } from "@/core/text/owner-directives";
import type { CriticFinding } from "./rules";

/** Independent backstop: a critic's optimistic score cannot approve a clear polarity reversal. */
export function runOwnerPolarityRules(prison: ResolvedPrison, finalText?: string): CriticFinding[] {
  const owners = [prison.rawRequest, ...activeOwnerRevisions(prison).map((entry) => entry.message)];
  const protectedIds = new Set(prison.taskMemory.filter((entry) => entry.active).flatMap((entry) => entry.itemRefs));
  const findings: CriticFinding[] = [];
  for (const list of ITEM_LIST_KEYS) {
    if (list === "disallowedOperations" || list === "unknowns" || list === "conflicts") continue;
    for (const item of prison.spec[list]) {
      const quote = conflictingOwnerQuote(item.text, owners);
      if (!quote) continue;
      const canRestore = ["implicit", "revision"].includes(item.source) && !protectedIds.has(item.id);
      findings.push({
        rule: "owner-polarity", dimension: "constraint_clarity", severity: "high",
        message: `Türetilmiş koşul kullanıcının gerçek talimatıyla çelişiyor: ${quote} (${item.text})`,
        ...(canRestore ? { fix: { restoreOwnerQuotes: [{ itemId: item.id, ownerQuote: quote }] } } : {}),
      });
    }
  }
  for (const step of prison.spec.taskPlan?.steps ?? []) {
    const quote = [step.action, step.purpose, step.verification].map((text) => conflictingOwnerQuote(text, owners)).find(Boolean);
    if (quote) findings.push({ rule: "owner-polarity-plan", dimension: "execution_clarity", severity: "high", message: `Çözüm planı kullanıcının reddettiği koşulu gerektiriyor: ${quote}` });
  }
  // Check individual affirmative lines, so a quoted prohibition elsewhere cannot mask them.
  if (finalText) for (const line of finalText.split(/\n+/)) {
    const quote = conflictingOwnerQuote(line, owners);
    if (quote) findings.push({ rule: "owner-polarity-output", dimension: "intent_alignment", severity: "high", message: `Üretilen metin kullanıcı talimatını tersine çevirdi: ${quote}` });
  }
  return findings;
}
