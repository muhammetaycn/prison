import type { TargetAI } from "@/models/common";
import type { CompileOptions, ModifierAction } from "@/models/options";
import type { PrisonStatus } from "@/models/prison";
import type { MemoryKind, TargetReason, VersionTrigger } from "@/models/prompt";
import type { DeploymentPermission, ItemListKey, ItemSource, Operation } from "@/models/spec";

/** Turkish UI vocabulary, shared by the UI and by server-side change logs. */

export const LIST_LABELS: Record<ItemListKey, { singular: string; plural: string }> = {
  secondaryGoals: { singular: "İkincil hedef", plural: "İkincil hedefler" },
  requirements: { singular: "Gereksinim", plural: "Gereksinimler" },
  constraints: { singular: "Kısıt", plural: "Kısıtlar" },
  protectedElements: { singular: "Korunacak", plural: "Korunacaklar" },
  allowedOperations: { singular: "İzin", plural: "İzin verilenler" },
  disallowedOperations: { singular: "Yasak", plural: "Yapılmayacaklar" },
  requiredActions: { singular: "Adım", plural: "Yapılacaklar" },
  assumptions: { singular: "Varsayım", plural: "Varsayımlar" },
  unknowns: { singular: "Bilinmeyen", plural: "Bilinmeyenler" },
  successCriteria: { singular: "Başarı kriteri", plural: "Başarı kriterleri" },
  contextFacts: { singular: "Bilgi", plural: "Bilinenler" },
  conflicts: { singular: "Çelişki", plural: "Çelişkiler" },
};

export const SOURCE_LABELS: Record<ItemSource, string> = {
  explicit: "açık istek",
  implicit: "çıkarım",
  default: "varsayılan",
  assumed: "varsayım",
  revision: "revizyon",
  critic: "kontrol",
};

export const OPERATION_LABELS: Record<Operation, string> = {
  modify_existing: "Mevcut sistemi değiştirme",
  create_new: "Yeni sistem oluşturma",
  analyze: "Analiz",
  advise: "Yalnızca öneri",
  research: "Araştırma",
  generate_content: "İçerik üretimi",
  generate_media: "Görsel/medya üretimi",
  automate: "Otomasyon",
  other: "Genel görev",
};

export const STATUS_LABELS: Record<PrisonStatus, string> = {
  RAW_REQUEST: "Ham istek",
  INTENT_PARSED: "Niyet çözümlendi",
  PRISON_CREATED: "Prison oluşturuldu",
  REQUIREMENTS_RESOLVED: "Gereksinimler çözüldü",
  READY_FOR_COMPILE: "Derlemeye hazır",
  PROMPT_COMPILED: "Prompt derlendi",
  PROMPT_RECOMPILED: "Prompt yeniden derlendi",
  PROMPT_VALIDATED: "Prompt doğrulandı",
  READY: "Hazır",
  USER_REVISION: "Revizyon",
  PRISON_UPDATED: "Prison güncellendi",
};

export const TARGET_LABELS: Record<TargetAI, string> = {
  auto: "AUTO",
  gpt: "GPT",
  claude: "Claude",
  gemini: "Gemini",
  codex: "Codex",
};

export const TARGET_REASON_LABELS: Record<TargetReason, string> = {
  user_selected: "seçimin",
  request_mentioned: "istekte geçiyor",
  coding_existing: "mevcut kod üzerinde çalışma",
  ai_recommendation: "analiz sonucuna göre",
  task_profile: "görev türüne göre",
};

export const VERSION_TRIGGER_LABELS: Record<VersionTrigger, string> = {
  initial: "İlk derleme",
  regenerate: "Yeniden üretildi",
  modifier: "Ayar değişikliği",
  revision: "Revizyon",
  target_change: "Hedef AI değişti",
  restore: "Geri yüklendi",
};

export const DEPLOYMENT_LABELS: Record<DeploymentPermission, string> = {
  allowed: "izinli",
  forbidden: "yasak",
  unspecified: "belirtilmedi",
};

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  constraint: "kısıt",
  protection: "koruma",
  prohibition: "yasak",
  requirement: "gereksinim",
  preference: "tercih",
  target: "hedef",
  style: "stil",
};

export const OPTION_VALUE_LABELS = {
  verbosity: { concise: "Kısa", standard: "Standart", detailed: "Detaylı" },
  technicality: { standard: "Standart", technical: "Teknik" },
  scope: { strict: "Katı scope", balanced: "Dengeli scope", open: "Özgür çözüm" },
  executionContext: { chat: "Normal sohbet", mobile: "Telefondaki AI", browser: "Tarayıcıdaki AI", agent: "Araç kullanan agent" },
  councilMode: { single: "Hızlı · tek model", competition: "Yarışma masası (ayrıntılı)", collaboration: "Ekip masası (ayrıntılı)" },
} satisfies {
  [K in Exclude<keyof CompileOptions, "agentMode" | "jailbreakMode">]: Record<CompileOptions[K], string>;
};

export const MODIFIER_LABELS: Record<ModifierAction, string> = {
  more_technical: "Daha Teknik",
  shorter: "Daha Kısa",
  longer: "Daha Detaylı",
  stricter: "Daha Katı Scope",
  freer: "Daha Özgür Çözüm",
  toggle_agent: "Agent Modu",
  toggle_jailbreak: "⛓️ JB Modu",
};
