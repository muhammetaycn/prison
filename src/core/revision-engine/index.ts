import type { ClarificationAnswer, ResolvedPrison } from "@/models/prison";
import { renderIsolatedPrison } from "@/core/context-engine";
import { taskTypeIds } from "@/core/task-types/registry";
import { cleanText } from "@/core/text/normalize";
import { checkOwnerPolarity } from "@/core/text/owner-directives";
import { readJailbreakModeRequest } from "@/core/prison-engine/jailbreak-mode";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";
import { revisionSystemPrompt, revisionUserMessage } from "@/templates/engine-prompts";
import { interpretRevisionLocally } from "./local";
import { buildRevisionSchema, checkRevisionMemoryReferences, revisionToPatch } from "./schema";
import type { RevisionInterpretation } from "./types";

export type { RevisionInterpretation } from "./types";

/**
 * Revision Engine: a free-text revision message → a StatePatch for the ACTIVE prison.
 * The model only sees that prison's isolated state, never other prisons or chat history.
 */
export async function interpretRevision(
  message: string,
  prison: ResolvedPrison,
  provider: LLMProvider | null,
  clarifications?: ClarificationAnswer[],
): Promise<RevisionInterpretation> {
  if (!provider) return interpretRevisionLocally(message, prison);

  const output = await generateStructured(provider, {
    system: revisionSystemPrompt(prison.language),
    user: revisionUserMessage(renderIsolatedPrison(prison), message, clarifications),
    schema: buildRevisionSchema(taskTypeIds()),
    schemaName: "prison_revision",
    effort: "low",
    maxTokens: 8000,
    check: (value) => checkRevisionMemoryReferences(value) ?? checkOwnerPolarity([
      ...Object.entries(value.add).filter(([key]) => key !== "disallowed_operations" && key !== "unknowns").flatMap(([, texts]) => texts),
      ...value.resolved_unknowns.map((entry) => entry.fact),
    ], [message]),
  });
  const patch = revisionToPatch(output);
  // Mode changes require an explicit user selection; semantic model output cannot toggle it on its own.
  const jailbreakMode = readJailbreakModeRequest(message);
  if (patch.set?.options) delete patch.set.options.jailbreakMode;
  if (jailbreakMode !== undefined) {
    patch.set = { ...patch.set, options: { ...patch.set?.options, jailbreakMode } };
  }
  return {
    patch,
    summary: cleanText(output.summary) || "Prison güncellendi.",
    engine: "ai",
  };
}
