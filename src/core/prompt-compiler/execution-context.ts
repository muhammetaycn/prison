import type { Language } from "@/models/common";
import type { ExecutionContext } from "@/models/options";

export function executionContextDirective(context: ExecutionContext = "chat", language: Language): string {
  const tr: Record<ExecutionContext, string> = {
    chat: "Normal sohbet ortamı: İstenen sonucu konuşma içinde üret. Araç, dosya veya hesap erişimini varmış gibi kabul etme; gereken bilgiyi kullanıcıdan iste.",
    mobile: "Telefon sohbeti: Kolay kopyalanabilen ve küçük ekranda okunabilen yönergeler kullan. İstenen çıktı biçimini koru. Dosya sistemi, terminal veya hesap erişimi varsayma; gereken bilgiyi kısa sorularla iste.",
    browser: "Tarayıcı yapay zekası: Yalnızca görev için gerekli ve gerçekten erişilebilir web kaynaklarını kullan. Hesap, form gönderimi, yayınlama veya satın alma yetkisi varsayma. Kaynak kullanırsan gerçek bağlantılarını belirt; erişemediğin verileri uydurma.",
    agent: "Agent ortamı: Yalnızca kullanıcının yetkilendirdiği işler için mevcut araçları kullan. Önce ilgili durumu incele, işi uygula ve sonucu doğrula. Erişim, yayınlama, dağıtım veya satın alma izni ekleme; engelleri ve eksik bilgiyi açıkça belirt.",
  };
  const en: Record<ExecutionContext, string> = {
    chat: "Chat environment: produce the requested result in the conversation. Do not assume tools, files or account access; ask for necessary missing information.",
    mobile: "Mobile chat: use readable, easily copied directions while preserving the exact output format. Do not assume a terminal, file system or account access. Ask concise questions for essential missing input.",
    browser: "Browser AI: use only genuinely available web resources required by this task. Do not assume account, submission, publishing or purchase permissions. Cite actual links when sources are used; never invent inaccessible data.",
    agent: "Agent environment: use available tools only for owner-authorized work. Inspect the relevant state, perform authorized work and verify the result. Do not add access, publication, deployment or purchase permissions. State missing information and blockers clearly.",
  };
  return (language === "tr" ? tr : en)[context];
}
