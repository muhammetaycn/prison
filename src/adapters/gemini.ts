import { phrase } from "@/templates/phrases";
import { blockTitle, renderMarkdown, withNote } from "./render";
import type { TargetAdapter } from "./types";

/**
 * Gemini: context first, then objective and rules, with a closing instruction that anchors
 * the task after the context. Markdown headings.
 */
export const geminiAdapter: TargetAdapter = {
  id: "gemini",
  label: "Gemini",
  order: [
    "ROLE",
    "CONTEXT",
    "CURRENT_SYSTEM",
    "USER_INTENT",
    "ASSUMPTIONS",
    "UNKNOWNS",
    "OBJECTIVE",
    "REQUIREMENTS",
    "CONSTRAINTS",
    "PROTECTED_ELEMENTS",
    "ALLOWED_OPERATIONS",
    "DO_NOT_DO",
    "TASK",
    "EXECUTION_PROTOCOL",
    "RESEARCH_PROTOCOL",
    "TEST_PROTOCOL",
    "VALIDATION_PROTOCOL",
    "OUTPUT_CONTRACT",
    "SUCCESS_CRITERIA",
  ],
  adapt(blocks, ctx) {
    if (!ctx.input.options.agentMode) return blocks;
    return withNote(blocks, "EXECUTION_PROTOCOL", phrase("geminiPlanFirst", ctx.language));
  },
  render(blocks, ctx) {
    return renderMarkdown(blocks, (id) => blockTitle(geminiAdapter, id, ctx.language), {
      heading: "## ",
      preamble: ["ROLE"],
      closing: phrase("geminiClosing", ctx.language),
    });
  },
};
