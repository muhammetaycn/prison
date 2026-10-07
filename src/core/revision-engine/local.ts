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
  negation: /(izin verme|yapmasin|etmesin|olmasin|yapmamali|etmemeli|degistirme|degistirmesin|dokunma|asla|hicbir sekilde|yapma\b|etme\b|never|don'?t|do not|must not|no longer|kapat|devre disi|不要|禁止|不得|不可|无需|不用|不需要|不允许|不能|不发布|不部署|不删除|不修改|不改变|不使用|关闭|停用)/,
  allow: /(izin ver|serbest|yapabilir|allow|permit|can deploy|允许|许可|可以|授权)/,
  deploy: /(deploy|canliya|canli ortam|yayina al|yayinla|production|prod\b|publish|发布|部署|上线|生产环境|正式环境)/,
  architecture: /(mimari|architecture|framework|stack|架构|框架|技术栈)/,
  keep: /(koru|ayni kalsin|kalsin|keep|preserve|保留|保持|不变)/,
  strict: /(kati|siki|strict|daha net sinir|kapsam disina cikma|严格|更明确的边界|不超出范围)/,
  free: /(ozgur|serbest cozum|esnek|daha fazla alan|freedom|flexib|free hand|自由|灵活|开放方案)/,
  short: /(kisa|kisalt|ozet|short|concise|brief|简短|精简|简洁|缩短)/,
  detailed: /(detay|ayrinti|uzun|detailed|more detail|expand|详细|更多细节|展开)/,
  technical: /(teknik|technical|技术性|技术细节|技术说明|更技术)/,
  agent: /(agent|ajan|otonom|autonomous|智能体|代理模式|自主)/,
  always: /(her zaman|daima|hep|always|from now on|bundan sonra|始终|总是|从现在开始)/,
  targetVerb: /(icin|for|hedef|target|uret|gecir|degistir|switch|use|kullan|yap|为|针对|切换|改用|生成|使用)/,
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
  const say = (tr: string, en: string, zh: string) => lang === "zh" ? zh : lang === "en" ? en : tr;
  const negated = R.negation.test(text);
  // Chinese punctuation often has no following space. Evaluate polarity on the relevant
  // clause so "do not deploy; make it detailed" does not disable an unrelated option.
  const chineseClauses = /\p{Script=Han}/u.test(text) ? text.split(/[。！？；;\n]+/u).filter(Boolean) : null;
  const relevantText = (pattern: RegExp) => chineseClauses?.filter((clause) => pattern.test(clause)).join("；") || text;
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
    summary.push(say(`hedef AI ${TARGET_LABELS[target]} yapıldı`, `target AI set to ${TARGET_LABELS[target]}`, `目标 AI 已设为 ${TARGET_LABELS[target]}`));
    if (R.always.test(text)) memory.push({ directive, kind: "target" });
    handled = true;
  }

  if (R.deploy.test(text)) {
    const deploymentText = relevantText(R.deploy);
    if (R.negation.test(deploymentText)) {
      set.deploymentPermission = "forbidden";
      push("disallowedOperations", phrase("denyDeploy", lang));
      memory.push({ directive, kind: "prohibition" });
      summary.push(say("deploy yasaklandı ve görev hafızasına eklendi", "deployment forbidden and remembered", "已禁止发布并记入任务记忆"));
    } else if (R.allow.test(deploymentText)) {
      set.deploymentPermission = "allowed";
      for (const entry of prison.taskMemory) {
        if (entry.active && entry.kind === "prohibition" && R.deploy.test(fold(entry.directive))) revokeMemoryIds.push(entry.id);
      }
      summary.push(say("deploy'a izin verildi", "deployment permitted", "已允许发布"));
    }
    handled = handled || R.negation.test(deploymentText) || R.allow.test(deploymentText);
  }

  if (R.architecture.test(text) && (R.negation.test(relevantText(R.architecture)) || R.keep.test(relevantText(R.architecture)))) {
    push("protectedElements", phrase("protectArchitecture", lang));
    push("disallowedOperations", phrase("denySwitchStack", lang));
    set.flags = { ...set.flags, preserveArchitecture: true };
    memory.push({ directive, kind: "protection" });
    summary.push(say("mevcut mimari koruma altına alındı", "existing architecture protected", "已保留现有架构"));
    handled = true;
  }

  if (R.strict.test(text)) options.scope = "strict";
  else if (R.free.test(text)) options.scope = "open";
  if (R.short.test(text)) options.verbosity = "concise";
  else if (R.detailed.test(text)) options.verbosity = "detailed";
  if (R.technical.test(text)) options.technicality = R.negation.test(relevantText(R.technical)) ? "standard" : "technical";
  if (R.agent.test(text)) options.agentMode = !R.negation.test(relevantText(R.agent));
  const jailbreakMode = readJailbreakModeRequest(message);
  if (jailbreakMode !== undefined) options.jailbreakMode = jailbreakMode;

  if (Object.keys(options).length) {
    set.options = options;
    const labels = [
      options.scope && say(OPTION_VALUE_LABELS.scope[options.scope], { strict: "Strict scope", balanced: "Balanced scope", open: "Open approach" }[options.scope], { strict: "严格范围", balanced: "平衡范围", open: "开放方案" }[options.scope]),
      options.verbosity && say(OPTION_VALUE_LABELS.verbosity[options.verbosity], { concise: "Concise", standard: "Standard", detailed: "Detailed" }[options.verbosity], { concise: "简洁", standard: "标准", detailed: "详细" }[options.verbosity]),
      options.technicality && say(OPTION_VALUE_LABELS.technicality[options.technicality], { standard: "Standard", technical: "Technical" }[options.technicality], { standard: "标准", technical: "技术性" }[options.technicality]),
      options.agentMode !== undefined && (options.agentMode ? say("Agent modu açık", "Agent mode on", "智能体模式已开启") : say("Agent modu kapalı", "Agent mode off", "智能体模式已关闭")),
      options.jailbreakMode !== undefined && (options.jailbreakMode ? say("JB modu açık", "JB mode on", "JB 模式已开启") : say("JB modu kapalı", "JB mode off", "JB 模式已关闭")),
    ].filter(Boolean);
    summary.push(say(`ayarlar güncellendi (${labels.join(", ")})`, `settings updated (${labels.join(", ")})`, `设置已更新（${labels.join("，")}）`));
    handled = true;
  }

  if (!handled && directive) {
    if (negated) {
      push("constraints", directive);
      memory.push({ directive, kind: "constraint" });
      summary.push(say("yeni kısıt eklendi ve görev hafızasına yazıldı", "new constraint added and remembered", "已添加新限制并记入任务记忆"));
    } else {
      push("requirements", directive);
      summary.push(say("yeni gereksinim eklendi", "new requirement added", "已添加新需求"));
    }
  }

  const sentence = summary.length ? summary.join(lang === "zh" ? "；" : "; ") : say("değişiklik gerekmedi", "no changes needed", "无需更改");
  return {
    patch: { set, add, memory, revokeMemoryIds },
    summary: lang === "zh" ? `${sentence}。` : `${sentence.charAt(0).toLocaleUpperCase(lang)}${sentence.slice(1)}.`,
    engine: "local",
  };
}
