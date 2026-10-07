import { ITEM_ID_PREFIX, ITEM_LIST_KEYS, type ItemListKey, type ItemSource, type PrisonSpec, type SpecItem } from "@/models/spec";
import { cleanItem, isNearDuplicate } from "@/core/text/normalize";

/**
 * Item bookkeeping for a single prison. Item ids are sequential per prison ("req_3"),
 * so they are readable for the revision/critic LLMs and never collide inside the prison.
 */
export class ItemAllocator {
  constructor(private seq: number) {}

  next(list: ItemListKey): string {
    this.seq += 1;
    return `${ITEM_ID_PREFIX[list]}_${this.seq}`;
  }

  get value(): number {
    return this.seq;
  }
}

export function findItem(spec: PrisonSpec, id: string): { list: ItemListKey; item: SpecItem } | null {
  for (const list of ITEM_LIST_KEYS) {
    const item = spec[list].find((i) => i.id === id);
    if (item) return { list, item };
  }
  return null;
}

/**
 * Adds texts to a list, skipping empties and near-duplicates of items already in that list.
 * Returns the new spec, the items actually added, and the existing items a text matched instead.
 */
export function addItems(
  spec: PrisonSpec,
  list: ItemListKey,
  texts: string[],
  source: ItemSource,
  ids: ItemAllocator,
): { spec: PrisonSpec; added: SpecItem[]; matched: SpecItem[] } {
  const current = [...spec[list]];
  const added: SpecItem[] = [];
  const matched: SpecItem[] = [];
  for (const raw of texts) {
    const text = cleanItem(raw);
    if (!text) continue;
    const twin = current.find((existing) => isNearDuplicate(existing.text, text));
    if (twin) {
      if (!matched.includes(twin)) matched.push(twin);
      continue;
    }
    const item: SpecItem = { id: ids.next(list), text, source };
    current.push(item);
    added.push(item);
  }
  return { spec: { ...spec, [list]: current }, added, matched };
}

/** Re-tags items with a new source (e.g. a default the user has now stated explicitly). */
export function promoteItems(spec: PrisonSpec, list: ItemListKey, ids: ReadonlySet<string>, source: ItemSource): PrisonSpec {
  return { ...spec, [list]: spec[list].map((item) => (ids.has(item.id) ? { ...item, source } : item)) };
}

export function removeItems(spec: PrisonSpec, ids: ReadonlySet<string>): { spec: PrisonSpec; removed: SpecItem[] } {
  const removed: SpecItem[] = [];
  const next = { ...spec };
  for (const list of ITEM_LIST_KEYS) {
    const kept = spec[list].filter((item) => {
      if (ids.has(item.id)) {
        removed.push(item);
        return false;
      }
      return true;
    });
    next[list] = kept;
  }
  return { spec: next, removed };
}
