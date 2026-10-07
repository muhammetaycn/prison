import type { ConcreteTarget } from "@/models/common";
import type { PromptBlock, TargetReason } from "@/models/prompt";
import { getAdapter, resolveTarget } from "@/adapters/registry";
import { orderBlocks } from "@/adapters/render";
import type { CompileContext } from "@/adapters/types";
import type { CompileInput } from "@/core/context-engine";
import { resolveTaskProfile } from "@/core/task-types/registry";
import { adaptTaskBehavior } from "@/core/task-types/behavior";
import { combineJailbreakPrompt, generateLocalJailbreak } from "@/core/jailbreak-engine/local";
import { BLOCK_BUILDERS } from "./blocks";
import { condenseBlocks, selectBlocks } from "./select";

export interface CompiledPrompt {
  text: string;
  blocks: PromptBlock[];
  target: ConcreteTarget;
  targetReason: TargetReason;
  isJailbreak?: boolean;
}

function hasContent(block: PromptBlock): boolean {
  return Boolean(block.text?.trim()) || Boolean(block.items?.length) || Boolean(block.notes?.length);
}

/**
 * When the task steps are only template defaults and an execution protocol is present,
 * the protocol already says the same thing in more detail — drop the duplicate TASK block.
 */
function dropRedundantBlocks(blocks: PromptBlock[], input: CompileInput): PromptBlock[] {
  const actions = input.spec.requiredActions;
  const onlyDefaults = actions.length > 0 && actions.every((a) => a.source === "default");
  const hasProtocol = blocks.some((b) => b.id === "EXECUTION_PROTOCOL");
  return onlyDefaults && hasProtocol && !input.spec.taskPlan ? blocks.filter((b) => b.id !== "TASK") : blocks;
}

/**
 * Prompt Compiler. A pure function of one prison's compile input:
 * same input → same prompt, and nothing outside the input can reach the output.
 *
 *   select blocks → build blocks → (condense) → adapter.adapt → order → adapter.render
 */
export function compilePrompt(input: CompileInput): CompiledPrompt {
  const profile = adaptTaskBehavior(resolveTaskProfile(input.spec.taskType), input.spec);
  const { target, reason } = resolveTarget(input.targetAI, input.spec, profile);
  const adapter = getAdapter(target);
  const ctx: CompileContext = { input, profile, target, language: input.language };

  let blocks = selectBlocks(ctx)
    .map((id) => BLOCK_BUILDERS[id](ctx))
    .filter((block): block is PromptBlock => block !== null && hasContent(block));
  blocks = dropRedundantBlocks(blocks, input);
  if (input.options.verbosity === "concise") blocks = condenseBlocks(blocks, ctx);
  blocks = orderBlocks(adapter.adapt(blocks, ctx).filter(hasContent), adapter.order);

  // Normal compilation
  let text = `${adapter.render(blocks, ctx).trim()}\n`;

  // If jailbreak mode is active, wrap or generate jailbreak prompt using local generator synchronously
  // (Async AI-powered generation is performed in pipeline when provider is available)
  if (input.options.jailbreakMode) {
    const rawRequest = input.rawRequest || input.spec.primaryGoal;
    const goal = input.spec.primaryGoal;
    const domain = input.spec.domain || "Genel Teknik Analiz";
    const role = input.spec.role;

    const jbPrompt = generateLocalJailbreak(goal, domain, role, rawRequest, target, input.language, { spec: input.spec, options: input.options });
    text = combineJailbreakPrompt(jbPrompt, text, input.language);
  }

  return { text, blocks, target, targetReason: reason, isJailbreak: input.options.jailbreakMode };
}
