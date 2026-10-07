import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearComposerDraft,
  COMPOSER_DRAFT_KEY,
  COMPOSER_TEXT_LIMIT,
  DEFAULT_COMPOSER_DRAFT,
  getComposerDraftStorage,
  readComposerDraft,
  saveComposerDraft,
  toComposerInput,
  type ComposerDraft,
  type DraftStorage,
} from "@/ui/lib/composer-draft";

class MemoryStorage implements DraftStorage {
  private readonly entries = new Map<string, string>();
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
}

const draft: ComposerDraft = {
  text: "  Mevcut ödeme sistemine test ekle.  ",
  target: "codex",
  language: "en",
  mode: "jb",
  executionContext: "chat",
  councilMode: "competition",
};

afterEach(() => vi.unstubAllGlobals());

describe("composer draft recovery", () => {
  it("uses fresh defaults for first use or unavailable storage", () => {
    const storage = new MemoryStorage();
    const initial = readComposerDraft(storage);
    expect(initial).toEqual({ text: "", target: "auto", language: "tr", mode: "auto", executionContext: "chat", councilMode: "competition" });
    expect(readComposerDraft(null)).toEqual(DEFAULT_COMPOSER_DRAFT);
    initial.text = "Unsubmitted edit";
    expect(readComposerDraft(storage).text).toBe("");
  });

  it("recovers the complete interrupted draft without modifying or deleting it", () => {
    const storage = new MemoryStorage();
    expect(saveComposerDraft(storage, draft)).toBe(true);
    const saved = storage.getItem(COMPOSER_DRAFT_KEY);
    expect(readComposerDraft(storage)).toEqual(draft);
    expect(readComposerDraft(storage)).toEqual(draft);
    expect(storage.getItem(COMPOSER_DRAFT_KEY)).toBe(saved);
  });

  it("recovers older drafts with default table settings without overwriting stored text", () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({ text: draft.text, target: draft.target, language: draft.language, mode: draft.mode });
    storage.setItem(COMPOSER_DRAFT_KEY, legacy);
    expect(readComposerDraft(storage)).toEqual(draft);
    expect(storage.getItem(COMPOSER_DRAFT_KEY)).toBe(legacy);
  });

  it("preserves the chosen execution environment and team workflow across recovery", () => {
    const storage = new MemoryStorage();
    const selected: ComposerDraft = { ...draft, executionContext: "browser", councilMode: "collaboration" };
    expect(saveComposerDraft(storage, selected)).toBe(true);
    const recovered = readComposerDraft(storage);
    expect(recovered).toEqual(selected);
    expect(toComposerInput(recovered)).toMatchObject({ executionContext: "browser", councilMode: "collaboration" });
  });

  it.each([
    ["invalid JSON", "{broken"],
    ["null", "null"],
    ["array", "[]"],
    ["missing fields", JSON.stringify({ text: "unfinished" })],
    ["wrong text type", JSON.stringify({ ...draft, text: 100 })],
    ["oversized text", JSON.stringify({ ...draft, text: "a".repeat(COMPOSER_TEXT_LIMIT + 1) })],
    ["invalid target", JSON.stringify({ ...draft, target: "unsupported-ai" })],
    ["invalid language", JSON.stringify({ ...draft, language: "de" })],
    ["invalid mode", JSON.stringify({ ...draft, mode: true })],
    ["invalid environment", JSON.stringify({ ...draft, executionContext: "unrestricted" })],
    ["invalid table workflow", JSON.stringify({ ...draft, councilMode: "fake-results" })],
    ["unexpected fields", JSON.stringify({ ...draft, accessToken: "unused-test-value" })],
  ])("ignores corrupt or unsupported saved data: %s", (_label, raw) => {
    const storage = new MemoryStorage();
    storage.setItem(COMPOSER_DRAFT_KEY, raw);
    expect(readComposerDraft(storage)).toEqual(DEFAULT_COMPOSER_DRAFT);
  });

  it("accepts the full text limit and refuses to overwrite a good draft with oversized text", () => {
    const storage = new MemoryStorage();
    const maximum = { ...draft, text: "a".repeat(COMPOSER_TEXT_LIMIT) };
    expect(saveComposerDraft(storage, maximum)).toBe(true);
    expect(readComposerDraft(storage).text).toHaveLength(COMPOSER_TEXT_LIMIT);
    expect(saveComposerDraft(storage, { ...draft, text: "b".repeat(COMPOSER_TEXT_LIMIT + 1) })).toBe(false);
    expect(readComposerDraft(storage)).toEqual(maximum);
  });

  it("survives storage read, write, and delete failures", () => {
    const blocked = {
      getItem: () => { throw new Error("Storage blocked"); },
      setItem: () => { throw new Error("Storage full"); },
      removeItem: () => { throw new Error("Storage blocked"); },
    };
    expect(readComposerDraft(blocked)).toEqual(DEFAULT_COMPOSER_DRAFT);
    expect(saveComposerDraft(blocked, draft)).toBe(false);
    expect(clearComposerDraft(blocked)).toBe(false);
    expect(saveComposerDraft(null, draft)).toBe(false);
    expect(clearComposerDraft(null)).toBe(false);
  });

  it("survives browser storage acquisition failures and server-side rendering", () => {
    expect(getComposerDraftStorage()).toBeNull();
    const blockedWindow = Object.defineProperty({}, "localStorage", { get() { throw new Error("Storage denied"); } });
    vi.stubGlobal("window", blockedWindow);
    expect(getComposerDraftStorage()).toBeNull();
  });

  it("clears saved draft text and settings when explicitly acknowledged as successful", () => {
    const storage = new MemoryStorage();
    saveComposerDraft(storage, draft);
    expect(clearComposerDraft(storage)).toBe(true);
    expect(storage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(readComposerDraft(storage)).toEqual(DEFAULT_COMPOSER_DRAFT);
  });
});

describe("prompt mode selection", () => {
  it("omits an override in automatic mode so request interpretation remains active", () => {
    const input = toComposerInput({ ...draft, mode: "auto" });
    expect(input).toEqual({ rawRequest: draft.text.trim(), targetAI: "codex", language: "en", executionContext: "chat", councilMode: "competition" });
    expect(input).not.toHaveProperty("jailbreakMode");
  });

  it("explicitly disables JB when standard mode is selected, even for JB text", () => {
    expect(toComposerInput({ ...draft, text: "JB modu ile ayrıntılı prompt hazırla", mode: "standard" })).toMatchObject({ jailbreakMode: false });
  });

  it("explicitly enables JB when JB mode is selected, even without a JB keyword", () => {
    expect(toComposerInput(draft)).toMatchObject({ rawRequest: draft.text.trim(), jailbreakMode: true });
  });
});
