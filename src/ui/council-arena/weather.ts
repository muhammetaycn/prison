import type { CouncilEvent } from "@/models/council";
import type { SceneState } from "./timeline";

export type WeatherKind = "sunny" | "cloudy" | "rainy" | "storm" | "heat";

/**
 * The stage's weather, read off what is really happening at the table. It never changes a score: heat shows that
 * the system itself is struggling (calls without a reply, reviews that could not be completed, fallback swaps).
 */
export interface Weather {
  kind: WeatherKind;
  /** Short reason shown on the stage, so the weather is never a mystery. */
  reason: string;
  /** System strain 0…1 over the recent window; drives how fierce the heat is. */
  strain: number;
}

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  sunny: "Güneşli",
  cloudy: "Bulutlu",
  rainy: "Yağmurlu",
  storm: "Fırtına",
  heat: "Aşırı sıcak",
};

/** How many recent (non-thinking) moments the weather looks back over. */
const WINDOW = 10;
const STRAIN_KINDS = new Set<CouncilEvent["kind"]>(["failed", "abstained", "replace"]);

export function weatherAt(events: CouncilEvent[], index: number, state: SceneState): Weather {
  const current = index >= 0 ? events[index] : undefined;
  const recent = events.slice(0, Math.max(0, index + 1)).filter((event) => event.kind !== "thinking").slice(-WINDOW);
  const strained = recent.filter((event) => STRAIN_KINDS.has(event.kind)).length;
  const strain = Math.min(1, strained / 3);
  if (!current) return { kind: "cloudy", reason: "Modeller yerini alıyor", strain: 0 };
  if (state.winner) return { kind: "sunny", reason: "Sonuç belli oldu", strain };
  if (current.kind === "eliminated") return { kind: "storm", reason: "Eleme", strain };
  if (strained >= 2) return { kind: "heat", reason: "Sistem zorlanıyor: yanıtsız çağrılar ve yedek geçişleri", strain };

  const scores = recent.filter((event) => event.kind === "critique" && event.score !== null).map((event) => event.score!);
  const low = scores.filter((score) => score < 0.5).length;
  const objections = recent.filter((event) => event.kind === "objection").length;
  const approvals = recent.filter((event) => event.kind === "approval").length;
  const healths = Object.values(state.health);
  const mean = healths.length ? healths.reduce((sum, value) => sum + value, 0) / healths.length : null;
  if (objections + low >= 3 || (mean !== null && mean < 0.55)) {
    return { kind: "rainy", reason: objections >= low ? "İtirazlar arttı" : "Düşük puanlar", strain };
  }
  if (approvals >= 2 || (mean !== null && mean >= 0.78 && low === 0)) {
    return { kind: "sunny", reason: approvals >= 2 ? "Onaylar geliyor" : "Puanlar yüksek", strain };
  }
  const reason = current.kind === "research" ? "İnceleme sürüyor" : state.finalist ? "Son denetim" : "Tartışma sürüyor";
  return { kind: "cloudy", reason, strain };
}
