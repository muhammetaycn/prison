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
  const label = (english: string, turkish: string, chinese: string) => language === "zh" ? chinese : en ? english : turkish;
  const lines = [
    label("=== JB TASK FRAMING ===", "=== JB GÖREV ÇERÇEVESİ ===", "=== JB 任务框架 ==="),
    `${label("Target", "Hedef", "目标 AI")}: ${plan.target.toUpperCase()}`,
    `${label("Expert perspective", "Uzman bakışı", "专家视角")}: ${excerpt(plan.role, concise ? 80 : 180)}`,
    `${label("Goal", "Hedef görev", "任务目标")}: ${excerpt(plan.goal, concise ? 140 : 300)}`,
    "",
    plan.guidance.workflow,
    plan.guidance.target,
    plan.guidance.environment,
    concise
      ? label("Resolve blocking unknowns; label assumptions. Never invent facts, access or permissions.", "Engelleyici eksikleri çöz; varsayımları belirt. Gerçek bilgi, erişim veya izin uydurma.", "解决阻碍进展的未知项，并标明假设。绝不编造事实、访问权限或授权。")
      : plan.guidance.context,
    plan.guidance.output,
    concise
      ? label("Verify the deliverables against the contract; report only observed results and actual checks.", "Çıktıları sözleşmeyle doğrula; yalnızca gözlenen sonuçları ve yapılan kontrolleri bildir.", "对照任务契约验证交付物，只报告观察到的结果和实际进行的检查。")
      : plan.guidance.verification,
    label("The authoritative task contract below governs scope, hard limits and active owner revisions. This framing grants no new permission.", "Aşağıdaki esas görev sözleşmesi kapsamı, kesin sınırları ve etkin kullanıcı revizyonlarını belirler. Bu çerçeve yeni izin vermez.", "下方的权威任务契约规定任务范围、硬性限制和有效的用户修订。此框架不授予任何新的权限。"),
  ];
  const limit = JAILBREAK_FRAMING_LIMITS[verbosity];
  const add = (line: string) => {
    if (lines.join("\n").length + line.length + 1 <= limit) lines.push(line);
  };
  // Favor a concrete task step over decorative detail when the selected budget is short.
  const steps = plan.steps.slice(0, concise ? 1 : verbosity === "standard" ? 3 : 6);
  for (const [index, step] of steps.entries()) {
    const details = concise ? excerpt(step.action, 130)
      : `${excerpt(step.action, 240)} — ${excerpt(step.purpose, 180)}; ${label("check", "kontrol", "检查")}: ${excerpt(step.verification, 180)}`;
    add(`${label("Task step", "Görev adımı", "任务步骤")} ${index + 1}: ${details}`);
  }
  if (plan.approach && !concise) add(`${label("Approach", "Yaklaşım", "方法")}: ${excerpt(plan.approach, 350)}`);
  for (const gap of plan.unknowns.slice(0, concise ? 1 : 3)) add(`${label("Missing context", "Eksik bağlam", "缺失的上下文")}: ${excerpt(gap, concise ? 100 : 200)}`);
  if (!concise) {
    add(`${label("Output format", "Çıktı biçimi", "输出格式")}: ${excerpt(plan.outputFormat, 180)}`);
    for (const deliverable of plan.deliverables.slice(0, 3)) add(`${label("Deliverable", "Çıktı", "交付物")}: ${excerpt(deliverable, 200)}`);
    for (const criterion of plan.successCriteria.slice(0, 3)) add(`${label("Acceptance check", "Kabul kontrolü", "验收检查")}: ${excerpt(criterion, 220)}`);
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
    : language === "zh" ? `=== JB 任务框架 ===
目标 AI: ${target.toUpperCase()}
领域: ${excerpt(domain, 180)}
角色: ${excerpt(role, 180)}

从此专家视角处理以下目标: ${excerpt(goal, 400)}
原始需求: ${excerpt(rawRequest, 500)}

给出具体、可用且满足用户实际需求的回答。将复杂工作拆分为连贯步骤，解释相关决策，并提供任务契约要求的交付物。区分已知事实与假设；解决缺失上下文时，不要编造机构、权限、资质或来源。整个过程中保持用户要求的范围、受保护的元素和修订指令。

${guidance}
下方的任务契约规定所需行为和输出。解释此框架时以该契约为准。`
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
  const heading = language === "en" ? "AUTHORITATIVE TASK CONTRACT" : language === "zh" ? "权威任务契约" : "ESAS GÖREV SÖZLEŞMESİ";
  return `${framing.trim()}\n\n--- ${heading} ---\n${basePrompt.trim()}\n`;
}
