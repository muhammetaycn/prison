import { phrase } from "@/templates/phrases";
import { blockTitle, renderMarkdown, withNote } from "./render";
import type { TargetAdapter } from "./types";

/**
 * GPT: instructions first, then context; Markdown headings; explicit, non-contradictory rules.
 * In agent mode it adds a persistence instruction so the model does not stop early.
 */
export const gptAdapter: TargetAdapter = {
  id: "gpt",
  label: "GPT",
  order: [
    "ROLE",
    "OBJECTIVE",
    "CONTEXT",
    "CURRENT_SYSTEM",
    "USER_INTENT",
    "ASSUMPTIONS",
    "UNKNOWNS",
    "TASK",
    "REQUIREMENTS",
    "CONSTRAINTS",
    "PROTECTED_ELEMENTS",
    "ALLOWED_OPERATIONS",
    "DO_NOT_DO",
    "EXECUTION_PROTOCOL",
    "RESEARCH_PROTOCOL",
    "TEST_PROTOCOL",
    "VALIDATION_PROTOCOL",
    "OUTPUT_CONTRACT",
    "SUCCESS_CRITERIA",
  ],
  adapt(blocks, ctx) {
    if (!ctx.input.options.agentMode) return blocks;
    return withNote(blocks, "EXECUTION_PROTOCOL", phrase("gptPersistence", ctx.language));
  },
  render(blocks, ctx) {
    return renderMarkdown(blocks, (id) => blockTitle(gptAdapter, id, ctx.language), {
      heading: "## ",
      preamble: ["ROLE"],
    });
  },
};
