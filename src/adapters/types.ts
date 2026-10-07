import type { ConcreteTarget, Language, Localized } from "@/models/common";
import type { BlockId, PromptBlock } from "@/models/prompt";
import type { CompileInput } from "@/core/context-engine";
import type { ResolvedTaskProfile } from "@/core/task-types/types";

export interface CompileContext {
  input: CompileInput;
  profile: ResolvedTaskProfile;
  target: ConcreteTarget;
  language: Language;
}

/**
 * A target adapter receives the same compiled blocks for every target and decides
 * ordering, headings, structure (Markdown vs XML) and target-specific agent conventions.
 * Adding a model = implementing this interface and registering it.
 */
export interface TargetAdapter {
  id: ConcreteTarget;
  label: string;
  /** Block order for this target. Blocks not listed keep their relative order at the end. */
  order: BlockId[];
  titles?: Partial<Record<BlockId, Localized>>;
  adapt(blocks: PromptBlock[], ctx: CompileContext): PromptBlock[];
  render(blocks: PromptBlock[], ctx: CompileContext): string;
}
