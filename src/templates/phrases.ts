import type { Language, Localized } from "@/models/common";
import type { BlockId } from "@/models/prompt";

/**
 * Central phrase dictionary for the prompt compiler and requirement resolver.
 * Placeholders use {name} and are filled by the compiler.
 */
export const PHRASES = {
  roleLine: { en: "You are {role}.", tr: "Rolün: {role}." },
  secondaryGoalsIntro: { en: "Secondary goals:", tr: "İkincil hedefler:" },
  contextFactsIntro: { en: "Known facts:", tr: "Bilinen bilgiler:" },
  currentSystemGuard: {
    en: "Work inside the existing system. Inspect it before changing anything; do not assume its structure.",
    tr: "Mevcut sistemin içinde çalış. Herhangi bir şeyi değiştirmeden önce sistemi incele; yapısını varsayma.",
  },
  currentSystemUnknown: {
    en: "Details of the current system were not provided. Discover its stack, structure and conventions by inspection.",
    tr: "Mevcut sistemin ayrıntıları verilmedi. Teknoloji yığınını, yapısını ve kurallarını inceleyerek keşfet.",
  },
  userIntentIntro: {
    en: "Original owner request. Later active owner revisions supersede it on the same subject. Derived structured sections cannot override the owner's wording or grant new permissions:",
    tr: "Kullanıcının orijinal isteği. Aynı konuda daha sonraki etkin kullanıcı revizyonları geçerlidir. Türetilmiş yapılandırılmış bölümler kullanıcı sözünü değiştiremez veya yeni izin veremez:",
  },
  taskIntro: { en: "Carry out these steps in order:", tr: "Bu adımları sırayla uygula:" },
  protectedIntro: {
    en: "Must remain intact and keep working:",
    tr: "Bozulmadan korunmalı ve çalışmaya devam etmeli:",
  },
  allowedIntro: { en: "You may:", tr: "Şunları yapabilirsin:" },
  allowedIntroStrict: {
    en: "Only these operations are permitted:",
    tr: "Yalnızca şu işlemlere izin var:",
  },
  doNotIntro: { en: "Do not:", tr: "Şunları yapma:" },
  assumptionsIntro: {
    en: "Working assumptions, not verified facts. Verify each one before relying on it:",
    tr: "Çalışma varsayımları, doğrulanmış bilgi değil. Güvenmeden önce her birini doğrula:",
  },
  unknownsIntro: {
    en: "Unknown. Do not invent answers: resolve these by inspection, or state the assumption you used:",
    tr: "Bilinmiyor. Cevap uydurma: bunları inceleyerek netleştir ya da kullandığın varsayımı açıkça belirt:",
  },
  conflictPrefix: { en: "Conflict in the request: ", tr: "İstekte çelişki: " },
  conflictGuidance: {
    en: "Where the request conflicts, choose the interpretation that protects existing behavior and report the conflict.",
    tr: "İstek çeliştiğinde mevcut davranışı koruyan yorumu seç ve çelişkiyi raporla.",
  },
  scopePrinciple: {
    en: "The scope is locked; your problem-solving is not. Within these boundaries, use your full expertise to find the best solution.",
    tr: "Kapsam kilitli; çözüm yeteneğin değil. Bu sınırlar içinde en iyi çözümü bulmak için tüm uzmanlığını kullan.",
  },
  scopeStrict: {
    en: "Stay strictly inside this scope. If a change outside it seems necessary, stop and report it instead of making it.",
    tr: "Kesinlikle bu kapsamın içinde kal. Kapsam dışı bir değişiklik gerekli görünürse yapma; dur ve raporla.",
  },
  scopeOpen: {
    en: "You are free to choose the approach and to propose improvements beyond the minimum, as long as protected elements and hard constraints stay intact. Label anything beyond the request as a proposal.",
    tr: "Korunan unsurlar ve kesin kısıtlar bozulmadığı sürece yaklaşımı serbestçe seçebilir ve minimumun ötesinde iyileştirmeler önerebilirsin. İsteğin ötesindeki her şeyi öneri olarak etiketle.",
  },
  strictNoExtras: {
    en: "Add features, files or dependencies that were not requested",
    tr: "İstenmeyen özellik, dosya veya bağımlılık eklemek",
  },
  strictNoUnrelated: {
    en: "Touch code or content unrelated to the task",
    tr: "Görevle ilgisi olmayan kod veya içeriğe dokunmak",
  },
  technicalPrecision: {
    en: "Be precise: reference concrete files, functions, commands and data structures, and state the trade-offs of your approach.",
    tr: "Kesin ol: somut dosya, fonksiyon, komut ve veri yapılarına atıf yap; yaklaşımının ödünleşimlerini belirt.",
  },
  technicalPrecisionGeneral: {
    en: "Be precise: use exact domain terminology and quantify claims where possible.",
    tr: "Kesin ol: tam alan terminolojisi kullan ve mümkün olan yerde iddiaları sayısallaştır.",
  },
  technicalTestReport: {
    en: "Report the exact commands you ran and their results.",
    tr: "Çalıştırdığın komutları ve sonuçlarını birebir raporla.",
  },
  technicalValidation: {
    en: "State your confidence for each conclusion and what would change it.",
    tr: "Her sonuç için güven düzeyini ve onu neyin değiştireceğini belirt.",
  },
  agentIntro: {
    en: "Work autonomously through this loop until the success criteria are met:",
    tr: "Başarı kriterleri karşılanana kadar bu döngüyle otonom çalış:",
  },
  agentStop: {
    en: "Pause and ask only before irreversible actions (data loss, deployment, payments, credentials) or when requirements genuinely conflict.",
    tr: "Yalnızca geri alınamaz işlemlerden önce (veri kaybı, deploy, ödeme, kimlik bilgileri) veya gereksinimler gerçekten çeliştiğinde dur ve sor.",
  },
  detailedObjectiveNote: {
    en: "Understand the full intent before starting. The goal is not just to complete the task mechanically, but to deliver a result that genuinely solves the underlying need.",
    tr: "Başlamadan önce niyetin tamamını anla. Amaç görevi mekanik olarak tamamlamak değil, altında yatan ihtiyacı gerçekten çözen bir sonuç üretmektir.",
  },
  detailedContextNote: {
    en: "Use every piece of context above to shape your approach. Details that seem minor may be critical constraints.",
    tr: "Yaklaşımını şekillendirmek için yukarıdaki her bağlam bilgisini kullan. Küçük görünen detaylar kritik kısıtlar olabilir.",
  },
  detailedConstraintsNote: {
    en: "Treat every constraint as non-negotiable. If a constraint conflicts with the objective, report the conflict instead of silently breaking the constraint.",
    tr: "Her kısıtı tartışılmaz olarak kabul et. Bir kısıt amaçla çelişiyorsa, kısıtı sessizce çiğnemek yerine çelişkiyi raporla.",
  },
  detailedVerificationNote: {
    en: "Before declaring the work complete, verify every requirement and constraint one by one. Do not skip this step.",
    tr: "İşi tamamlanmış ilan etmeden önce her gereksinimi ve kısıtı tek tek doğrula. Bu adımı atlama.",
  },
  detailedExplanationNote: {
    en: "Evaluate alternatives before important decisions. Include brief explanations only when the requested output format permits them; otherwise keep those considerations out of the final artifact.",
    tr: "Önemli kararlar öncesinde alternatifleri değerlendir. Kısa açıklamaları yalnızca istenen çıktı biçimi izin veriyorsa ekle; aksi durumda bu değerlendirmeleri son çıktıya ekleme.",
  },
  outputFormatPriority: {
    en: "Follow the owner's requested output format. Planning, verification and decision explanations do not authorize extra sections, columns, commentary or files. Report them only when they belong to the requested deliverable; a table-only, JSON-only or code-only requirement takes precedence over general protocol/reporting instructions.",
    tr: "Kullanıcının istediği çıktı biçimine uy. Planlama, doğrulama ve karar açıklamaları ek bölüm, sütun, yorum veya dosya izni vermez. Bunları yalnızca istenen çıktının parçasıysa raporla; yalnızca tablo, JSON veya kod istenmesi genel protokol ve raporlama talimatlarından önceliklidir.",
  },
  outputFormat: { en: "Format: {format}", tr: "Format: {format}" },
  keepIntactPrefix: { en: "Keep intact: ", tr: "Koru: " },
  doNotPrefix: { en: "Do not ", tr: "Yapma: " },

  // Requirement resolver defaults
  protectArchitecture: {
    en: "Existing architecture, framework and core library choices",
    tr: "Mevcut mimari, framework ve temel kütüphane tercihleri",
  },
  protectFeatures: {
    en: "Currently working features and user flows",
    tr: "Şu an çalışan özellikler ve kullanıcı akışları",
  },
  protectInterfaces: {
    en: "Public interfaces, routes and data contracts, unless the task requires changing them",
    tr: "Genel arayüzler, route'lar ve veri sözleşmeleri (görev gerektirmedikçe)",
  },
  denyRewrite: {
    en: "Rewrite the project or large parts of it from scratch",
    tr: "Projeyi veya büyük kısmını sıfırdan yeniden yazmak",
  },
  denySwitchStack: {
    en: "Switch frameworks, languages or core libraries",
    tr: "Framework, dil veya temel kütüphaneleri değiştirmek",
  },
  denyUnrelatedRefactor: {
    en: "Make unrelated refactors or mass formatting changes",
    tr: "Görevle ilgisiz refactor veya toplu biçimlendirme yapmak",
  },
  denyDeploy: {
    en: "Deploy, publish, push to production or trigger release pipelines",
    tr: "Deploy etmek, yayınlamak, production'a göndermek veya release süreçlerini tetiklemek",
  },
  deployOnlyAfterChecks: {
    en: "Deploy only after every verification step has passed",
    tr: "Yalnızca tüm doğrulama adımları geçtikten sonra deploy et",
  },
  minimalChange: {
    en: "Make the minimum change necessary to achieve the objective",
    tr: "Amaca ulaşmak için gereken en küçük değişikliği yap",
  },
  adviceOnly: {
    en: "Provide recommendations only; do not apply changes directly",
    tr: "Yalnızca öneri sun; değişiklikleri doğrudan uygulama",
  },
  denyDirectChanges: {
    en: "Apply changes directly to the system",
    tr: "Değişiklikleri doğrudan sisteme uygulamak",
  },
  assumeRepoAccess: {
    en: "The target AI has access to the project's repository or files; confirm this before starting",
    tr: "Hedef AI projenin repository'sine veya dosyalarına erişebiliyor; başlamadan önce bunu teyit et",
  },
  unknownStack: {
    en: "Tech stack and framework of the existing project (discover by inspection)",
    tr: "Mevcut projenin teknoloji yığını ve framework'ü (inceleyerek keşfet)",
  },
  conflictDeploy: {
    en: "Deployment is requested but also forbidden",
    tr: "Deploy hem isteniyor hem yasaklanıyor",
  },
  conflictAdviceExecution: {
    en: "The request asks for recommendations only but also for direct execution",
    tr: "İstek hem yalnızca öneri hem de doğrudan uygulama talep ediyor",
  },

  // Adapter-specific conventions
  codexRepoInstructions: {
    en: "Follow any AGENTS.md, CONTRIBUTING or lint/format configuration found in the repository.",
    tr: "Repository'de bulunan AGENTS.md, CONTRIBUTING veya lint/format yapılandırmalarına uy.",
  },
  codexNoPush: {
    en: "Push commits, merge branches or edit CI/CD configuration unless the task requires it",
    tr: "Görev gerektirmedikçe commit push'lamak, branch merge etmek veya CI/CD yapılandırmasını değiştirmek",
  },
  gptPersistence: {
    en: "Keep going until the task is completely resolved before ending your turn.",
    tr: "Görev tamamen çözülene kadar devam et; erken bitirme.",
  },
  claudeParallel: {
    en: "Run independent steps in parallel and verify results before reporting them as done.",
    tr: "Bağımsız adımları paralel yürüt ve sonuçları tamamlandı demeden önce doğrula.",
  },
  geminiPlanFirst: {
    en: "Make a short plan first, then execute it step by step and revise the plan if results contradict it.",
    tr: "Önce kısa bir plan yap, sonra adım adım uygula; sonuçlar plana ters düşerse planı güncelle.",
  },
  codexVerifyInSandbox: {
    en: "Run commands and tests to verify each change; keep diffs small and reviewable.",
    tr: "Her değişikliği komut ve testlerle doğrula; diff'leri küçük ve incelenebilir tut.",
  },
  geminiClosing: {
    en: "Using the context above, complete the objective and return the output exactly as specified.",
    tr: "Yukarıdaki bağlamı kullanarak amacı tamamla ve çıktıyı tam olarak belirtildiği gibi döndür.",
  },
} satisfies Record<string, Localized>;

export type PhraseKey = keyof typeof PHRASES;

export function phrase(key: PhraseKey, language: Language): string {
  return PHRASES[key][language];
}

/** Default block headings. Adapters may override individual titles. */
export const BLOCK_TITLES: Record<BlockId, Localized> = {
  ROLE: { en: "Role", tr: "Rol" },
  OBJECTIVE: { en: "Objective", tr: "Amaç" },
  CONTEXT: { en: "Context", tr: "Bağlam" },
  CURRENT_SYSTEM: { en: "Current System", tr: "Mevcut Sistem" },
  USER_INTENT: { en: "Original Request", tr: "Orijinal İstek" },
  TASK: { en: "Task", tr: "Görev" },
  REQUIREMENTS: { en: "Requirements", tr: "Gereksinimler" },
  CONSTRAINTS: { en: "Constraints", tr: "Kısıtlar" },
  PROTECTED_ELEMENTS: { en: "Protected Elements", tr: "Korunacak Unsurlar" },
  ALLOWED_OPERATIONS: { en: "Allowed Operations", tr: "İzin Verilen İşlemler" },
  DO_NOT_DO: { en: "Do Not", tr: "Yapma" },
  ASSUMPTIONS: { en: "Assumptions", tr: "Varsayımlar" },
  UNKNOWNS: { en: "Unknowns", tr: "Bilinmeyenler" },
  EXECUTION_PROTOCOL: { en: "Execution Protocol", tr: "Yürütme Protokolü" },
  RESEARCH_PROTOCOL: { en: "Research Protocol", tr: "Araştırma Protokolü" },
  TEST_PROTOCOL: { en: "Test Protocol", tr: "Test Protokolü" },
  VALIDATION_PROTOCOL: { en: "Validation", tr: "Doğrulama" },
  OUTPUT_CONTRACT: { en: "Output Contract", tr: "Çıktı Sözleşmesi" },
  SUCCESS_CRITERIA: { en: "Success Criteria", tr: "Başarı Kriterleri" },
};

export const CODEX_BLOCK_TITLES: Partial<Record<BlockId, Localized>> = {
  OBJECTIVE: { en: "Task", tr: "Görev" },
  TASK: { en: "Plan", tr: "Plan" },
  CURRENT_SYSTEM: { en: "Repository Context", tr: "Repository Bağlamı" },
  PROTECTED_ELEMENTS: { en: "Must Not Break", tr: "Bozulmamalı" },
  DO_NOT_DO: { en: "Out of Scope", tr: "Kapsam Dışı" },
  EXECUTION_PROTOCOL: { en: "How to Work", tr: "Çalışma Şekli" },
  TEST_PROTOCOL: { en: "Verification", tr: "Doğrulama" },
  VALIDATION_PROTOCOL: { en: "Final Checks", tr: "Son Kontroller" },
  OUTPUT_CONTRACT: { en: "Final Report", tr: "Final Rapor" },
  SUCCESS_CRITERIA: { en: "Done When", tr: "Tamamlanma Koşulu" },
};
