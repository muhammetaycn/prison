import type { Localized } from "@/models/common";
import type { TemplateLine } from "@/core/task-types/types";

/** Advisory work keeps the subject's expertise without inheriting implementation instructions. */
export const ADVISORY_TEMPLATES = {
  expectedFormat: {
    en: "Analysis or recommendations in the requested format",
    tr: "İstenen biçimde analiz veya öneriler",
  } satisfies Localized,
  protocol: [
    { text: {
      en: "Identify the question or decision and the relevant owner constraints before evaluating it.",
      tr: "Değerlendirmeden önce soruyu veya kararı ve ilgili kullanıcı kısıtlarını belirle.",
    } },
    { text: {
      en: "Evaluate the supplied context and relevant alternatives; distinguish supported facts from assumptions and unresolved questions.",
      tr: "Verilen bağlamı ve ilgili seçenekleri değerlendir; destekli gerçekleri varsayımlardan ve çözülmemiş sorulardan ayır.",
    } },
    { text: {
      en: "Provide the requested analysis or recommendation. Implementation steps and tests may be proposed when relevant; do not present them as changes made or checks performed.",
      tr: "İstenen analizi veya öneriyi sun. İlgiliyse uygulama adımları ve testler önerilebilir; bunları yapılmış değişiklikler veya çalıştırılmış kontroller gibi sunma.",
    } },
    { text: {
      en: "Check the conclusion against the requested scope, success criteria and exact output format.",
      tr: "Sonucu istenen kapsam, başarı ölçütleri ve kesin çıktı biçimiyle karşılaştır.",
    } },
  ] satisfies TemplateLine[],
  validation: [
    { text: {
      en: "Ensure each conclusion follows from available evidence; state a blocking uncertainty rather than inventing a result.",
      tr: "Her sonucun mevcut kanıtlardan çıktığını kontrol et; sonuç uydurmak yerine engelleyici belirsizliği belirt.",
    } },
    { text: {
      en: "Validate the proposed behavior and trade-offs against the owner's requirements without treating advice as authorization to modify the project.",
      tr: "Önerilen davranışı ve ödünleşimleri kullanıcı gereksinimleriyle doğrula; öneri isteğini projeyi değiştirme izni olarak yorumlama.",
    } },
  ] satisfies TemplateLine[],
  defaultActions: [
    { text: { en: "Define the question to answer using the supplied context", tr: "Verilen bağlamdan cevaplanacak soruyu tanımla" } },
    { text: { en: "Evaluate the relevant evidence and alternatives", tr: "İlgili kanıtları ve seçenekleri değerlendir" } },
    { text: { en: "Deliver the requested conclusions or recommendations", tr: "İstenen sonuçları veya önerileri sun" } },
  ] satisfies TemplateLine[],
  outputContract: [
    { text: { en: "The requested analysis or recommendation, supported by available context", tr: "Mevcut bağlamla desteklenen istenen analiz veya öneri" } },
  ] satisfies TemplateLine[],
  successCriteria: [
    { text: { en: "The owner's question is answered within the stated scope and requested format", tr: "Kullanıcının sorusu belirtilen kapsamda ve istenen biçimde cevaplanmış" } },
    { text: { en: "Conclusions are supported and unresolved uncertainties are identified", tr: "Sonuçlar desteklenmiş ve çözülmemiş belirsizlikler belirtilmiş" } },
  ] satisfies TemplateLine[],
};
