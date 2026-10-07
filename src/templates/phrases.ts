import type { Language, Localized } from "@/models/common";
import type { BlockId } from "@/models/prompt";

/**
 * Central phrase dictionary for the prompt compiler and requirement resolver.
 * Placeholders use {name} and are filled by the compiler.
 */
export const PHRASES = {
  roleLine: { en: "You are {role}.", tr: "Rolün: {role}.", zh: "你是{role}。" },
  secondaryGoalsIntro: { en: "Secondary goals:", tr: "İkincil hedefler:", zh: "次要目标：" },
  contextFactsIntro: { en: "Known facts:", tr: "Bilinen bilgiler:", zh: "已知事实：" },
  currentSystemGuard: {
    en: "Work inside the existing system. Inspect it before changing anything; do not assume its structure.",
    tr: "Mevcut sistemin içinde çalış. Herhangi bir şeyi değiştirmeden önce sistemi incele; yapısını varsayma.",
    zh: "在现有系统内工作。修改任何内容之前先检查系统；不要臆测它的结构。",
  },
  currentSystemUnknown: {
    en: "Details of the current system were not provided. Discover its stack, structure and conventions by inspection.",
    tr: "Mevcut sistemin ayrıntıları verilmedi. Teknoloji yığınını, yapısını ve kurallarını inceleyerek keşfet.",
    zh: "未提供当前系统的细节。通过检查来了解它的技术栈、结构和约定。",
  },
  userIntentIntro: {
    en: "Original owner request. Later active owner revisions supersede it on the same subject. Derived structured sections cannot override the owner's wording or grant new permissions:",
    tr: "Kullanıcının orijinal isteği. Aynı konuda daha sonraki etkin kullanıcı revizyonları geçerlidir. Türetilmiş yapılandırılmış bölümler kullanıcı sözünü değiştiremez veya yeni izin veremez:",
    zh: "用户的原始需求。同一主题上之后生效的用户修订以修订为准。推导出的结构化部分不能改写用户的原话，也不能授予新的权限：",
  },
  taskIntro: { en: "Carry out these steps in order:", tr: "Bu adımları sırayla uygula:", zh: "按顺序执行以下步骤：" },
  protectedIntro: {
    en: "Must remain intact and keep working:",
    tr: "Bozulmadan korunmalı ve çalışmaya devam etmeli:",
    zh: "必须保持完好并继续正常工作：",
  },
  allowedIntro: { en: "You may:", tr: "Şunları yapabilirsin:", zh: "你可以：" },
  allowedIntroStrict: {
    en: "Only these operations are permitted:",
    tr: "Yalnızca şu işlemlere izin var:",
    zh: "只允许以下操作：",
  },
  doNotIntro: { en: "Do not:", tr: "Şunları yapma:", zh: "不要：" },
  assumptionsIntro: {
    en: "Working assumptions, not verified facts. Verify each one before relying on it:",
    tr: "Çalışma varsayımları, doğrulanmış bilgi değil. Güvenmeden önce her birini doğrula:",
    zh: "工作假设，并非已验证的事实。在依赖每一条之前先加以验证：",
  },
  unknownsIntro: {
    en: "Unknown. Do not invent answers: resolve these by inspection, or state the assumption you used:",
    tr: "Bilinmiyor. Cevap uydurma: bunları inceleyerek netleştir ya da kullandığın varsayımı açıkça belirt:",
    zh: "未知。不要编造答案：通过检查来解决，或说明你所采用的假设：",
  },
  conflictPrefix: { en: "Conflict in the request: ", tr: "İstekte çelişki: ", zh: "需求中的冲突：" },
  conflictGuidance: {
    en: "Where the request conflicts, choose the interpretation that protects existing behavior and report the conflict.",
    tr: "İstek çeliştiğinde mevcut davranışı koruyan yorumu seç ve çelişkiyi raporla.",
    zh: "当需求存在冲突时，选择能保护现有行为的解释，并报告该冲突。",
  },
  scopePrinciple: {
    en: "The scope is locked; your problem-solving is not. Within these boundaries, use your full expertise to find the best solution.",
    tr: "Kapsam kilitli; çözüm yeteneğin değil. Bu sınırlar içinde en iyi çözümü bulmak için tüm uzmanlığını kullan.",
    zh: "范围是锁定的，但你解决问题的能力不受限制。在这些边界内，充分运用你的专业能力找到最佳方案。",
  },
  scopeStrict: {
    en: "Stay strictly inside this scope. If a change outside it seems necessary, stop and report it instead of making it.",
    tr: "Kesinlikle bu kapsamın içinde kal. Kapsam dışı bir değişiklik gerekli görünürse yapma; dur ve raporla.",
    zh: "严格保持在此范围内。如果似乎有必要做范围之外的改动，请停下来报告，而不是直接去做。",
  },
  scopeOpen: {
    en: "You are free to choose the approach and to propose improvements beyond the minimum, as long as protected elements and hard constraints stay intact. Label anything beyond the request as a proposal.",
    tr: "Korunan unsurlar ve kesin kısıtlar bozulmadığı sürece yaklaşımı serbestçe seçebilir ve minimumun ötesinde iyileştirmeler önerebilirsin. İsteğin ötesindeki her şeyi öneri olarak etiketle.",
    zh: "你可以自由选择方法，并提出超出最低要求的改进建议，只要受保护的元素和硬性约束保持完好。超出需求的内容都要标注为建议。",
  },
  strictNoExtras: {
    en: "Add features, files or dependencies that were not requested",
    tr: "İstenmeyen özellik, dosya veya bağımlılık eklemek",
    zh: "添加未被要求的功能、文件或依赖",
  },
  strictNoUnrelated: {
    en: "Touch code or content unrelated to the task",
    tr: "Görevle ilgisi olmayan kod veya içeriğe dokunmak",
    zh: "改动与任务无关的代码或内容",
  },
  technicalPrecision: {
    en: "Be precise: reference concrete files, functions, commands and data structures, and state the trade-offs of your approach.",
    tr: "Kesin ol: somut dosya, fonksiyon, komut ve veri yapılarına atıf yap; yaklaşımının ödünleşimlerini belirt.",
    zh: "要精确：引用具体的文件、函数、命令和数据结构，并说明你所选方案的取舍。",
  },
  technicalPrecisionGeneral: {
    en: "Be precise: use exact domain terminology and quantify claims where possible.",
    tr: "Kesin ol: tam alan terminolojisi kullan ve mümkün olan yerde iddiaları sayısallaştır.",
    zh: "要精确：使用准确的领域术语，并尽可能量化你的论断。",
  },
  technicalTestReport: {
    en: "Report the exact commands you ran and their results.",
    tr: "Çalıştırdığın komutları ve sonuçlarını birebir raporla.",
    zh: "报告你运行的确切命令及其结果。",
  },
  technicalValidation: {
    en: "State your confidence for each conclusion and what would change it.",
    tr: "Her sonuç için güven düzeyini ve onu neyin değiştireceğini belirt.",
    zh: "说明你对每个结论的把握程度，以及什么情况会改变它。",
  },
  agentIntro: {
    en: "Work autonomously through this loop until the success criteria are met:",
    tr: "Başarı kriterleri karşılanana kadar bu döngüyle otonom çalış:",
    zh: "自主地循环执行以下流程，直到满足成功标准：",
  },
  agentStop: {
    en: "Pause and ask only before irreversible actions (data loss, deployment, payments, credentials) or when requirements genuinely conflict.",
    tr: "Yalnızca geri alınamaz işlemlerden önce (veri kaybı, deploy, ödeme, kimlik bilgileri) veya gereksinimler gerçekten çeliştiğinde dur ve sor.",
    zh: "只有在执行不可逆操作（数据丢失、部署、付款、凭据）之前，或需求确实相互冲突时，才暂停并提问。",
  },
  detailedObjectiveNote: {
    en: "Understand the full intent before starting. The goal is not just to complete the task mechanically, but to deliver a result that genuinely solves the underlying need.",
    tr: "Başlamadan önce niyetin tamamını anla. Amaç görevi mekanik olarak tamamlamak değil, altında yatan ihtiyacı gerçekten çözen bir sonuç üretmektir.",
    zh: "开始之前先理解完整的意图。目标不只是机械地完成任务，而是交付真正解决根本需求的结果。",
  },
  detailedContextNote: {
    en: "Use every piece of context above to shape your approach. Details that seem minor may be critical constraints.",
    tr: "Yaklaşımını şekillendirmek için yukarıdaki her bağlam bilgisini kullan. Küçük görünen detaylar kritik kısıtlar olabilir.",
    zh: "利用上面的每一条上下文来塑造你的方法。看似次要的细节可能是关键约束。",
  },
  detailedConstraintsNote: {
    en: "Treat every constraint as non-negotiable. If a constraint conflicts with the objective, report the conflict instead of silently breaking the constraint.",
    tr: "Her kısıtı tartışılmaz olarak kabul et. Bir kısıt amaçla çelişiyorsa, kısıtı sessizce çiğnemek yerine çelişkiyi raporla.",
    zh: "把每一条约束都视为不可协商。如果某条约束与目标冲突，请报告冲突，而不是悄悄打破约束。",
  },
  detailedVerificationNote: {
    en: "Before declaring the work complete, verify every requirement and constraint one by one. Do not skip this step.",
    tr: "İşi tamamlanmış ilan etmeden önce her gereksinimi ve kısıtı tek tek doğrula. Bu adımı atlama.",
    zh: "在宣布工作完成之前，逐条验证每一项需求和约束。不要跳过这一步。",
  },
  detailedExplanationNote: {
    en: "Evaluate alternatives before important decisions. Include brief explanations only when the requested output format permits them; otherwise keep those considerations out of the final artifact.",
    tr: "Önemli kararlar öncesinde alternatifleri değerlendir. Kısa açıklamaları yalnızca istenen çıktı biçimi izin veriyorsa ekle; aksi durumda bu değerlendirmeleri son çıktıya ekleme.",
    zh: "在做重要决定之前评估备选方案。只有在要求的输出格式允许时才附上简短说明；否则不要把这些考虑写进最终成果。",
  },
  outputFormatPriority: {
    en: "Follow the owner's requested output format. Planning, verification and decision explanations do not authorize extra sections, columns, commentary or files. Report them only when they belong to the requested deliverable; a table-only, JSON-only or code-only requirement takes precedence over general protocol/reporting instructions.",
    tr: "Kullanıcının istediği çıktı biçimine uy. Planlama, doğrulama ve karar açıklamaları ek bölüm, sütun, yorum veya dosya izni vermez. Bunları yalnızca istenen çıktının parçasıysa raporla; yalnızca tablo, JSON veya kod istenmesi genel protokol ve raporlama talimatlarından önceliklidir.",
    zh: "遵循用户要求的输出格式。规划、验证和决策说明并不授权你添加额外的章节、列、评论或文件。只有当它们属于所要求的交付物时才报告；“只要表格”“只要 JSON”或“只要代码”的要求优先于一般的流程/报告指令。",
  },
  outputFormat: { en: "Format: {format}", tr: "Format: {format}", zh: "格式：{format}" },
  keepIntactPrefix: { en: "Keep intact: ", tr: "Koru: ", zh: "保持不变：" },
  doNotPrefix: { en: "Do not ", tr: "Yapma: ", zh: "不要" },

  // Requirement resolver defaults
  protectArchitecture: {
    en: "Existing architecture, framework and core library choices",
    tr: "Mevcut mimari, framework ve temel kütüphane tercihleri",
    zh: "现有的架构、框架和核心库选择",
  },
  protectFeatures: {
    en: "Currently working features and user flows",
    tr: "Şu an çalışan özellikler ve kullanıcı akışları",
    zh: "当前正常工作的功能和用户流程",
  },
  protectInterfaces: {
    en: "Public interfaces, routes and data contracts, unless the task requires changing them",
    tr: "Genel arayüzler, route'lar ve veri sözleşmeleri (görev gerektirmedikçe)",
    zh: "公共接口、路由和数据契约，除非任务要求修改它们",
  },
  denyRewrite: {
    en: "Rewrite the project or large parts of it from scratch",
    tr: "Projeyi veya büyük kısmını sıfırdan yeniden yazmak",
    zh: "从头重写项目或其中的大部分",
  },
  denySwitchStack: {
    en: "Switch frameworks, languages or core libraries",
    tr: "Framework, dil veya temel kütüphaneleri değiştirmek",
    zh: "更换框架、语言或核心库",
  },
  denyUnrelatedRefactor: {
    en: "Make unrelated refactors or mass formatting changes",
    tr: "Görevle ilgisiz refactor veya toplu biçimlendirme yapmak",
    zh: "进行无关的重构或大规模格式化改动",
  },
  denyDeploy: {
    en: "Deploy, publish, push to production or trigger release pipelines",
    tr: "Deploy etmek, yayınlamak, production'a göndermek veya release süreçlerini tetiklemek",
    zh: "部署、发布、推送到生产环境或触发发布流水线",
  },
  deployOnlyAfterChecks: {
    en: "Deploy only after every verification step has passed",
    tr: "Yalnızca tüm doğrulama adımları geçtikten sonra deploy et",
    zh: "只有在所有验证步骤都通过之后才部署",
  },
  minimalChange: {
    en: "Make the minimum change necessary to achieve the objective",
    tr: "Amaca ulaşmak için gereken en küçük değişikliği yap",
    zh: "做出实现目标所需的最小改动",
  },
  adviceOnly: {
    en: "Provide recommendations only; do not apply changes directly",
    tr: "Yalnızca öneri sun; değişiklikleri doğrudan uygulama",
    zh: "只提供建议；不要直接应用改动",
  },
  denyDirectChanges: {
    en: "Apply changes directly to the system",
    tr: "Değişiklikleri doğrudan sisteme uygulamak",
    zh: "直接把改动应用到系统中",
  },
  assumeRepoAccess: {
    en: "The target AI has access to the project's repository or files; confirm this before starting",
    tr: "Hedef AI projenin repository'sine veya dosyalarına erişebiliyor; başlamadan önce bunu teyit et",
    zh: "目标 AI 可以访问项目的代码仓库或文件；开始之前先确认这一点",
  },
  unknownStack: {
    en: "Tech stack and framework of the existing project (discover by inspection)",
    tr: "Mevcut projenin teknoloji yığını ve framework'ü (inceleyerek keşfet)",
    zh: "现有项目的技术栈和框架（通过检查来了解）",
  },
  conflictDeploy: {
    en: "Deployment is requested but also forbidden",
    tr: "Deploy hem isteniyor hem yasaklanıyor",
    zh: "需求既要求部署又禁止部署",
  },
  conflictAdviceExecution: {
    en: "The request asks for recommendations only but also for direct execution",
    tr: "İstek hem yalnızca öneri hem de doğrudan uygulama talep ediyor",
    zh: "需求既只要求建议，又要求直接执行",
  },

  // Adapter-specific conventions
  codexRepoInstructions: {
    en: "Follow any AGENTS.md, CONTRIBUTING or lint/format configuration found in the repository.",
    tr: "Repository'de bulunan AGENTS.md, CONTRIBUTING veya lint/format yapılandırmalarına uy.",
    zh: "遵循代码仓库中的 AGENTS.md、CONTRIBUTING 或 lint/格式化配置。",
  },
  codexNoPush: {
    en: "Push commits, merge branches or edit CI/CD configuration unless the task requires it",
    tr: "Görev gerektirmedikçe commit push'lamak, branch merge etmek veya CI/CD yapılandırmasını değiştirmek",
    zh: "推送提交、合并分支或修改 CI/CD 配置，除非任务需要",
  },
  gptPersistence: {
    en: "Keep going until the task is completely resolved before ending your turn.",
    tr: "Görev tamamen çözülene kadar devam et; erken bitirme.",
    zh: "在结束本轮之前持续工作，直到任务完全解决。",
  },
  claudeParallel: {
    en: "Run independent steps in parallel and verify results before reporting them as done.",
    tr: "Bağımsız adımları paralel yürüt ve sonuçları tamamlandı demeden önce doğrula.",
    zh: "并行执行相互独立的步骤，并在报告完成之前验证结果。",
  },
  geminiPlanFirst: {
    en: "Make a short plan first, then execute it step by step and revise the plan if results contradict it.",
    tr: "Önce kısa bir plan yap, sonra adım adım uygula; sonuçlar plana ters düşerse planı güncelle.",
    zh: "先制定一个简短的计划，然后逐步执行；如果结果与计划矛盾，就修订计划。",
  },
  codexVerifyInSandbox: {
    en: "Run commands and tests to verify each change; keep diffs small and reviewable.",
    tr: "Her değişikliği komut ve testlerle doğrula; diff'leri küçük ve incelenebilir tut.",
    zh: "运行命令和测试来验证每一处改动；保持差异小且便于审查。",
  },
  geminiClosing: {
    en: "Using the context above, complete the objective and return the output exactly as specified.",
    tr: "Yukarıdaki bağlamı kullanarak amacı tamamla ve çıktıyı tam olarak belirtildiği gibi döndür.",
    zh: "利用上面的上下文完成目标，并严格按照规定返回输出。",
  },
} satisfies Record<string, Localized>;

export type PhraseKey = keyof typeof PHRASES;

export function phrase(key: PhraseKey, language: Language): string {
  return PHRASES[key][language];
}

/** Default block headings. Adapters may override individual titles. */
export const BLOCK_TITLES: Record<BlockId, Localized> = {
  ROLE: { en: "Role", tr: "Rol", zh: "角色" },
  OBJECTIVE: { en: "Objective", tr: "Amaç", zh: "目标" },
  CONTEXT: { en: "Context", tr: "Bağlam", zh: "上下文" },
  CURRENT_SYSTEM: { en: "Current System", tr: "Mevcut Sistem", zh: "当前系统" },
  USER_INTENT: { en: "Original Request", tr: "Orijinal İstek", zh: "原始需求" },
  TASK: { en: "Task", tr: "Görev", zh: "任务" },
  REQUIREMENTS: { en: "Requirements", tr: "Gereksinimler", zh: "需求" },
  CONSTRAINTS: { en: "Constraints", tr: "Kısıtlar", zh: "约束" },
  PROTECTED_ELEMENTS: { en: "Protected Elements", tr: "Korunacak Unsurlar", zh: "受保护的元素" },
  ALLOWED_OPERATIONS: { en: "Allowed Operations", tr: "İzin Verilen İşlemler", zh: "允许的操作" },
  DO_NOT_DO: { en: "Do Not", tr: "Yapma", zh: "禁止事项" },
  ASSUMPTIONS: { en: "Assumptions", tr: "Varsayımlar", zh: "假设" },
  UNKNOWNS: { en: "Unknowns", tr: "Bilinmeyenler", zh: "未知项" },
  EXECUTION_PROTOCOL: { en: "Execution Protocol", tr: "Yürütme Protokolü", zh: "执行流程" },
  RESEARCH_PROTOCOL: { en: "Research Protocol", tr: "Araştırma Protokolü", zh: "研究流程" },
  TEST_PROTOCOL: { en: "Test Protocol", tr: "Test Protokolü", zh: "测试流程" },
  VALIDATION_PROTOCOL: { en: "Validation", tr: "Doğrulama", zh: "验证" },
  OUTPUT_CONTRACT: { en: "Output Contract", tr: "Çıktı Sözleşmesi", zh: "输出契约" },
  SUCCESS_CRITERIA: { en: "Success Criteria", tr: "Başarı Kriterleri", zh: "成功标准" },
};

export const CODEX_BLOCK_TITLES: Partial<Record<BlockId, Localized>> = {
  OBJECTIVE: { en: "Task", tr: "Görev", zh: "任务" },
  TASK: { en: "Plan", tr: "Plan", zh: "计划" },
  CURRENT_SYSTEM: { en: "Repository Context", tr: "Repository Bağlamı", zh: "代码仓库上下文" },
  PROTECTED_ELEMENTS: { en: "Must Not Break", tr: "Bozulmamalı", zh: "不得破坏" },
  DO_NOT_DO: { en: "Out of Scope", tr: "Kapsam Dışı", zh: "超出范围" },
  EXECUTION_PROTOCOL: { en: "How to Work", tr: "Çalışma Şekli", zh: "工作方式" },
  TEST_PROTOCOL: { en: "Verification", tr: "Doğrulama", zh: "核查" },
  VALIDATION_PROTOCOL: { en: "Final Checks", tr: "Son Kontroller", zh: "最终检查" },
  OUTPUT_CONTRACT: { en: "Final Report", tr: "Final Rapor", zh: "最终报告" },
  SUCCESS_CRITERIA: { en: "Done When", tr: "Tamamlanma Koşulu", zh: "完成标准" },
};
