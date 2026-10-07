import type { ConcreteTarget, Language, Localized } from "@/models/common";
import type { CompileOptions, ExecutionContext } from "@/models/options";
import type { ResolvedPrison } from "@/models/prison";
import type { PrisonSpec, TaskPlan } from "@/models/spec";
import { getTaskType, resolveTaskProfile } from "@/core/task-types/registry";
import { adaptTaskBehavior, taskBehaviorTexts } from "@/core/task-types/behavior";

type Workflow = "implementation" | "analysis" | "research" | "content" | "media" | "general";

/** An editorial plan for the prompt, never an executed task or an additional permission. */
export interface JailbreakStrategyPlan {
  target: ConcreteTarget;
  environment: ExecutionContext;
  workflow: Workflow;
  role: string;
  goal: string;
  executionRequested: boolean;
  approach: string;
  steps: TaskPlan["steps"];
  unknowns: string[];
  clarifyingQuestions: string[];
  outputFormat: string;
  deliverables: string[];
  successCriteria: string[];
  guidance: { workflow: string; target: string; environment: string; context: string; output: string; verification: string };
  strategies: string[];
}

const WORKFLOW_GUIDANCE: Record<Workflow, Localized> = {
  implementation: {
    en: "Locate the affected components, choose the smallest coherent change, then verify the requested behavior and protected flows.",
    tr: "Etkilenen bileşenleri bul, en küçük tutarlı değişikliği seç; istenen davranışı ve korunacak akışları doğrula.",
  },
  analysis: {
    en: "Define the decision or question, compare the relevant evidence and alternatives, then give supported conclusions with uncertainty.",
    tr: "Kararı veya soruyu belirle, ilgili kanıtları ve seçenekleri karşılaştır; belirsizlikleri belirterek destekli sonuçlar sun.",
  },
  research: {
    en: "Turn the question into focused evidence needs, evaluate source relevance and recency, then synthesize findings without invented citations.",
    tr: "Soruyu somut kanıt ihtiyaçlarına ayır, kaynakların ilgisini ve güncelliğini değerlendir; bulguları kaynak uydurmadan birleştir.",
  },
  content: {
    en: "Identify the audience, purpose and requested form; develop a coherent draft, then edit for accuracy, tone and format.",
    tr: "Hedef kitleyi, amacı ve istenen biçimi belirle; tutarlı bir taslak oluştur, ardından doğruluk, ton ve biçim açısından düzenle.",
  },
  media: {
    en: "Translate the brief into composition, style and required elements; produce the requested artifact and check its visual acceptance criteria.",
    tr: "İsteği kompozisyon, stil ve gerekli öğelere dönüştür; istenen çıktıyı oluştur ve görsel kabul ölçütlerini kontrol et.",
  },
  general: {
    en: "Break the goal into necessary decisions and deliverables, resolve dependencies, then evaluate the result against the task criteria.",
    tr: "Hedefi gerekli kararlara ve çıktılara ayır, bağımlılıkları çöz; sonucu görev ölçütleriyle değerlendir.",
  },
};

const ENVIRONMENT_GUIDANCE: Record<ExecutionContext, Localized> = {
  chat: {
    en: "Chat: work from supplied context; do not assume repository, account or tool access. Supply usable artifacts or request the blocking input.",
    tr: "Sohbet: verilen bağlamla çalış; depo, hesap veya araç erişimi varsayma. Kullanılabilir çıktılar sun veya engelleyici girdiyi iste.",
  },
  mobile: {
    en: "Mobile: use compact, easy-to-copy output; preserve the requested format. Do not assume a terminal, local files or account access.",
    tr: "Mobil: kısa ve kolay kopyalanabilir çıktı kullan; istenen biçimi koru. Terminal, yerel dosya veya hesap erişimi varsayma.",
  },
  browser: {
    en: "Browser: use only context and tools actually available. Verify page-derived facts; a browser setting grants no account or publishing permission.",
    tr: "Tarayıcı: yalnızca mevcut bağlamı ve araçları kullan. Sayfadan alınan bilgileri doğrula; tarayıcı seçimi hesap veya yayın izni vermez.",
  },
  agent: {
    en: "Agent: use available tools only for owner-authorized work; verify actual results and report blockers without claiming unperformed actions.",
    tr: "Ajan: mevcut araçları yalnızca kullanıcının yetkilendirdiği işte kullan; gerçek sonuçları doğrula, yapılmamış işlemleri yapıldı diye bildirme.",
  },
};

/** Target adaptation changes presentation and workflow, never the owner's requested operation. */
export function jailbreakTargetGuidance(target: ConcreteTarget, language: Language, executionRequested: boolean): string {
  const guidance: Record<ConcreteTarget, Localized> = {
    gpt: {
      en: "Use direct instructions, concrete evaluation criteria and a response structure suited to the requested deliverable.",
      tr: "Doğrudan talimatlar, somut değerlendirme ölçütleri ve istenen çıktıya uygun bir yanıt yapısı kullan.",
    },
    claude: {
      en: "Keep task data separate from directives; organize evidence, assumptions and decisions into a coherent response.",
      tr: "Görev verisini talimatlardan ayır; kanıtları, varsayımları ve kararları tutarlı bir yanıt içinde düzenle.",
    },
    gemini: {
      en: "Connect each task step to its input and deliverable; use visual or external tools only when available and relevant.",
      tr: "Her görev adımını girdisi ve çıktısıyla ilişkilendir; görsel veya harici araçları yalnızca mevcut ve ilgili olduğunda kullan.",
    },
    codex: executionRequested ? {
      en: "Inspect the available project instructions and relevant files before making the authorized changes; run checks that test the actual behavior.",
      tr: "Yetkilendirilmiş değişikliklerden önce mevcut proje talimatlarını ve ilgili dosyaları incele; gerçek davranışı sınayan kontrolleri çalıştır.",
    } : {
      en: "Give the requested analysis, advice or artifact. Selecting Codex does not authorize file changes, command execution or deployment.",
      tr: "İstenen analizi, öneriyi veya çıktıyı sun. Codex seçimi dosya değişikliği, komut çalıştırma veya dağıtım izni vermez.",
    },
  };
  return guidance[target][language];
}

function workflowFor(spec: PrisonSpec, executionRequested: boolean): Workflow {
  if (spec.flags.adviceOnly || spec.operation === "advise" || spec.operation === "analyze") return "analysis";
  if (spec.operation === "research" || spec.flags.researchRequired) return "research";
  const family = getTaskType(spec.taskType).family;
  if (spec.operation === "generate_media" || spec.flags.visualGenerationRequired || family === "visual") return "media";
  if (spec.operation === "generate_content" || family === "content") return "content";
  if (executionRequested && (spec.flags.codingRequired || family === "engineering" || spec.operation === "automate")) return "implementation";
  if (family === "analysis" || family === "strategy" || spec.flags.analysisRequired) return "analysis";
  return "general";
}

export function buildJailbreakStrategyPlan(
  prison: Pick<ResolvedPrison, "spec" | "compileOptions" | "language">,
  target: ConcreteTarget,
): JailbreakStrategyPlan {
  const { spec, compileOptions: options, language } = prison;
  const profile = adaptTaskBehavior(resolveTaskProfile(spec.taskType), spec);
  const executionRequested = spec.flags.executionRequired && !spec.flags.adviceOnly
    && ["modify_existing", "create_new", "automate"].includes(spec.operation);
  const workflow = workflowFor(spec, executionRequested);
  const unknowns = spec.unknowns.map(({ text }) => text);
  const clarifyingQuestions = [...(spec.taskPlan?.clarifyingQuestions ?? [])];
  const strategies = ["Expert-Role", "Task-Decomposition", "Target-Adaptation", "Environment-Adaptation", "Output-Contract", "Evidence-Verification"];
  if (unknowns.length || clarifyingQuestions.length) strategies.push("Context-Resolution");
  if (target === "codex" && !executionRequested) strategies.push("Advice-Boundary");
  return {
    target,
    environment: options.executionContext,
    workflow,
    role: spec.role,
    goal: spec.primaryGoal,
    executionRequested,
    approach: spec.taskPlan?.approach ?? "",
    steps: (spec.taskPlan?.steps ?? []).map((step) => ({ ...step })),
    unknowns,
    clarifyingQuestions,
    outputFormat: spec.expectedOutput.format,
    deliverables: [...spec.expectedOutput.deliverables],
    successCriteria: taskBehaviorTexts(spec, spec.successCriteria, profile.successCriteria, language),
    guidance: {
      workflow: WORKFLOW_GUIDANCE[workflow][language],
      target: jailbreakTargetGuidance(target, language, executionRequested),
      environment: ENVIRONMENT_GUIDANCE[options.executionContext][language],
      context: language === "en"
        ? "Use known context as evidence and label assumptions. Ask only for missing input that blocks a correct result; continue independent work. Never infer access, facts or permissions from a role."
        : "Bilinen bağlamı kanıt olarak kullan, varsayımları belirt. Yalnızca doğru sonucu engelleyen eksik girdiyi sor; bağımsız işe devam et. Bir rolden erişim, gerçek bilgi veya izin çıkarma.",
      output: language === "en"
        ? "Deliver exactly the requested format and artifacts. Keep explanations inside that format; omit unrelated features and extra sections."
        : "Tam olarak istenen biçimi ve çıktıları sun. Açıklamaları o biçim içinde tut; ilgisiz özellikler ve ek bölümler ekleme.",
      verification: language === "en"
        ? "Check each deliverable against the success criteria, protected elements and active owner revisions. Report evidence, uncertainty and checks actually performed."
        : "Her çıktıyı başarı ölçütleri, korunacak öğeler ve etkin kullanıcı revizyonlarıyla kontrol et. Kanıtları, belirsizlikleri ve gerçekten yapılan kontrolleri bildir.",
    },
    strategies,
  };
}

export const JAILBREAK_FRAMING_LIMITS: Record<CompileOptions["verbosity"], number> = {
  concise: 1500,
  standard: 3500,
  detailed: 6000,
};
