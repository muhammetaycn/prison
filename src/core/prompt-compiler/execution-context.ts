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
  const zh: Record<ExecutionContext, string> = {
    chat: "对话环境：在对话中给出所要求的结果。不要假定拥有工具、文件或账户访问权限；缺少必要信息时向用户询问。",
    mobile: "手机对话：使用易读、易复制的指引，并严格保持所要求的输出格式。不要假定拥有终端、文件系统或账户访问权限；缺少关键信息时用简短的问题询问。",
    browser: "浏览器 AI：只使用本任务所需且确实可访问的网络资源。不要假定拥有账户、表单提交、发布或购买权限。使用来源时注明真实链接；绝不编造无法访问的数据。",
    agent: "智能体环境：只为用户授权的工作使用现有工具。先检查相关状态，再执行授权的工作并验证结果。不要自行增加访问、发布、部署或购买权限；清楚说明缺失的信息和阻碍。",
  };
  return { en, tr, zh }[language][context];
}
