import { COUNCIL_WEAPONS, type CouncilDimension, type CouncilEvent, type CouncilReview } from "@/models/council";
import type { CouncilMode } from "@/models/options";
import { MIN_REVIEW_SCORE } from "@/models/review-policy";

/** Seat colors deliberately avoid green: green is reserved for "speaking", as in voice chat. */
export const SEAT_COLORS = ["#8b5cf6", "#3b82f6", "#f97316", "#ec4899", "#eab308", "#06b6d4"] as const;
export const SPEAKING_GREEN = "#22c55e";

export interface Seat {
  id: string;
  index: number;
  model: string;
  label: string;
  role: string;
  color: string;
}

export interface SceneState {
  index: number;
  round: number;
  /** Actor of the current event when it is a member. */
  speaker: string | null;
  thinking: string[];
  eliminated: string[];
  failed: string[];
  weapons: Partial<Record<CouncilDimension, string>>;
  /** Mean editorial score each member received in its latest reviewed round (fight health). */
  health: Record<string, number>;
  /** Members who have put a first proposal on the table, in order. */
  proposals: string[];
  draft: number;
  approvals: number;
  objections: number;
  winner: string | null;
  finalist: string | null;
  memory: boolean;
}

export function modelLabel(model: string | null | undefined): string {
  return model ? model.split("/").at(-1) ?? model : "";
}

/** Seats in the order members sat down; a replacement keeps the seat (and color) it took. */
export function seatsFrom(events: CouncilEvent[]): Seat[] {
  const seats: Seat[] = [];
  for (const event of events) {
    if (event.kind !== "seat" || seats.some((seat) => seat.id === event.actorId)) continue;
    const index = seats.length;
    seats.push({ id: event.actorId, index, model: event.model ?? event.actorId, label: modelLabel(event.model) || event.actorId,
      role: event.text, color: SEAT_COLORS[index % SEAT_COLORS.length] });
  }
  return seats;
}

/** Stored timeline, or one rebuilt from the saved ledger for records made before timelines existed. */
export function replayEvents(review: CouncilReview): CouncilEvent[] {
  if (review.events?.length) return review.events;
  const events: CouncilEvent[] = [];
  const push = (event: Omit<CouncilEvent, "seq" | "at" | "model" | "targetId" | "dimension" | "score"> & Partial<CouncilEvent>) =>
    events.push({ seq: events.length, at: review.startedAt, model: null, targetId: null, dimension: null, score: null, ...event });
  const model = (id: string) => review.participants.find((participant) => participant.id === id)?.model ?? null;
  const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 279);
  const average = (scores: Record<string, number>) => Object.values(scores).reduce((sum, value) => sum + value, 0) / 6;
  const critique = (review: CouncilReview["reviews"][number]) => review.issues[0]?.message ?? review.suggestions[0] ?? "Ciddi bir sorun görmedi.";
  for (const participant of review.participants) push({ kind: "seat", round: 0, actorId: participant.id, model: participant.model, text: clip(participant.role) });
  for (const participant of review.participants) {
    if (participant.initialPrompt) push({ kind: "proposal", round: 1, actorId: participant.id, model: participant.model, text: clip(participant.initialPrompt) });
    else if (participant.error) push({ kind: "failed", round: 1, actorId: participant.id, model: participant.model, text: clip(participant.error) });
  }
  const ledger = (stage: "peer" | "final") => {
    for (const entry of review.reviews.filter((item) => item.stage === stage)) {
      const accepted = !entry.issues.some((issue) => issue.severity === "high")
        && Object.values(entry.scores).every((score) => score >= MIN_REVIEW_SCORE);
      const kind = stage === "final" && review.mode === "collaboration"
        ? (accepted ? "approval" : "objection") : "critique";
      push({ kind, round: stage === "peer" ? 1 : 2, actorId: entry.reviewerId, model: model(entry.reviewerId), targetId: entry.candidateId,
        score: Math.min(1, Math.max(0, average(entry.scores))), text: clip(critique(entry)) });
    }
  };
  ledger("peer");
  for (const participant of review.participants) {
    if (participant.revisedPrompt) push({ kind: review.mode === "collaboration" ? "draft" : "revision", round: 2, actorId: participant.id, model: participant.model, text: clip(participant.revisedPrompt) });
  }
  ledger("final");
  push({ kind: review.selectionBasis === "finalist" ? "finalist" : "winner", round: review.rounds, actorId: review.winnerId, model: review.winnerModel, text: clip(review.decision),
    score: review.participants.find((participant) => participant.id === review.winnerId)?.score ?? null });
  return events;
}

const RESULT_KINDS = new Set<CouncilEvent["kind"]>(["research", "proposal", "revision", "draft", "critique", "approval", "objection", "failed", "abstained", "finalist", "winner"]);
/** Work that shows a member is still in play after an earlier failed call. */
const ACTIVE_KINDS = new Set<CouncilEvent["kind"]>(["proposal", "revision", "draft", "weapon", "winner", "finalist"]);

/** Pure fold of the timeline up to `index` (inclusive), so any moment can be shown without replaying animation. */
export function stateAt(events: CouncilEvent[], index: number): SceneState {
  const state: SceneState = {
    index, round: 0, speaker: null, thinking: [], eliminated: [], failed: [], weapons: {}, health: {}, proposals: [],
    draft: 0, approvals: 0, objections: 0, winner: null, finalist: null, memory: false,
  };
  const thinking = new Set<string>();
  const received = new Map<string, { round: number; sum: number; count: number }>();
  for (const event of events.slice(0, Math.max(0, index + 1))) {
    state.round = Math.max(state.round, event.round);
    if (event.kind === "thinking") thinking.add(event.actorId);
    if (RESULT_KINDS.has(event.kind)) thinking.delete(event.actorId);
    if (ACTIVE_KINDS.has(event.kind)) state.failed = state.failed.filter((id) => id !== event.actorId);
    switch (event.kind) {
      case "memory": state.memory = true; break;
      case "proposal": if (!state.proposals.includes(event.actorId)) state.proposals.push(event.actorId); break;
      case "weapon": if (event.dimension) state.weapons[event.dimension] = event.actorId; break;
      case "eliminated": if (!state.eliminated.includes(event.actorId)) state.eliminated.push(event.actorId); break;
      case "failed": if (!state.failed.includes(event.actorId)) state.failed.push(event.actorId); break;
      case "draft": state.draft++; state.approvals = 0; state.objections = 0; break;
      case "approval": state.approvals++; break;
      case "objection": state.objections++; break;
      case "winner": state.winner = event.actorId; state.finalist = null; break;
      case "finalist": state.finalist = event.actorId; state.winner = null; break;
      case "critique": {
        if (!event.targetId || event.score === null) break;
        const entry = received.get(event.targetId);
        const next = entry && entry.round === event.round ? entry : { round: event.round, sum: 0, count: 0 };
        next.sum += event.score;
        next.count++;
        received.set(event.targetId, next);
        state.health[event.targetId] = next.sum / next.count;
        break;
      }
    }
  }
  state.thinking = [...thinking];
  const current = events[index];
  state.speaker = current && current.actorId !== "system" && current.kind !== "thinking" ? current.actorId : null;
  return state;
}

const KIND_LABELS: Record<CouncilEvent["kind"], [string, string]> = {
  // [round table, fight]
  seat: ["Masaya oturdu", "Sahaya çıktı"],
  replace: ["Yedek model geçti", "Yedek savaşçı geçti"],
  memory: ["Hafıza", "Hafıza"],
  thinking: ["Düşünüyor", "Hazırlanıyor"],
  research: ["İnceleme", "Keşif"],
  proposal: ["İlk öneri", "İlk hamle"],
  critique: ["Tartışma", "Saldırı · eleştiri"],
  weapon: ["Silah", "Silah kazandı"],
  eliminated: ["Ayrıldı", "Elendi"],
  revision: ["Yeni öneri", "Güçlendi"],
  draft: ["Ortak metin", "Ortak metin"],
  approval: ["Onay", "Onay"],
  objection: ["İtiraz", "İtiraz"],
  winner: ["Uzlaşma", "Kazanan"],
  finalist: ["Son denetime seçildi", "Son denetime seçildi"],
  failed: ["Yanıt alınamadı", "Yanıt alınamadı"],
  abstained: ["Katkı veremedi", "Oy veremedi"],
};

export function kindLabel(kind: CouncilEvent["kind"], mode: CouncilMode): string {
  return KIND_LABELS[kind][mode === "collaboration" ? 0 : 1];
}

export function weaponName(dimension: CouncilDimension): string {
  return `${COUNCIL_WEAPONS[dimension].name} · ${COUNCIL_WEAPONS[dimension].meaning}`;
}

export const WEAPON_ICONS: Record<CouncilDimension, string> = {
  intent_alignment: "N",
  context_completeness: "B",
  constraint_clarity: "S",
  execution_clarity: "İ",
  output_clarity: "Ç",
  target_ai_compatibility: "H",
};

/** How long an event stays on stage at 1x. Long spoken text stays longer so it can be read. */
export function dwellMs(event: CouncilEvent): number {
  const reading = Math.min(4200, event.text.length * 18);
  switch (event.kind) {
    case "thinking": return 500;
    case "seat": return 450;
    case "replace": case "memory": return 2600;
    case "research": return 2400 + reading;
    case "weapon": return 1700;
    case "eliminated": return 2800;
    case "winner": case "finalist": return 4500;
    case "critique": case "approval": case "objection": return 1600 + reading * 0.6;
    case "failed": case "abstained": return 1800;
    default: return 2000 + reading;
  }
}
