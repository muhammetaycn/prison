import type { ConcreteTarget } from "@/models/common";
import type { CompileOptions } from "@/models/options";
import type { ResolvedPrison } from "@/models/prison";
import type { MemoryKind } from "@/models/prompt";
import type { ItemListKey } from "@/models/spec";
import type { StatePatch } from "@/core/prison-engine/patch";
import { readJailbreakModeRequest } from "@/core/prison-engine/jailbreak-mode";
import { cleanItem, fold } from "@/core/text/normalize";
import { phrase } from "@/templates/phrases";
import { OPTION_VALUE_LABELS, TARGET_LABELS } from "@/templates/ui-labels";
import type { RevisionInterpretation } from "./types";

/** Rule-based revision interpreter for the local fallback engine. Patterns run on folded text. */
const R = {
  negation: /(izin verme|yapmasin|etmesin|olmasin|yapmamali|etmemeli|degistirme|degistirmesin|dokunma|asla|hicbir sekilde|yapma\b|etme\b|never|don'?t|do not|must not|no longer|kapat|devre disi)/,
  allow: /(izin ver|serbest|yapabilir|allow|permit|can deploy)/,
  deploy: /(deploy|canliya|canli ortam|yayina al|yayinla|production|prod\b|publish)/,
  architecture: /(mimari|architecture|framework|stack)/,
  keep: /(koru|ayni kalsin|kalsin|keep|preserve)/,
  strict: /(kati|siki|strict|daha net sinir|kapsam disina cikma)/,
  free: /(ozgur|serbest cozum|esnek|daha fazla alan|freedom|flexib|free hand)/,
  short: /(kisa|kisalt|ozet|short|concise|brief)/,
  detailed: /(detay|ayrinti|uzun|detailed|more detail|expand)/,
  technical: /(teknik|technical)/,
  agent: /(agent|ajan|otonom|autonomous)/,
  always: /(her zaman|daima|hep|always|from now on|bundan sonra)/,
  targetVerb: /(icin|for|hedef|target|uret|gecir|degistir|switch|use|kullan|yap)/,
};

const TARGETS: Array<[RegExp, ConcreteTarget]> = [
  [/(?<![a-z])codex/, "codex"],
  [/(?<![a-z])claude/, "claude"],
  [/(?<![a-z])(chat ?gpt|gpt)/, "gpt"],
  [/(?<![a-z])gemini/, "gemini"],
];

export function interpretRevisionLocally(message: string, prison: ResolvedPrison): RevisionInterpretation {
  const text = fold(message);
  const lang = prison.language;
  const negated = R.negation.test(text);
  const directive = cleanItem(message);

  const add: Partial<Record<ItemListKey, string[]>> = {};
  const push = (list: ItemListKey, value: string) => {
    add[list] = [...(add[list] ?? []), value];
  };
  const memory: Array<{ directive: string; kind: MemoryKind }> = [];
  const options: Partial<CompileOptions> = {};
  const set: NonNullable<StatePatch["set"]> = {};
  const revokeMemoryIds: string[] = [];
  const summary: string[] = [];
  let handled = false;

  const target = TARGETS.find(([pattern]) => pattern.test(text))?.[1];
  if (target && R.targetVerb.test(text)) {
    set.targetAI = target;
    summary.push(`hedef AI ${TARGET_LABELS[target]} yapıldı`);
    if (R.always.test(text)) memory.push({ directive, kind: "target" });
    handled = true;
  }

  if (R.deploy.test(text)) {
    if (negated) {
      set.deploymentPermission = "forbidden";
      push("disallowedOperations", phrase("denyDeploy", lang));
      memory.push({ directive, kind: "prohibition" });
      summary.push("deploy yasaklandı ve görev hafızasına eklendi");
    } else if (R.allow.test(text)) {
      set.deploymentPermission = "allowed";
      for (const entry of prison.taskMemory) {
        if (entry.active && entry.kind === "prohibition" && R.deploy.test(fold(entry.directive))) revokeMemoryIds.push(entry.id);
      }
      summary.push("deploy'a izin verildi");
    }
    handled = handled || negated || R.allow.test(text);
  }

  if (R.architecture.test(text) && (negated || R.keep.test(text))) {
    push("protectedElements", phrase("protectArchitecture", lang));
    push("disallowedOperations", phrase("denySwitchStack", lang));
    set.flags = { ...set.flags, preserveArchitecture: true };
    memory.push({ directive, kind: "protection" });
    summary.push("mevcut mimari koruma altına alındı");
    handled = true;
  }

  if (R.strict.test(text)) options.scope = "strict";
  else if (R.free.test(text)) options.scope = "open";
  if (R.short.test(text)) options.verbosity = "concise";
  else if (R.detailed.test(text)) options.verbosity = "detailed";
  if (R.technical.test(text)) options.technicality = negated ? "standard" : "technical";
  if (R.agent.test(text)) options.agentMode = !negated;
  const jailbreakMode = readJailbreakModeRequest(message);
  if (jailbreakMode !== undefined) options.jailbreakMode = jailbreakMode;

  if (Object.keys(options).length) {
    set.options = options;
    const labels = [
      options.scope && OPTION_VALUE_LABELS.scope[options.scope],
      options.verbosity && OPTION_VALUE_LABELS.verbosity[options.verbosity],
      options.technicality && OPTION_VALUE_LABELS.technicality[options.technicality],
      options.agentMode !== undefined && (options.agentMode ? "Agent modu açık" : "Agent modu kapalı"),
      options.jailbreakMode !== undefined && (options.jailbreakMode ? "JB modu açık" : "JB modu kapalı"),
    ].filter(Boolean);
    summary.push(`ayarlar güncellendi (${labels.join(", ")})`);
    handled = true;
  }

  if (!handled && directive) {
    if (negated) {
      push("constraints", directive);
      memory.push({ directive, kind: "constraint" });
      summary.push("yeni kısıt eklendi ve görev hafızasına yazıldı");
    } else {
      push("requirements", directive);
      summary.push("yeni gereksinim eklendi");
    }
  }

  const sentence = summary.length ? summary.join("; ") : "değişiklik gerekmedi";
  return {
    patch: { set, add, memory, revokeMemoryIds },
    summary: `${sentence.charAt(0).toLocaleUpperCase("tr")}${sentence.slice(1)}.`,
    engine: "local",
  };
}
