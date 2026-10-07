import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { I18nProvider, type UILocale } from "@/ui/i18n";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { kindLabel, weaponName } from "@/ui/council-arena/timeline";
import { quoteRevealBoundaries } from "@/ui/council-arena/SpeechQuote";

const EVENTS: CouncilEvent[] = [
  { seq: 0, at: "2026-10-07T12:00:00Z", round: 0, kind: "seat", actorId: "alpha", model: "vendor/Alpha", targetId: null, dimension: null, score: null, text: "模型自定义角色 · user role" },
  { seq: 1, at: "2026-10-07T12:00:01Z", round: 1, kind: "proposal", actorId: "alpha", model: "vendor/Alpha", targetId: null, dimension: null, score: null, text: "原始提案 · özgün öneri <keep this>" },
  { seq: 2, at: "2026-10-07T12:00:02Z", round: 1, kind: "weapon", actorId: "alpha", model: "vendor/Alpha", targetId: null, dimension: "intent_alignment", score: 0.8, text: "Recorded equipment award" },
  { seq: 3, at: "2026-10-07T12:00:03Z", round: 2, kind: "finalist", actorId: "alpha", model: "vendor/Alpha", targetId: null, dimension: null, score: null, text: "Final review remains necessary" },
];

function renderArena(locale: UILocale, mode: "competition" | "collaboration") {
  return renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale },
    createElement(CouncilArena, { mode, events: EVENTS, live: false, promptReady: false })));
}

describe("automatic stage movements and localized replay", () => {
  it.each([
    ["tr", "Kapışma arenası", "Baştan izle", "otomatik seçilir", "Kılıç · amaç uyumu"],
    ["en", "Competition arena", "Watch from the start", "selected automatically", "Sword · goal alignment"],
    ["zh", "竞技场", "从头观看", "自动选择", "剑 · 目标一致性"],
  ] as const)("renders %s replay controls without letting viewers select animations", (locale, arena, replay, automatic, equipment) => {
    const before = structuredClone(EVENTS);
    const html = renderArena(locale, "competition");
    expect(html).toContain(arena);
    expect(html).toContain(replay);
    expect(html).toContain(automatic);
    expect(html).toContain(equipment);
    expect(html).toContain('type="range"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Hareketi göster");
    expect(html).not.toContain("Senin hareket isteğin");
    expect(html).not.toContain("onMotion");
    expect(html).toContain("原始提案 · özgün öneri &lt;keep this&gt;");
    expect(html).toContain("Final review remains necessary");
    expect(EVENTS).toEqual(before);
  });

  it.each([
    ["tr", "Tartışma masası", "İlk öneri", "Uzlaşma", "Kazanan"],
    ["en", "Discussion table", "First proposal", "Consensus", "Winner"],
    ["zh", "讨论桌", "初次提案", "达成共识", "胜出者"],
  ] as const)("keeps %s table collaboration labels distinct from competition", (locale, table, proposal, consensus, winner) => {
    const html = renderArena(locale, "collaboration");
    expect(html).toContain(table);
    expect(html).toContain(proposal);
    expect(kindLabel("winner", "collaboration", locale)).toBe(consensus);
    expect(kindLabel("winner", "competition", locale)).toBe(winner);
    expect(kindLabel("seat", "single", locale)).toBe(kindLabel("seat", "collaboration", locale));
    expect(weaponName("intent_alignment", locale)).not.toBe("");
  });
});

describe("recorded quote reveal units", () => {
  it("reveals unspaced Chinese in short groups without losing or changing any characters", () => {
    const text = "模型需要结合用户目标生成清晰可执行的提示词。再检查结果。";
    const boundaries = quoteRevealBoundaries(text);
    expect(boundaries.length).toBeGreaterThan(5);
    const chunks = boundaries.map((end, index) => text.slice(boundaries[index - 1] ?? 0, end));
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => [...chunk].length <= 4)).toBe(true);
    expect(boundaries.at(-1)).toBe(text.length);
  });

  it.each(["Hedefi anla, sonra öneriyi açıkla.\n", "Read the goal, then explain the proposal.  "])("retains spaced language word boundaries for %s", (text) => {
    const existing = [...text.matchAll(/\S+\s*/gu)].map((match) => match.index + match[0].length);
    expect(quoteRevealBoundaries(text)).toEqual(existing);
  });

  it("preserves mixed text, whitespace and emoji through complete prefix slices", () => {
    const text = "  中文目标：🛩️ airplane model\nTürkçe yönerge";
    const boundaries = quoteRevealBoundaries(text);
    expect(boundaries.at(-1)).toBe(text.length);
    expect(boundaries.map((end, index) => text.slice(boundaries[index - 1] ?? 0, end)).join("")).toBe(text);
    expect(quoteRevealBoundaries("")).toEqual([]);
  });
});
