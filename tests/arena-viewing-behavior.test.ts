import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { compactCouncilEvents } from "@/models/council-events";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { SpeechQuote } from "@/ui/council-arena/SpeechQuote";
import { dwellMs, stateAt } from "@/ui/council-arena/timeline";
import { entranceFor, juryScoreText, sceneUpdateKey, viewingDwellMs } from "@/ui/council-arena/viewing";

function event(seq: number, kind: CouncilEvent["kind"], actorId: string, extra: Partial<CouncilEvent> = {}): CouncilEvent {
  return {
    seq, kind, actorId, at: "2026-10-06T14:00:00.000Z", round: 1, model: `vendor/${actorId}`,
    targetId: null, dimension: null, score: null, text: `${kind}: ${actorId}`, ...extra,
  };
}

const EVENTS: CouncilEvent[] = [
  event(0, "seat", "alpha", { round: 0 }),
  event(1, "seat", "beta", { round: 0 }),
  event(2, "thinking", "alpha"),
  event(3, "thinking", "beta"),
  event(4, "proposal", "alpha"),
  event(5, "proposal", "beta"),
  event(6, "critique", "alpha", { targetId: "beta", score: 0.8, text: "Tablo başlığı yedi veri satırından ayrı tutulmalı." }),
  event(7, "memory", "system", { model: null, text: "Önceki açıklama korunuyor." }),
  event(8, "critique", "beta", { targetId: "alpha", score: 0.9, text: "Son taslak hedefi ve çıktı biçimini koruyor." }),
];
const SEATS = "alpha:vendor/alpha|beta:vendor/beta";

describe("stable presentation of a real council moment", () => {
  it("does not restart a scene when polling returns independently parsed copies of the same result", () => {
    const polled = JSON.parse(JSON.stringify(EVENTS)) as CouncilEvent[];
    const current = EVENTS.at(-1)!;
    expect(sceneUpdateKey(stateAt(polled, polled.length - 1), polled.at(-1)!, SEATS))
      .toBe(sceneUpdateKey(stateAt(EVENTS, EVENTS.length - 1), current, SEATS));
  });

  it("keeps the same scene when completed waits expire and the current event moves to another list position", () => {
    const compacted = compactCouncilEvents(EVENTS, EVENTS.length - 2);
    expect(compacted).toHaveLength(EVENTS.length - 2);
    expect(compacted.at(-1)?.seq).toBe(EVENTS.at(-1)?.seq);
    expect(compacted.some((item) => item.kind === "thinking")).toBe(false);
    expect(sceneUpdateKey(stateAt(compacted, compacted.length - 1), compacted.at(-1)!, SEATS))
      .toBe(sceneUpdateKey(stateAt(EVENTS, EVENTS.length - 1), EVENTS.at(-1)!, SEATS));
  });

  it("does update the scene for a changed earlier jury assessment even when the current event is unchanged", () => {
    const updated = EVENTS.map((item) => item.seq === 6 ? { ...item, score: 0.95 } : item);
    const originalState = stateAt(EVENTS, EVENTS.length - 1);
    const updatedState = stateAt(updated, updated.length - 1);
    expect(updated.at(-1)).toBe(EVENTS.at(-1));
    expect(updatedState.health.beta).not.toBe(originalState.health.beta);
    expect(sceneUpdateKey(updatedState, updated.at(-1)!, SEATS))
      .not.toBe(sceneUpdateKey(originalState, EVENTS.at(-1)!, SEATS));
  });

  it("does not discard a corrected public excerpt or a changed model identity", () => {
    const current = EVENTS.at(-1)!;
    const state = stateAt(EVENTS, EVENTS.length - 1);
    const original = sceneUpdateKey(state, current, SEATS);
    expect(sceneUpdateKey(state, { ...current, text: "Başlık dahil toplam sekiz satır gerekiyor." }, SEATS)).not.toBe(original);
    expect(sceneUpdateKey(state, current, "alpha:vendor/reserve|beta:vendor/beta")).not.toBe(original);
  });

  it("varies entrances across recorded moments without mutating their text, verdict or score", () => {
    const copy = JSON.parse(JSON.stringify(EVENTS)) as CouncilEvent[];
    const firstViewing = copy.map(entranceFor);
    expect(new Set(firstViewing).size).toBeGreaterThan(1);
    expect(copy.map(entranceFor)).toEqual(firstViewing);
    expect(copy).toEqual(EVENTS);
  });
});

describe("honest viewing tempo and jury feedback", () => {
  it("preserves ordinary playback and never shortens any event when extra reading time is enabled", () => {
    const kinds: CouncilEvent["kind"][] = [
      "seat", "thinking", "research", "proposal", "critique", "weapon", "revision", "draft", "approval",
      "objection", "winner", "finalist", "failed", "abstained", "memory", "replace", "eliminated",
    ];
    for (const kind of kinds) {
      const moment = event(1, kind, "alpha", { text: "Günlük içerik planı menüye, hedef kitleye ve belirtilen çıktı biçimine uygun olmalı." });
      expect(viewingDwellMs(moment, false)).toBe(dwellMs(moment));
      expect(viewingDwellMs(moment, true)).toBeGreaterThanOrEqual(dwellMs(moment));
    }
  });

  it("gives a dense real excerpt more reading time while keeping arrival and waiting cues brief", () => {
    const text = "Yedi veri satırı, başlık, hedef kitle, ton, ürünler ve görsel önerileri birbirleriyle tutarlı kalmalı. ".repeat(2);
    const critique = event(1, "critique", "alpha", { text });
    expect(viewingDwellMs(critique, true)).toBeGreaterThan(viewingDwellMs(critique, false));
    for (const kind of ["seat", "thinking", "weapon"] as const) {
      const cue = event(1, kind, "alpha", { text });
      expect(viewingDwellMs(cue, true)).toBe(dwellMs(cue));
    }
  });

  it("bounds reading time for empty and unexpectedly huge stored excerpts", () => {
    for (const text of ["", "   ", "Sözcük ".repeat(20000)]) {
      const time = viewingDwellMs(event(1, "proposal", "alpha", { text }), true);
      expect(Number.isFinite(time)).toBe(true);
      expect(time).toBeGreaterThan(0);
      expect(time).toBeLessThanOrEqual(14000);
    }
  });

  it("shows jury scores as assessments, never as damage deducted from health", () => {
    expect(juryScoreText(0.9)).toBe("90/100");
    expect(juryScoreText(0)).toBe("0/100");
    expect(juryScoreText(1)).toBe("100/100");
    expect(juryScoreText(0.925)).toBe("93/100");
    for (const score of [null, NaN, Infinity, -Infinity, -0.1, 1.1]) expect(juryScoreText(score)).toBeNull();
    expect(juryScoreText(0.9)).not.toMatch(/^-\d+/u);
  });
});

describe("recorded speech and accessible viewing controls", () => {
  it.each([true, false])("keeps a single accessible complete excerpt and escapes literal model content (animate=%s)", (animate) => {
    const text = '<script>alert("kazanan")</script> & İtiraz: "Başlık yedi satıra dahil değil."';
    const html = renderToStaticMarkup(createElement(SpeechQuote, { text, animate, speed: 4 }));
    const spans = [...html.matchAll(/<span([^>]*)>([\s\S]*?)<\/span>/gu)];
    const accessible = spans.filter(([, attributes]) => !attributes.includes('aria-hidden="true"'));
    expect(spans.filter(([, attributes]) => attributes.includes('aria-hidden="true"'))).toHaveLength(1);
    expect(accessible).toHaveLength(1);
    expect(accessible[0][2]).toBe("&lt;script&gt;alert(&quot;kazanan&quot;)&lt;/script&gt; &amp; İtiraz: &quot;Başlık yedi satıra dahil değil.&quot;");
    expect(html).not.toContain("<script>");
  });

  it("offers a named keyboard range, labelled real milestones and explicit filter states on saved playback", () => {
    const events = [...EVENTS, event(9, "finalist", "alpha", { round: 2, text: "Uzlaşma sağlanmadı; bu aday son kalite denetimine gönderiliyor." })];
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode: "competition", events, live: false }));
    const range = html.match(/<input[^>]*type="range"[^>]*>/u)?.[0];
    expect(range).toBeDefined();
    expect(range).toContain('aria-label="İzleme anını seç"');
    expect(range).toContain('min="-1"');
    expect(range).toContain('max="9"');
    expect(range).toContain('step="1"');
    expect(range).toContain('aria-valuetext="Başlangıç"');
    expect(html).toContain('aria-label="Son denetime seçilen aday: alpha"');
    expect(html).not.toContain('aria-label="Final Kararı"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Tümü<\/button>/u);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>[^<]*Okuma temposu<\/button>/u);
    expect(html).toContain("Uzlaşma sağlanmadı; bu aday son kalite denetimine gönderiliyor.");
  });
});
