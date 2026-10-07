import type { BlockId, PromptBlock } from "@/models/prompt";
import type { CompileContext } from "@/adapters/types";
import { lowercaseFirst } from "@/core/text/normalize";
import { phrase } from "@/templates/phrases";

/**
 * Chooses which blocks a prompt needs. Not every prompt gets every block: selection depends on
 * the task profile, the prison's flags and the verbosity/technicality/agent options.
 */
export function selectBlocks(ctx: CompileContext): BlockId[] {
  const { options, spec } = ctx.input;
  const { flags } = spec;
  const verbosity = options.verbosity;
  const concise = verbosity === "concise";
  const detailed = verbosity === "detailed";
  const technical = options.technicality === "technical";
  const profileBlocks = new Set(ctx.profile.blocks);

  const ids: BlockId[] = ["ROLE", "OBJECTIVE", "CONTEXT"];
  if (flags.existingSystem && (!concise || technical)) ids.push("CURRENT_SYSTEM");
  if (detailed || ctx.input.ownerDirectives?.length) ids.push("USER_INTENT");
  ids.push("TASK", "REQUIREMENTS", "CONSTRAINTS", "PROTECTED_ELEMENTS");
  if (!concise || options.scope === "strict") ids.push("ALLOWED_OPERATIONS");
  ids.push("DO_NOT_DO", "ASSUMPTIONS", "UNKNOWNS");
  if (options.agentMode || (!concise && (profileBlocks.has("EXECUTION_PROTOCOL") || detailed))) {
    ids.push("EXECUTION_PROTOCOL");
  }
  if (!concise && (flags.researchRequired || profileBlocks.has("RESEARCH_PROTOCOL"))) ids.push("RESEARCH_PROTOCOL");
  if (flags.codingRequired && (!concise || technical)) ids.push("TEST_PROTOCOL");
  if (technical || detailed || (!concise && profileBlocks.has("VALIDATION_PROTOCOL"))) ids.push("VALIDATION_PROTOCOL");
  ids.push("OUTPUT_CONTRACT", "SUCCESS_CRITERIA");
  return ids;
}

/**
 * Concise mode: folds protections and prohibitions into the constraints block and drops
 * step intros. Nothing the user asked for is removed — only the packaging gets smaller.
 */
export function condenseBlocks(blocks: PromptBlock[], ctx: CompileContext): PromptBlock[] {
  const lang = ctx.language;
  const protectedBlock = blocks.find((b) => b.id === "PROTECTED_ELEMENTS");
  const doNotBlock = blocks.find((b) => b.id === "DO_NOT_DO");
  const folded = [
    ...(protectedBlock?.items ?? []).map((item) => `${phrase("keepIntactPrefix", lang)}${item}`),
    ...(doNotBlock?.items ?? []).map((item) =>
      lang === "en" ? `${phrase("doNotPrefix", lang)}${lowercaseFirst(item)}` : `${phrase("doNotPrefix", lang)}${item}`,
    ),
  ];

  let result = blocks.filter((b) => b.id !== "PROTECTED_ELEMENTS" && b.id !== "DO_NOT_DO");
  if (folded.length) {
    const constraints = result.find((b) => b.id === "CONSTRAINTS");
    result = constraints
      ? result.map((b) => (b.id === "CONSTRAINTS" ? { ...b, items: [...folded, ...(b.items ?? [])] } : b))
      : [...result, { id: "CONSTRAINTS", items: folded }];
  }
  return result.map((block) => (block.id === "TASK" ? { ...block, intro: undefined } : block));
}
