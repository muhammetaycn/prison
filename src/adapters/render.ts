import type { Language } from "@/models/common";
import type { BlockId, PromptBlock } from "@/models/prompt";
import { BLOCK_TITLES } from "@/templates/phrases";
import type { TargetAdapter } from "./types";

/** Shared rendering and block-manipulation helpers for adapters. */

export function blockTitle(adapter: TargetAdapter, id: BlockId, language: Language): string {
  return adapter.titles?.[id]?.[language] ?? BLOCK_TITLES[id][language];
}

export function orderBlocks(blocks: PromptBlock[], order: BlockId[]): PromptBlock[] {
  const rank = (id: BlockId) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => rank(a.block.id) - rank(b.block.id) || a.index - b.index)
    .map(({ block }) => block);
}

type Mode = "markdown" | "xml";

function renderList(items: string[], ordered: boolean): string {
  return items.map((item, i) => (ordered ? `${i + 1}. ${item}` : `- ${item}`)).join("\n");
}

export function renderBody(block: PromptBlock, mode: Mode): string {
  const segments: string[] = [];
  let pending = block.intro;
  const list = block.items?.length ? renderList(block.items, block.ordered ?? false) : "";

  if (block.text) {
    if (pending) segments.push(pending);
    pending = undefined;
    const text =
      block.quote && mode === "markdown"
        ? block.text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        : block.text;
    segments.push(text);
  }
  if (list) {
    if (block.itemsLabel && pending) {
      segments.push(pending);
      pending = undefined;
    }
    const label = block.itemsLabel ?? pending;
    segments.push(label ? `${label}\n${list}` : list);
    pending = undefined;
  }
  if (pending) segments.push(pending);
  for (const note of block.notes ?? []) segments.push(note);
  return segments.join("\n\n");
}

export interface MarkdownOptions {
  heading: string;
  /** Blocks rendered as plain paragraphs before the first heading (e.g. the role line). */
  preamble: BlockId[];
  closing?: string;
}

export function renderMarkdown(
  blocks: PromptBlock[],
  title: (id: BlockId) => string,
  options: MarkdownOptions,
): string {
  const parts = blocks.map((block) => {
    const body = renderBody(block, "markdown");
    return options.preamble.includes(block.id) ? body : `${options.heading}${title(block.id)}\n${body}`;
  });
  if (options.closing) parts.push(options.closing);
  return parts.join("\n\n");
}

export function renderXml(blocks: PromptBlock[], preamble: BlockId[]): string {
  return blocks
    .map((block) => {
      const body = renderBody(block, "xml");
      if (preamble.includes(block.id)) return body;
      const tag = block.id.toLowerCase();
      return `<${tag}>\n${body}\n</${tag}>`;
    })
    .join("\n\n");
}

export function findBlock(blocks: PromptBlock[], id: BlockId): PromptBlock | undefined {
  return blocks.find((b) => b.id === id);
}

/** Returns blocks with `items` appended to block `id`, creating the block if `create` is given. */
export function withItems(
  blocks: PromptBlock[],
  id: BlockId,
  items: string[],
  position: "start" | "end" = "end",
  create?: Omit<PromptBlock, "id" | "items">,
): PromptBlock[] {
  if (!items.length) return blocks;
  if (!findBlock(blocks, id)) {
    return create ? [...blocks, { id, ...create, items }] : blocks;
  }
  return blocks.map((block) =>
    block.id === id
      ? { ...block, items: position === "start" ? [...items, ...(block.items ?? [])] : [...(block.items ?? []), ...items] }
      : block,
  );
}

export function withNote(blocks: PromptBlock[], id: BlockId, note: string): PromptBlock[] {
  return blocks.map((block) => (block.id === id ? { ...block, notes: [...(block.notes ?? []), note] } : block));
}
