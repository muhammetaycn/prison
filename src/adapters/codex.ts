import { CODEX_BLOCK_TITLES, phrase } from "@/templates/phrases";
import { blockTitle, findBlock, renderMarkdown, withItems, withNote } from "./render";
import type { TargetAdapter } from "./types";
import { isAdvisoryTask } from "@/core/task-types/behavior";

/**
 * Codex: a repository task brief. Task first, then repo context, boundaries, plan,
 * verification and the final report. Adds repository conventions for code work.
 */
export const codexAdapter: TargetAdapter = {
  id: "codex",
  label: "Codex",
  titles: CODEX_BLOCK_TITLES,
  order: [
    "ROLE",
    "OBJECTIVE",
    "CONTEXT",
    "CURRENT_SYSTEM",
    "USER_INTENT",
    "ASSUMPTIONS",
    "UNKNOWNS",
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
  adapt(input, ctx) {
    const { flags } = ctx.input.spec;
    const lang = ctx.language;
    let blocks = input;
    if (flags.codingRequired || flags.existingSystem) {
      const repoRule = phrase("codexRepoInstructions", lang);
      blocks = findBlock(blocks, "EXECUTION_PROTOCOL")
        ? withItems(blocks, "EXECUTION_PROTOCOL", [repoRule], "start")
        : withItems(blocks, "CONSTRAINTS", [repoRule], "end", {});
      blocks = withItems(blocks, "DO_NOT_DO", [phrase("codexNoPush", lang)], "end", {
        intro: phrase("doNotIntro", lang),
      });
    }
    if (ctx.input.options.agentMode && !isAdvisoryTask(ctx.input.spec)) {
      blocks = withNote(blocks, "EXECUTION_PROTOCOL", phrase("codexVerifyInSandbox", lang));
    }
    return blocks;
  },
  render(blocks, ctx) {
    return renderMarkdown(blocks, (id) => blockTitle(codexAdapter, id, ctx.language), {
      heading: "## ",
      preamble: ["ROLE"],
    });
  },
};
