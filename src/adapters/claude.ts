import { phrase } from "@/templates/phrases";
import { renderXml, withNote } from "./render";
import type { TargetAdapter } from "./types";

/**
 * Claude: XML-tagged sections, context and material first, instructions after,
 * output contract and success criteria last.
 */
export const claudeAdapter: TargetAdapter = {
  id: "claude",
  label: "Claude",
  order: [
    "ROLE",
    "CONTEXT",
    "CURRENT_SYSTEM",
    "USER_INTENT",
    "ASSUMPTIONS",
    "UNKNOWNS",
    "OBJECTIVE",
    "REQUIREMENTS",
    "PROTECTED_ELEMENTS",
    "CONSTRAINTS",
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
    return withNote(blocks, "EXECUTION_PROTOCOL", phrase("claudeParallel", ctx.language));
  },
  render(blocks) {
    return renderXml(blocks, ["ROLE"]);
  },
};
