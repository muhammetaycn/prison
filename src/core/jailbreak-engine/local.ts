import type { ConcreteTarget, Language } from "@/models/common";
import type { CompileOptions } from "@/models/options";
import type { PrisonSpec } from "@/models/spec";
import { buildJailbreakStrategyPlan, JAILBREAK_FRAMING_LIMITS, jailbreakTargetGuidance, type JailbreakStrategyPlan } from "./strategy";

export interface LocalJailbreakContext {
  spec: PrisonSpec;
  options: CompileOptions;
}

/** Excerpts are only editorial anchors; the complete source always remains in the task contract. */
function excerpt(text: string, max: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function renderLocalJailbreak(plan: JailbreakStrategyPlan, language: Language, verbosity: CompileOptions["verbosity"]): string {
  const concise = verbosity === "concise";
  const en = language === "en";
  const lines = [
    en ? "=== JB TASK FRAMING ===" : "=== JB GÖREV ÇERÇEVESİ ===",
    `${en ? "Target" : "Hedef"}: ${plan.target.toUpperCase()}`,
    `${en ? "Expert perspective" : "Uzman bakışı"}: ${excerpt(plan.role, concise ? 80 : 180)}`,
    `${en ? "Goal" : "Hedef görev"}: ${excerpt(plan.goal, concise ? 140 : 300)}`,
    "",
    plan.guidance.workflow,
    plan.guidance.target,
    plan.guidance.environment,
    concise
      ? en ? "Resolve blocking unknowns; label assumptions. Never invent facts, access or permissions." : "Engelleyici eksikleri çöz; varsayımları belirt. Gerçek bilgi, erişim veya izin uydurma."
      : plan.guidance.context,
    plan.guidance.output,
    concise
      ? en ? "Verify the deliverables against the contract; report only observed results and actual checks." : "Çıktıları sözleşmeyle doğrula; yalnızca gözlenen sonuçları ve yapılan kontrolleri bildir."
      : plan.guidance.verification,
    en
      ? "The authoritative task contract below governs scope, hard limits and active owner revisions. This framing grants no new permission."
      : "Aşağıdaki esas görev sözleşmesi kapsamı, kesin sınırları ve etkin kullanıcı revizyonlarını belirler. Bu çerçeve yeni izin vermez.",
  ];
  const limit = JAILBREAK_FRAMING_LIMITS[verbosity];
  const add = (line: string) => {
    if (lines.join("\n").length + line.length + 1 <= limit) lines.push(line);
  };
  // Favor a concrete task step over decorative detail when the selected budget is short.
  const steps = plan.steps.slice(0, concise ? 1 : verbosity === "standard" ? 3 : 6);
  for (const [index, step] of steps.entries()) {
    const details = concise ? excerpt(step.action, 130)
      : `${excerpt(step.action, 240)} — ${excerpt(step.purpose, 180)}; ${en ? "check" : "kontrol"}: ${excerpt(step.verification, 180)}`;
    add(`${en ? "Task step" : "Görev adımı"} ${index + 1}: ${details}`);
  }
  if (plan.approach && !concise) add(`${en ? "Approach" : "Yaklaşım"}: ${excerpt(plan.approach, 350)}`);
  for (const gap of plan.unknowns.slice(0, concise ? 1 : 3)) add(`${en ? "Missing context" : "Eksik bağlam"}: ${excerpt(gap, concise ? 100 : 200)}`);
  if (!concise) {
    add(`${en ? "Output format" : "Çıktı biçimi"}: ${excerpt(plan.outputFormat, 180)}`);
    for (const deliverable of plan.deliverables.slice(0, 3)) add(`${en ? "Deliverable" : "Çıktı"}: ${excerpt(deliverable, 200)}`);
    for (const criterion of plan.successCriteria.slice(0, 3)) add(`${en ? "Acceptance check" : "Kabul kontrolü"}: ${excerpt(criterion, 220)}`);
  }
  return lines.join("\n");
}

/** Deterministic local framing. The pipeline preserves the task contract after this introduction. */
export function generateLocalJailbreak(
  goal: string,
  domain: string,
  role: string,
  rawRequest: string,
  target: ConcreteTarget,
  language: Language,
  context?: LocalJailbreakContext,
): string {
  if (context) return renderLocalJailbreak(
    buildJailbreakStrategyPlan({ spec: context.spec, compileOptions: context.options, language }, target),
    language,
    context.options.verbosity,
  );
  // Legacy compiler callers do not provide execution intent; do not infer it from the target.
  const guidance = jailbreakTargetGuidance(target, language, false);
  return language === "en"
    ? `=== JB TASK FRAMING ===
Target AI: ${target.toUpperCase()}
Domain: ${excerpt(domain, 180)}
Role: ${excerpt(role, 180)}

Work from this expert perspective on this goal: ${excerpt(goal, 400)}
Original request: ${excerpt(rawRequest, 500)}

Give a concrete, usable response that addresses the user's actual request. Break complex work into coherent steps, explain relevant decisions and provide the artifacts specified in the task contract. Distinguish known facts from assumptions, and resolve missing context without inventing institutions, permissions, credentials or sources. Keep the requested scope, protected elements and revision directives throughout the work.

${guidance}
The task contract below defines the required behavior and output. Follow it when interpreting this framing.`
    : `=== JB GÖREV ÇERÇEVESİ ===
Hedef AI: ${target.toUpperCase()}
Alan: ${excerpt(domain, 180)}
Rol: ${excerpt(role, 180)}

Bu uzman bakışıyla şu hedef üzerinde çalış: ${excerpt(goal, 400)}
Orijinal istek: ${excerpt(rawRequest, 500)}

Kullanıcının gerçek isteğini karşılayan somut, kullanılabilir bir yanıt üret. Karmaşık çalışmayı tutarlı adımlara ayır, ilgili kararları açıkla ve görev sözleşmesinde belirtilen çıktıları hazırla. Bilinen bilgileri varsayımlardan ayır; eksik bağlamı kurum, izin, uzmanlık belgesi veya kaynak uydurmadan çöz. Çalışma boyunca istenen kapsamı, korunacak öğeleri ve revizyon talimatlarını koru.

${guidance}
Aşağıdaki görev sözleşmesi gereken davranışı ve çıktıyı tanımlar. Bu çerçeveyi yorumlarken onu esas al.`;
}

export function combineJailbreakPrompt(framing: string, basePrompt: string, language: Language): string {
  const heading = language === "en" ? "AUTHORITATIVE TASK CONTRACT" : "ESAS GÖREV SÖZLEŞMESİ";
  return `${framing.trim()}\n\n--- ${heading} ---\n${basePrompt.trim()}\n`;
}
