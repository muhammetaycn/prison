import type { Localized } from "@/models/common";
import type { TemplateLine } from "@/core/task-types/types";

/** Advisory work keeps the subject's expertise without inheriting implementation instructions. */
export const ADVISORY_TEMPLATES = {
  expectedFormat: {
    en: "Analysis or recommendations in the requested format",
    tr: "İstenen biçimde analiz veya öneriler",
    zh: "以要求的格式给出的分析或建议",
  } satisfies Localized,
  protocol: [
    { text: {
      en: "Identify the question or decision and the relevant owner constraints before evaluating it.",
      tr: "Değerlendirmeden önce soruyu veya kararı ve ilgili kullanıcı kısıtlarını belirle.",
      zh: "在评估之前，先明确问题或决策以及相关的用户约束。",
    } },
    { text: {
      en: "Evaluate the supplied context and relevant alternatives; distinguish supported facts from assumptions and unresolved questions.",
      tr: "Verilen bağlamı ve ilgili seçenekleri değerlendir; destekli gerçekleri varsayımlardan ve çözülmemiş sorulardan ayır.",
      zh: "评估所提供的上下文和相关备选方案；把有依据的事实与假设和未解决的问题区分开。",
    } },
    { text: {
      en: "Provide the requested analysis or recommendation. Implementation steps and tests may be proposed when relevant; do not present them as changes made or checks performed.",
      tr: "İstenen analizi veya öneriyi sun. İlgiliyse uygulama adımları ve testler önerilebilir; bunları yapılmış değişiklikler veya çalıştırılmış kontroller gibi sunma.",
      zh: "给出所要求的分析或建议。相关时可以提出实施步骤和测试；但不要把它们说成已经做出的改动或已经执行的检查。",
    } },
    { text: {
      en: "Check the conclusion against the requested scope, success criteria and exact output format.",
      tr: "Sonucu istenen kapsam, başarı ölçütleri ve kesin çıktı biçimiyle karşılaştır.",
      zh: "对照要求的范围、成功标准和确切的输出格式检查结论。",
    } },
  ] satisfies TemplateLine[],
  validation: [
    { text: {
      en: "Ensure each conclusion follows from available evidence; state a blocking uncertainty rather than inventing a result.",
      tr: "Her sonucun mevcut kanıtlardan çıktığını kontrol et; sonuç uydurmak yerine engelleyici belirsizliği belirt.",
      zh: "确保每个结论都来自现有证据；遇到阻碍性的不确定因素时要说明，而不是编造结果。",
    } },
    { text: {
      en: "Validate the proposed behavior and trade-offs against the owner's requirements without treating advice as authorization to modify the project.",
      tr: "Önerilen davranışı ve ödünleşimleri kullanıcı gereksinimleriyle doğrula; öneri isteğini projeyi değiştirme izni olarak yorumlama.",
      zh: "对照用户的需求验证所提出的行为和取舍，不要把建议当作修改项目的授权。",
    } },
  ] satisfies TemplateLine[],
  defaultActions: [
    { text: { en: "Define the question to answer using the supplied context", tr: "Verilen bağlamdan cevaplanacak soruyu tanımla", zh: "利用所提供的上下文明确需要回答的问题" } },
    { text: { en: "Evaluate the relevant evidence and alternatives", tr: "İlgili kanıtları ve seçenekleri değerlendir", zh: "评估相关证据和备选方案" } },
    { text: { en: "Deliver the requested conclusions or recommendations", tr: "İstenen sonuçları veya önerileri sun", zh: "给出所要求的结论或建议" } },
  ] satisfies TemplateLine[],
  outputContract: [
    { text: { en: "The requested analysis or recommendation, supported by available context", tr: "Mevcut bağlamla desteklenen istenen analiz veya öneri", zh: "基于现有上下文、有依据的所要求的分析或建议" } },
  ] satisfies TemplateLine[],
  successCriteria: [
    { text: { en: "The owner's question is answered within the stated scope and requested format", tr: "Kullanıcının sorusu belirtilen kapsamda ve istenen biçimde cevaplanmış", zh: "用户的问题在所述范围内、以要求的格式得到了回答" } },
    { text: { en: "Conclusions are supported and unresolved uncertainties are identified", tr: "Sonuçlar desteklenmiş ve çözülmemiş belirsizlikler belirtilmiş", zh: "结论有依据，未解决的不确定因素已被指出" } },
  ] satisfies TemplateLine[],
};
