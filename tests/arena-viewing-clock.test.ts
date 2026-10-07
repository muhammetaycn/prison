import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { compactCouncilEvents } from "@/models/council-events";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { dwellMs } from "@/ui/council-arena/timeline";

interface HookHost {
  state(initial: unknown): [unknown, (value: unknown) => void];
  ref(initial: unknown): { current: unknown };
  memo(factory: () => unknown, dependencies?: readonly unknown[]): unknown;
  effect(callback: () => void | (() => void), dependencies?: readonly unknown[]): void;
}

const hookRuntime = vi.hoisted(() => ({ active: null as HookHost | null }));
// This clock harness invokes the component directly; locale rendering is covered by real React SSR tests.
vi.mock("@/ui/i18n", () => {
  const t = (tr: string) => tr;
  return { useI18n: () => ({ locale: "tr", t, setLocale: () => {} }) };
});
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const host = () => {
    if (!hookRuntime.active) throw new Error("No mounted hook host");
    return hookRuntime.active;
  };
  return {
    ...actual,
    useState: (initial: unknown) => host().state(initial),
    useRef: (initial: unknown) => host().ref(initial),
    useMemo: (factory: () => unknown, dependencies?: readonly unknown[]) => host().memo(factory, dependencies),
    useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => host().effect(callback, dependencies),
  };
});

interface HookSlot {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
  setter?: (value: unknown) => void;
}

function dependenciesChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  return !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

/** Commits the real component's hooks; stage refs stay null, so no browser or WebGL is simulated. */
class MountedArena implements HookHost {
  private slots: HookSlot[] = [];
  private cursor = 0;
  private dirty = false;
  private pending: Array<() => void> = [];
  private props: Parameters<typeof CouncilArena>[0];
  tree: ReactNode;

  constructor(events: CouncilEvent[], live = true) {
    this.props = { events, live, mode: "competition" };
    this.tree = null;
    this.render();
  }

  state(initial: unknown): [unknown, (value: unknown) => void] {
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot) {
      slot = { value: typeof initial === "function" ? initial() : initial };
      this.slots[index] = slot;
    }
    slot.setter ??= (value: unknown) => {
      const next = typeof value === "function" ? value(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
    };
    return [slot.value, slot.setter];
  }

  ref(initial: unknown): { current: unknown } {
    const index = this.cursor++;
    this.slots[index] ??= { value: { current: initial } };
    return this.slots[index].value as { current: unknown };
  }

  memo(factory: () => unknown, dependencies?: readonly unknown[]): unknown {
    const index = this.cursor++;
    const old = this.slots[index];
    if (!old || dependenciesChanged(old.dependencies, dependencies)) this.slots[index] = { value: factory(), dependencies };
    return this.slots[index].value;
  }

  effect(callback: () => void | (() => void), dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const old = this.slots[index];
    if (!old || dependenciesChanged(old.dependencies, dependencies)) {
      const next: HookSlot = { dependencies };
      this.slots[index] = next;
      this.pending.push(() => { old?.cleanup?.(); const cleanup = callback(); if (cleanup) next.cleanup = cleanup; });
    }
  }

  private render() {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error("Unexpected render loop");
      this.cursor = 0;
      this.dirty = false;
      this.pending = [];
      hookRuntime.active = this;
      try { this.tree = CouncilArena(this.props); }
      finally { hookRuntime.active = null; }
      for (const commit of this.pending) commit();
    } while (this.dirty);
  }

  poll(events: CouncilEvent[]) { this.props = { ...this.props, events }; this.render(); }
  advance(milliseconds: number) { vi.advanceTimersByTime(milliseconds); if (this.dirty) this.render(); }
  click(label: string) {
    const element = find(this.tree, (type, props) => type === "button" && (props["aria-label"] === label || textOf(props.children as ReactNode) === label));
    if (!element || typeof element.props.onClick !== "function") throw new Error(`Missing button ${label}`);
    element.props.onClick();
    if (this.dirty) this.render();
  }
  get index(): number {
    const element = find(this.tree, (type, props) => type === "input" && props.type === "range");
    if (!element) throw new Error("Missing accessible timeline range");
    return element.props.value as number;
  }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

function find(node: ReactNode, matches: (type: unknown, props: Record<string, unknown>) => boolean): { props: Record<string, unknown> } | null {
  if (isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) {
    if (matches(node.type, node.props)) return node;
    return find(node.props.children, matches);
  }
  for (const child of Children.toArray(node)) {
    if (child === node) continue;
    const found = find(child, matches);
    if (found) return found;
  }
  return null;
}

function event(seq: number, kind: CouncilEvent["kind"], actorId: string, extra: Partial<CouncilEvent> = {}): CouncilEvent {
  return { seq, kind, actorId, at: "2026-10-06T15:00:00.000Z", round: kind === "seat" ? 0 : 1,
    model: `vendor/${actorId}`, targetId: null, dimension: null, score: null, text: `${kind} ${actorId}`, ...extra };
}
const PROPOSAL = event(2, "proposal", "alpha", {
  text: "Yedi veri satırı, tablo başlığı, menü, hedef kitle, metin ve görsel önerileri kullanıcının istediği biçimde hazırlanmalı. ".repeat(3).slice(0, 280),
});
const INITIAL = [event(0, "seat", "alpha"), event(1, "seat", "beta"), PROPOSAL,
  event(3, "critique", "beta", { targetId: "alpha", score: 0.9, text: "Veri satırı sayısını koru." })];
const copy = (events: CouncilEvent[]) => JSON.parse(JSON.stringify(events)) as CouncilEvent[];
const mounted: MountedArena[] = [];

function startAtProposal(events = INITIAL): MountedArena {
  const arena = new MountedArena(copy(events));
  mounted.push(arena);
  arena.advance(400);
  arena.advance(dwellMs(events[0]));
  arena.advance(dwellMs(events[1]));
  expect(arena.index).toBe(2);
  return arena;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  for (const arena of mounted.splice(0)) arena.dispose();
  hookRuntime.active = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the real CouncilArena playback clock across live polls", () => {
  it("advances on the original deadline despite independently parsed two-second polls", () => {
    const arena = startAtProposal();
    const wait = dwellMs(PROPOSAL);
    arena.advance(2000);
    arena.poll(copy(INITIAL));
    arena.advance(2000);
    arena.poll(copy(INITIAL));
    arena.advance(wait - 4001);
    expect(arena.index).toBe(2);
    arena.advance(1);
    expect(arena.index).toBe(3);
  });

  it("does not postpone the current deadline as real later events arrive behind its already scheduled next step", () => {
    const arena = startAtProposal();
    const later = [...INITIAL, event(4, "revision", "alpha", { round: 2 }), event(5, "thinking", "beta", { round: 2 })];
    arena.advance(2000);
    arena.poll(copy(later.slice(0, -1)));
    arena.advance(2000);
    arena.poll(copy(later));
    arena.advance(dwellMs(PROPOSAL) - 4000);
    expect(arena.index).toBe(3);
  });

  it("keeps the current deadline when completed waits disappear and shift its list index", () => {
    const events = [INITIAL[0], INITIAL[1], event(2, "thinking", "alpha"), event(3, "thinking", "beta"),
      { ...PROPOSAL, seq: 4 }, event(5, "proposal", "beta"), event(6, "critique", "alpha", { targetId: "beta", score: 0.8 })];
    const arena = new MountedArena(copy(events));
    mounted.push(arena);
    arena.advance(400);
    for (const moment of events.slice(0, 4)) arena.advance(dwellMs(moment));
    expect(arena.index).toBe(4);
    arena.advance(1000);
    const compacted = compactCouncilEvents(copy(events), events.length - 2);
    expect(compacted.map((moment) => moment.seq)).toEqual([0, 1, 4, 5, 6]);
    arena.poll(compacted);
    expect(arena.index).toBe(2);
    arena.advance(dwellMs(PROPOSAL) - 1001);
    expect(arena.index).toBe(2);
    arena.advance(1);
    expect(arena.index).toBe(3);
  });

  it("waits without a ticking timer at the live tail, then resumes when a new real event arrives", () => {
    const tail = INITIAL.slice(0, 3);
    const arena = startAtProposal(tail);
    expect(vi.getTimerCount()).toBe(0);
    arena.advance(30000);
    arena.poll(copy(tail));
    expect(arena.index).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    arena.poll(copy(INITIAL));
    expect(vi.getTimerCount()).toBe(1);
    arena.advance(dwellMs(PROPOSAL));
    expect(arena.index).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending advance when paused, stays paused across polls, and resumes through the actual controls", () => {
    const arena = startAtProposal();
    arena.advance(1000);
    arena.click("Duraklat");
    expect(vi.getTimerCount()).toBe(0);
    arena.poll(copy(INITIAL));
    arena.advance(30000);
    expect(arena.index).toBe(2);
    arena.click("Oynat");
    expect(vi.getTimerCount()).toBe(1);
    arena.advance(dwellMs(PROPOSAL) - 1);
    expect(arena.index).toBe(2);
    arena.advance(1);
    expect(arena.index).toBe(3);
  });

  it("applies a speed change to the pending interval without waiting for another server event", () => {
    const arena = startAtProposal();
    arena.advance(500);
    arena.click("4x");
    arena.advance(dwellMs(PROPOSAL) / 4 - 1);
    expect(arena.index).toBe(2);
    arena.advance(1);
    expect(arena.index).toBe(3);
  });
});
