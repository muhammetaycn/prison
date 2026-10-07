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
    zh: "找到受影响的组件，选择最小且连贯的改动，然后验证所要求的行为和受保护的流程。",
  },
  analysis: {
    en: "Define the decision or question, compare the relevant evidence and alternatives, then give supported conclusions with uncertainty.",
    tr: "Kararı veya soruyu belirle, ilgili kanıtları ve seçenekleri karşılaştır; belirsizlikleri belirterek destekli sonuçlar sun.",
    zh: "明确决策或问题，比较相关证据和备选方案，然后给出有依据的结论并说明不确定性。",
  },
  research: {
    en: "Turn the question into focused evidence needs, evaluate source relevance and recency, then synthesize findings without invented citations.",
    tr: "Soruyu somut kanıt ihtiyaçlarına ayır, kaynakların ilgisini ve güncelliğini değerlendir; bulguları kaynak uydurmadan birleştir.",
    zh: "把问题转化为有针对性的证据需求，评估来源的相关性和时效性，然后综合发现，不要编造引用。",
  },
  content: {
    en: "Identify the audience, purpose and requested form; develop a coherent draft, then edit for accuracy, tone and format.",
    tr: "Hedef kitleyi, amacı ve istenen biçimi belirle; tutarlı bir taslak oluştur, ardından doğruluk, ton ve biçim açısından düzenle.",
    zh: "明确受众、目的和要求的形式；形成连贯的草稿，然后在准确性、语气和格式上进行编辑。",
  },
  media: {
    en: "Translate the brief into composition, style and required elements; produce the requested artifact and check its visual acceptance criteria.",
    tr: "İsteği kompozisyon, stil ve gerekli öğelere dönüştür; istenen çıktıyı oluştur ve görsel kabul ölçütlerini kontrol et.",
    zh: "把需求说明转化为构图、风格和必需元素；生成所要求的作品，并检查它的视觉验收标准。",
  },
  general: {
    en: "Break the goal into necessary decisions and deliverables, resolve dependencies, then evaluate the result against the task criteria.",
    tr: "Hedefi gerekli kararlara ve çıktılara ayır, bağımlılıkları çöz; sonucu görev ölçütleriyle değerlendir.",
    zh: "把目标拆分为必要的决策和交付物，理清依赖关系，然后对照任务标准评估结果。",
  },
};

const ENVIRONMENT_GUIDANCE: Record<ExecutionContext, Localized> = {
  chat: {
    en: "Chat: work from supplied context; do not assume repository, account or tool access. Supply usable artifacts or request the blocking input.",
    tr: "Sohbet: verilen bağlamla çalış; depo, hesap veya araç erişimi varsayma. Kullanılabilir çıktılar sun veya engelleyici girdiyi iste.",
    zh: "聊天：基于所提供的上下文工作；不要假设可以访问代码仓库、账户或工具。提供可用的成果，或索要阻碍进展的输入。",
  },
  mobile: {
    en: "Mobile: use compact, easy-to-copy output; preserve the requested format. Do not assume a terminal, local files or account access.",
    tr: "Mobil: kısa ve kolay kopyalanabilir çıktı kullan; istenen biçimi koru. Terminal, yerel dosya veya hesap erişimi varsayma.",
    zh: "手机：使用简洁、便于复制的输出；保持要求的格式。不要假设有终端、本地文件或账户访问权限。",
  },
  browser: {
    en: "Browser: use only context and tools actually available. Verify page-derived facts; a browser setting grants no account or publishing permission.",
    tr: "Tarayıcı: yalnızca mevcut bağlamı ve araçları kullan. Sayfadan alınan bilgileri doğrula; tarayıcı seçimi hesap veya yayın izni vermez.",
    zh: "浏览器：只使用实际可用的上下文和工具。核实来自网页的事实；浏览器环境不授予任何账户或发布权限。",
  },
  agent: {
    en: "Agent: use available tools only for owner-authorized work; verify actual results and report blockers without claiming unperformed actions.",
    tr: "Ajan: mevcut araçları yalnızca kullanıcının yetkilendirdiği işte kullan; gerçek sonuçları doğrula, yapılmamış işlemleri yapıldı diye bildirme.",
    zh: "智能体：只为用户授权的工作使用可用工具；验证实际结果并报告阻碍，不要声称执行了未执行的操作。",
  },
};

/** Target adaptation changes presentation and workflow, never the owner's requested operation. */
export function jailbreakTargetGuidance(target: ConcreteTarget, language: Language, executionRequested: boolean): string {
  const guidance: Record<ConcreteTarget, Localized> = {
    gpt: {
      en: "Use direct instructions, concrete evaluation criteria and a response structure suited to the requested deliverable.",
      tr: "Doğrudan talimatlar, somut değerlendirme ölçütleri ve istenen çıktıya uygun bir yanıt yapısı kullan.",
      zh: "使用直接的指令、具体的评估标准，以及适合所要求交付物的回答结构。",
    },
    claude: {
      en: "Keep task data separate from directives; organize evidence, assumptions and decisions into a coherent response.",
      tr: "Görev verisini talimatlardan ayır; kanıtları, varsayımları ve kararları tutarlı bir yanıt içinde düzenle.",
      zh: "把任务数据与指令分开；把证据、假设和决策组织成连贯的回答。",
    },
    gemini: {
      en: "Connect each task step to its input and deliverable; use visual or external tools only when available and relevant.",
      tr: "Her görev adımını girdisi ve çıktısıyla ilişkilendir; görsel veya harici araçları yalnızca mevcut ve ilgili olduğunda kullan.",
      zh: "把每个任务步骤与其输入和交付物联系起来；只在可用且相关时使用视觉或外部工具。",
    },
    codex: executionRequested ? {
      en: "Inspect the available project instructions and relevant files before making the authorized changes; run checks that test the actual behavior.",
      tr: "Yetkilendirilmiş değişikliklerden önce mevcut proje talimatlarını ve ilgili dosyaları incele; gerçek davranışı sınayan kontrolleri çalıştır.",
      zh: "在进行授权的改动之前，先检查可用的项目说明和相关文件；运行能检验实际行为的检查。",
    } : {
      en: "Give the requested analysis, advice or artifact. Selecting Codex does not authorize file changes, command execution or deployment.",
      tr: "İstenen analizi, öneriyi veya çıktıyı sun. Codex seçimi dosya değişikliği, komut çalıştırma veya dağıtım izni vermez.",
      zh: "给出所要求的分析、建议或成果。选择 Codex 并不授权修改文件、执行命令或部署。",
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
        : language === "zh" ? "将已知上下文作为证据，并标明假设。只询问会阻碍正确结果的缺失输入，同时继续不依赖该输入的工作。绝不从角色推断访问权限、事实或授权。"
        : "Bilinen bağlamı kanıt olarak kullan, varsayımları belirt. Yalnızca doğru sonucu engelleyen eksik girdiyi sor; bağımsız işe devam et. Bir rolden erişim, gerçek bilgi veya izin çıkarma.",
      output: language === "en"
        ? "Deliver exactly the requested format and artifacts. Keep explanations inside that format; omit unrelated features and extra sections."
        : language === "zh" ? "严格按要求的格式交付成果。解释应保持在该格式内，省略无关功能和额外章节。"
        : "Tam olarak istenen biçimi ve çıktıları sun. Açıklamaları o biçim içinde tut; ilgisiz özellikler ve ek bölümler ekleme.",
      verification: language === "en"
        ? "Check each deliverable against the success criteria, protected elements and active owner revisions. Report evidence, uncertainty and checks actually performed."
        : language === "zh" ? "对照成功标准、受保护的元素和有效的用户修订检查每一项交付物。报告证据、不确定性和实际进行的检查。"
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
