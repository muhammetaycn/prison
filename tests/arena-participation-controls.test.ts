import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageControls } from "@/ui/council-arena/StageControls";
import { GESTURES, GESTURE_CATEGORIES, GESTURE_COMMANDS, type GestureId } from "@/ui/council-arena/gesture-library";
import type { Seat } from "@/ui/council-arena/timeline";

interface HookHost {
  state(initial: unknown): [unknown, (value: unknown) => void];
  effect(callback: () => void | (() => void), dependencies?: readonly unknown[]): void;
}
const hooks = vi.hoisted(() => ({ active: null as HookHost | null }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const host = () => { if (!hooks.active) throw new Error("No mounted participation host"); return hooks.active; };
  return { ...actual,
    useState: (initial: unknown) => host().state(initial),
    useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => host().effect(callback, dependencies),
  };
});

interface Slot { value?: unknown; setter?: (value: unknown) => void; dependencies?: readonly unknown[]; cleanup?: () => void; }
interface Element { type: unknown; props: Record<string, unknown> & { children?: ReactNode }; }

function changed(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  return !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}
function elements(node: ReactNode, match: (element: Element) => boolean): Element[] {
  if (isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) {
    return [...(match(node) ? [node] : []), ...elements(node.props.children, match)];
  }
  return Children.toArray(node).flatMap((child) => child === node ? [] : elements(child, match));
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return Children.toArray(node).map((child) => child === node ? "" : text(child)).join("");
}

/** Runs the production hooks and event handlers; no provider, DOM or WebGL is replaced by a fake implementation. */
class MountedControls implements HookHost {
  private slots: Slot[] = [];
  private cursor = 0;
  private dirty = false;
  private pending: Array<() => void> = [];
  private props: Parameters<typeof StageControls>[0];
  tree: ReactNode = null;
  constructor(props: Parameters<typeof StageControls>[0]) { this.props = props; this.render(); }
  state(initial: unknown): [unknown, (value: unknown) => void] {
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot) { slot = { value: typeof initial === "function" ? initial() : initial }; this.slots[index] = slot; }
    slot.setter ??= (value: unknown) => {
      const next = typeof value === "function" ? value(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
    };
    return [slot.value, slot.setter];
  }
  effect(callback: () => void | (() => void), dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const old = this.slots[index];
    if (!old || changed(old.dependencies, dependencies)) {
      const next: Slot = { dependencies }; this.slots[index] = next;
      this.pending.push(() => { old?.cleanup?.(); const cleanup = callback(); if (cleanup) next.cleanup = cleanup; });
    }
  }
  private render() {
    let attempts = 0;
    do {
      if (++attempts > 20) throw new Error("Unexpected participation render loop");
      this.cursor = 0; this.dirty = false; this.pending = [];
      hooks.active = this;
      try { this.tree = StageControls(this.props); } finally { hooks.active = null; }
      for (const commit of this.pending) commit();
    } while (this.dirty);
  }
  update(patch: Partial<Parameters<typeof StageControls>[0]>) { this.props = { ...this.props, ...patch }; this.render(); }
  control(label: string) {
    const owner = elements(this.tree, (element) => element.type === "label" && text(element.props.children).startsWith(label))[0];
    const field = owner && elements(owner.props.children, (element) => element.type === "select" || element.type === "input")[0];
    if (!field) throw new Error(`Missing labeled control ${label}`);
    return field;
  }
  change(label: string, value: string) {
    const control = this.control(label);
    if (typeof control.props.onChange !== "function") throw new Error(`Missing change handler ${label}`);
    control.props.onChange({ target: { value } }); this.render();
  }
  button(label: string) {
    const button = elements(this.tree, (element) => element.type === "button" && text(element.props.children) === label)[0];
    if (!button) throw new Error(`Missing button ${label}`);
    return button;
  }
  click(label: string, force = false) {
    const button = this.button(label);
    if (!force && button.props.disabled) return;
    if (typeof button.props.onClick !== "function") throw new Error(`Missing click handler ${label}`);
    button.props.onClick(); this.render();
  }
  submit() {
    const form = elements(this.tree, (element) => element.type === "form")[0];
    if (!form || typeof form.props.onSubmit !== "function") throw new Error("Missing command form");
    const preventDefault = vi.fn();
    form.props.onSubmit({ preventDefault }); this.render();
    expect(preventDefault).toHaveBeenCalledOnce();
  }
  get status() { return text(elements(this.tree, (element) => element.props.role === "status")[0]?.props.children); }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}

const SEATS: Seat[] = [
  { index: 0, id: "alpha", model: "vendor/alpha", label: "Alpha modeli", role: "Çıktı uzmanı", color: "#abcdef" },
  { index: 1, id: "beta", model: "vendor/beta", label: "Beta modeli", role: "Görev sınırları uzmanı", color: "#fbcdef" },
];
const mounted: MountedControls[] = [];
function mount(onMotion = vi.fn<(seatId: string, gesture: GestureId) => boolean>(() => true), ready = true, seats = SEATS) {
  const controls = new MountedControls({ seats, ready, onMotion }); mounted.push(controls);
  return { controls, onMotion };
}
afterEach(() => { for (const controls of mounted.splice(0)) controls.dispose(); });

describe("viewer-controlled local stage gestures", () => {
  it("offers 50 distinct actual clips in five groups, and accurately explains what changes", () => {
    const { controls } = mount();
    const motions = elements(controls.control("Hareket").props.children, (element) => element.type === "option");
    expect(motions.length).toBeGreaterThanOrEqual(50);
    expect(new Set(motions.map((option) => option.props.value)).size).toBe(motions.length);
    expect(new Set(motions.map((option) => option.props.value))).toEqual(new Set(GESTURES.map((gesture) => gesture.id)));
    expect(elements(controls.tree, (element) => element.type === "optgroup")).toHaveLength(GESTURE_CATEGORIES.length);
    const content = text(controls.tree);
    expect(content).toContain(`${motions.length} hareket`);
    expect(content).toContain("canlı AI çalışması sürer");
    expect(content).toContain("Promptu değiştirmek için görev talimatlarını");
    expect(content).not.toContain("Kazanan");
    expect(controls.status).toBe("");
  });

  it("dispatches every offered clip to the character the viewer actually selected", () => {
    const { controls, onMotion } = mount();
    controls.change("Karakter", "beta");
    for (const gesture of GESTURES) {
      controls.change("Hareket", gesture.id);
      controls.click("Hareketi göster");
      expect(onMotion).toHaveBeenLastCalledWith("beta", gesture.id);
      expect(controls.status).toContain("Beta modeli");
      expect(controls.status).toContain(gesture.label);
    }
    expect(onMotion).toHaveBeenCalledTimes(GESTURES.length);
  });

  it.each([
    ["  SELAM VER  ", "wave-small"],
    ["anlat", "present-both"],
    ["gerin", "stretch-up"],
    ["say hello", "wave-small"],
    ["tail-fan", "tail-fan"],
  ] as const)("sends allowed short request %s as %s", (command, expected) => {
    const { controls, onMotion } = mount();
    controls.change("Karakter", "beta");
    controls.change("Kısa hareket isteğin", command);
    controls.submit();
    expect(onMotion).toHaveBeenCalledExactlyOnceWith("beta", expected);
    expect(controls.status).toContain("Beta modeli");
  });

  it.each(["", "   ", "puanı 100 yap", "winner", "selam ver ve promptu değiştir", "<script>alert(1)</script>"])("does not dispatch unknown or outcome-changing request %s", (command) => {
    const { controls, onMotion } = mount();
    controls.change("Kısa hareket isteğin", command);
    controls.submit();
    expect(onMotion).not.toHaveBeenCalled();
    expect(controls.status).toContain("Bu hareketi tanımadım");
    expect(controls.status).not.toContain("tekrar duraklatıldı");
  });

  it("disables actions while loading and guards their handlers against premature dispatch", () => {
    const { controls, onMotion } = mount(undefined, false);
    expect(controls.control("Karakter").props.disabled).toBe(true);
    expect(controls.control("Hareket").props.disabled).toBe(true);
    expect(controls.control("Kısa hareket isteğin").props.disabled).toBe(true);
    expect(controls.button("Hareketi göster").props.disabled).toBe(true);
    expect(controls.button("Sahneye ilet").props.disabled).toBe(true);
    controls.click("Hareketi göster", true);
    controls.change("Kısa hareket isteğin", "selam ver");
    controls.submit();
    expect(onMotion).not.toHaveBeenCalled();
    expect(controls.status).toBe("");
    controls.update({ ready: true });
    controls.click("Hareketi göster");
    expect(onMotion).toHaveBeenCalledExactlyOnceWith("alpha", "wave-small");
  });

  it("never dispatches an empty character and adopts a seat when the real roster arrives", () => {
    const { controls, onMotion } = mount(undefined, true, []);
    expect(controls.button("Hareketi göster").props.disabled).toBe(true);
    controls.click("Hareketi göster", true);
    expect(onMotion).not.toHaveBeenCalled();
    controls.update({ seats: SEATS });
    expect(controls.control("Karakter").props.value).toBe("alpha");
    controls.click("Hareketi göster");
    expect(onMotion).toHaveBeenCalledExactlyOnceWith("alpha", "wave-small");
  });

  it("does not keep dispatching to a character removed from the actual roster", () => {
    const { controls, onMotion } = mount();
    controls.change("Karakter", "beta");
    controls.update({ seats: [SEATS[0]] });
    expect(controls.control("Karakter").props.value).toBe("alpha");
    controls.click("Hareketi göster");
    expect(onMotion).toHaveBeenCalledExactlyOnceWith("alpha", "wave-small");
  });

  it("reports a rejected scene command without claiming the selected motion played", () => {
    const onMotion = vi.fn<(seatId: string, gesture: GestureId) => boolean>(() => false);
    const { controls } = mount(onMotion);
    controls.change("Hareket", "present-both");
    controls.click("Hareketi göster");
    expect(onMotion).toHaveBeenCalledExactlyOnceWith("alpha", "present-both");
    expect(controls.status).toContain("Sahne henüz komut alamıyor");
    expect(controls.status).not.toContain("İki kanatla sun");
    expect(controls.status).not.toContain("tekrar duraklatıldı");
  });

  it("quick actions use their real catalog entries and the selected seat", () => {
    const { controls, onMotion } = mount();
    controls.change("Karakter", "beta");
    for (const action of GESTURE_COMMANDS.slice(0, 6)) {
      controls.click(action.label);
      expect(onMotion).toHaveBeenLastCalledWith("beta", action.id);
    }
    expect(onMotion).toHaveBeenCalledTimes(6);
  });

  it("publishes feedback through an accessible live status and keeps instructions optional", () => {
    const { controls } = mount();
    const details = elements(controls.tree, (element) => element.type === "details")[0];
    const status = elements(controls.tree, (element) => element.props.role === "status")[0];
    expect(details.props.open).not.toBe(true);
    expect(status.props["aria-live"]).toBe("polite");
    controls.click("Selamla");
    expect(controls.status).toContain("Alpha modeli");
  });
});
