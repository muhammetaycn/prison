import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COUNCIL_EVENT_LIMIT, type CouncilEvent } from "@/models/council";
import { compactCouncilEvents, councilEventIndexAtSeq, councilEventSeqAtIndex, isNextCouncilEvent, nextCouncilEventSeq } from "@/models/council-events";
import type { OperationProgress } from "@/models/operation-progress";
import { PrisonSchema, summarizePrison, type Prison } from "@/models/prison";
import type { PipelineDeps } from "@/core/pipeline/compile";
import { PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { seatsFrom, stateAt } from "@/ui/council-arena/timeline";

const pipeline = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/core/pipeline/compile", () => ({ runCompilePipeline: pipeline.run }));

function event(seq: number, kind: CouncilEvent["kind"] = "critique", actorId = "a", extra: Partial<CouncilEvent> = {}): CouncilEvent {
  return { seq, at: "2026-10-04T12:00:00.000Z", round: 1, kind, actorId, model: `vendor/${actorId}`, targetId: "b", dimension: null, score: 0.9, text: `Actual public output ${seq}`, ...extra };
}

function longFeed(): CouncilEvent[] {
  const seats = ["a", "b", "c", "d", "e", "f"].map((id, index) => event(index, "seat", id, { round: 0, text: `Expert ${id}` }));
  return [...seats, event(6, "eliminated", "f"), event(7, "weapon", "a", { dimension: "intent_alignment" }), event(8, "memory", "system"),
    ...Array.from({ length: 750 }, (_, index) => event(index + 9)), event(759, "thinking", "b")];
}

describe("bounded council event history", () => {
  it("preserves provisional selection when later editorial events expire its position", () => {
    const events = [event(0, "seat", "a"), event(1, "seat", "b"), event(2, "thinking", "b"),
      event(3, "finalist", "b"), ...Array.from({ length: 20 }, (_, index) => event(index + 4))];
    const compacted = compactCouncilEvents(events, 8);
    expect(compacted).toContain(events[3]);
    expect(compacted).not.toContain(events[2]);
    expect(stateAt(compacted, 7)).toMatchObject({ finalist: "b", winner: null, thinking: [] });
  });
  it("removes a completed wait before spoken output and preserves a pending actor", () => {
    const events = [event(0, "seat", "a"), event(1, "seat", "b"), event(2, "thinking", "a"), event(3, "proposal", "a"),
      event(4, "thinking", "b"), ...Array.from({ length: 5 }, (_, index) => event(index + 5))];
    const compacted = compactCouncilEvents(events, 9);
    expect(compacted).toHaveLength(9);
    expect(compacted.map((entry) => entry.seq)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9]);
    expect(stateAt(compacted, compacted.length - 1).thinking).toEqual(["b"]);
    expect(compacted.find((entry) => entry.seq === 3)).toBe(events[3]);
  });

  it("keeps the original six seats and durable decisions after a spoken feed exceeds the limit", () => {
    const events = longFeed();
    const original = structuredClone(events);
    const compacted = compactCouncilEvents(events);
    expect(compacted).toHaveLength(COUNCIL_EVENT_LIMIT);
    expect(seatsFrom(compacted)).toEqual(seatsFrom(events));
    expect(compacted.slice(0, 9)).toEqual(events.slice(0, 9));
    expect(compacted.at(-1)).toBe(events.at(-1));
    expect(stateAt(compacted, compacted.length - 1)).toMatchObject({ eliminated: ["f"], weapons: { intent_alignment: "a" }, memory: true, thinking: ["b"] });
    expect(compacted.every((entry) => events.includes(entry))).toBe(true);
    expect(compacted.map((entry) => entry.seq)).toEqual([...compacted.map((entry) => entry.seq)].sort((a, b) => a - b));
    expect(events).toEqual(original);
    expect(compactCouncilEvents(compacted)).toBe(compacted);
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode: "competition", events: compacted, live: true }));
    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(html).toContain(`vendor/${id}`);
  });

  it("retains replacements and the latest weapon owner without inventing summaries", () => {
    const events = [event(0, "seat", "a"), event(1, "seat", "b"), event(2, "weapon", "a", { dimension: "output_clarity" }),
      event(3, "replace", "b", { text: "A real reserve replaced the unavailable model" }), event(4, "weapon", "b", { dimension: "output_clarity" }),
      ...Array.from({ length: 20 }, (_, index) => event(index + 5)), event(25, "winner", "b")];
    const compacted = compactCouncilEvents(events, 8);
    expect(compacted).toHaveLength(8);
    expect(compacted).toContain(events[3]);
    expect(compacted).toContain(events[4]);
    expect(compacted).toContain(events[25]);
    expect(stateAt(compacted, 7)).toMatchObject({ winner: "b", weapons: { output_clarity: "b" } });
    expect(compacted.every((entry) => events.includes(entry))).toBe(true);
  });
});

describe("stable sequence playback", () => {
  it("keeps the same selected event when earlier array positions expire", () => {
    const before = longFeed();
    const selected = before[650]!;
    const after = compactCouncilEvents(before);
    const newIndex = councilEventIndexAtSeq(after, selected.seq);
    expect(newIndex).toBeLessThan(650);
    expect(after[newIndex]).toBe(selected);
    expect(isNextCouncilEvent(after, selected.seq, selected.seq)).toBe(false);
    expect(nextCouncilEventSeq(after, selected.seq)).toBe(after[newIndex + 1]!.seq);
    expect(isNextCouncilEvent(after, selected.seq, after[newIndex + 1]!.seq)).toBe(true);
  });

  it("advances from an expired cursor to the next retained event, and supports explicit start/end jumps", () => {
    const events = [event(0, "seat"), event(5, "seat", "b"), event(100), event(102), event(109, "winner")];
    const index = councilEventIndexAtSeq(events, 80);
    expect(index).toBe(1);
    expect(nextCouncilEventSeq(events, 80)).toBe(100);
    expect(isNextCouncilEvent(events, 80, 100)).toBe(true);
    expect(councilEventSeqAtIndex(events, -1)).toBe(-1);
    expect(nextCouncilEventSeq(events, -1)).toBe(0);
    expect(councilEventSeqAtIndex(events, events.length - 1)).toBe(109);
    expect(nextCouncilEventSeq(events, 109)).toBe(109);
    expect(councilEventIndexAtSeq([], 10)).toBe(-1);
  });
});

class MemoryRepository implements PrisonRepository {
  private readonly records = new Map<string, Prison>();
  async list() { return [...this.records.values()].map(summarizePrison); }
  async get(id: string) { return structuredClone(this.records.get(id) ?? null); }
  async save(prison: Prison) { this.records.set(prison.id, PrisonSchema.parse(structuredClone(prison))); }
  async delete(id: string) { return this.records.delete(id); }
}

describe("service live history", () => {
  beforeEach(() => { pipeline.run.mockReset(); });

  it("uses the same bounded history during live progress and preserves sequence across a repair run", async () => {
    const service = new PrisonService(new MemoryRepository(), null);
    const prison = await service.analyze({ rawRequest: "Compare payment approaches without changing files", language: "en", targetAI: "gpt" });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let emitted!: () => void;
    const published = new Promise<void>((resolve) => { emitted = resolve; });
    const source = longFeed();
    pipeline.run.mockImplementation(async (input: Prison, _request: unknown, deps: PipelineDeps) => {
      deps.onProgress?.({ stage: "peer_review", completed: 0, total: 6, message: "Council running" });
      for (const entry of source) deps.onCouncilEvent?.(entry);
      // Older repair producers can restart numbering; the service still keeps one monotonic live sequence.
      deps.onCouncilEvent?.(event(0, "revision", "b"));
      deps.onProgress?.({ stage: "validation", completed: 1, total: 1, message: "Reviewing final text" });
      emitted();
      await hold;
      return input;
    });
    const running = service.compile(prison.id);
    await published;
    let progress: OperationProgress | null;
    try { progress = await service.getProgress(prison.id); }
    finally { release(); await running; }
    expect(progress!.events).toHaveLength(COUNCIL_EVENT_LIMIT);
    expect(seatsFrom(progress!.events!)).toEqual(seatsFrom(source));
    expect(progress!.events!.at(-1)).toMatchObject({ seq: 760, kind: "revision", actorId: "b" });
    expect(new Set(progress!.events!.map((entry) => entry.seq)).size).toBe(COUNCIL_EVENT_LIMIT);
    expect(progress!.stage).toBe("validation");
    expect(await service.getProgress(prison.id)).toBeNull();
  });
});
