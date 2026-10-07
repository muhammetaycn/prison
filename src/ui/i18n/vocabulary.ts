import { useI18n, type UILocale } from "./index";

/** Labels only: never apply this map to owner requests, model responses, or prompt text. */
const VOCABULARY: Record<string, readonly [en: string, zh: string]> = {
  "İkincil hedef": ["Secondary goal", "次要目标"], "İkincil hedefler": ["Secondary goals", "次要目标"],
  "Gereksinim": ["Requirement", "需求"], "Gereksinimler": ["Requirements", "需求"],
  "Kısıt": ["Constraint", "限制"], "Kısıtlar": ["Constraints", "限制"],
  "Korunacak": ["Protected element", "需保留的内容"], "Korunacaklar": ["Protected elements", "需保留的内容"],
  "İzin": ["Permission", "权限"], "İzin verilenler": ["Allowed actions", "允许的操作"],
  "Yasak": ["Prohibition", "禁止项"], "Yapılmayacaklar": ["Excluded actions", "禁止的操作"],
  "Adım": ["Step", "步骤"], "Yapılacaklar": ["Required actions", "必需操作"],
  "Varsayım": ["Assumption", "假设"], "Varsayımlar": ["Assumptions", "假设"],
  "Bilinmeyen": ["Unknown", "待确认项"], "Bilinmeyenler": ["Unknowns", "待确认项"],
  "Başarı kriteri": ["Success criterion", "成功标准"], "Başarı kriterleri": ["Success criteria", "成功标准"],
  "Bilgi": ["Fact", "信息"], "Bilinenler": ["Known facts", "已知信息"],
  "Çelişki": ["Conflict", "冲突"], "Çelişkiler": ["Conflicts", "冲突"],
  "açık istek": ["explicit request", "明确请求"], "çıkarım": ["inference", "推断"],
  "varsayılan": ["default", "默认"], "varsayım": ["assumption", "假设"],
  "revizyon": ["revision", "修改"], "kontrol": ["review", "检查"],
  "Mevcut sistemi değiştirme": ["Modify existing system", "修改现有系统"],
  "Yeni sistem oluşturma": ["Create new system", "创建新系统"],
  "Analiz": ["Analysis", "分析"], "Yalnızca öneri": ["Advice only", "仅提供建议"],
  "Araştırma": ["Research", "研究"], "İçerik üretimi": ["Content creation", "内容创作"],
  "Görsel/medya üretimi": ["Visual/media creation", "图像或媒体创作"],
  "Otomasyon": ["Automation", "自动化"], "Genel görev": ["General task", "通用任务"],
  "izinli": ["allowed", "已允许"], "yasak": ["forbidden", "已禁止"], "belirtilmedi": ["unspecified", "未指定"],
  "kısıt": ["constraint", "限制"], "koruma": ["protection", "保留"],
  "gereksinim": ["requirement", "需求"], "tercih": ["preference", "偏好"], "hedef": ["target", "目标"], "stil": ["style", "风格"],
  "seçimin": ["your choice", "你的选择"], "istekte geçiyor": ["mentioned in request", "请求中指定"],
  "mevcut kod üzerinde çalışma": ["work on existing code", "修改现有代码"],
  "analiz sonucuna göre": ["based on analysis", "根据分析"], "görev türüne göre": ["based on task type", "根据任务类型"],
  "İlk derleme": ["First generation", "首次生成"], "Yeniden üretildi": ["Regenerated", "重新生成"],
  "Ayar değişikliği": ["Settings changed", "设置已更改"], "Revizyon": ["Revision", "修改"],
  "Hedef AI değişti": ["Target AI changed", "目标 AI 已更改"], "Geri yüklendi": ["Restored", "已恢复"],
  "Kısa": ["Concise", "简洁"], "Standart": ["Standard", "标准"], "Detaylı": ["Detailed", "详细"], "Teknik": ["Technical", "技术性"],
  "Katı scope": ["Strict scope", "严格范围"], "Dengeli scope": ["Balanced scope", "平衡范围"], "Özgür çözüm": ["Open approach", "开放方案"],
  "Normal sohbet": ["AI chat", "AI 对话"], "Telefondaki AI": ["AI on your phone", "手机 AI"],
  "Tarayıcıdaki AI": ["AI in your browser", "浏览器 AI"], "Araç kullanan agent": ["Agent with tools", "可使用工具的智能体"],
  "Hızlı · tek model": ["Quick · single model", "快速 · 单模型"],
  "Uygulama planı uzmanı": ["Implementation planning specialist", "实施规划专家"],
  "Prompt yapısı uzmanı": ["Prompt structure specialist", "提示词结构专家"],
  "Alternatif yaklaşım uzmanı": ["Alternative approach specialist", "替代方案专家"],
  "Çıktı kalitesi uzmanı": ["Output quality specialist", "输出质量专家"],
  "Bağımsız eleştirmen": ["Independent critic", "独立评审员"],
  "Amaç ve kullanıcı sınırları uzmanı": ["Goal and user boundary specialist", "目标与用户边界专家"],
  "Yarışma masası (ayrıntılı)": ["Competition (detailed)", "竞争模式（详细）"],
  "Ekip masası (ayrıntılı)": ["Team discussion (detailed)", "团队讨论（详细）"],
  "Daha Teknik": ["More technical", "更具技术性"], "Daha Kısa": ["Shorter", "更简洁"],
  "Daha Detaylı": ["More detailed", "更详细"], "Daha Katı Scope": ["Stricter scope", "更严格的范围"],
  "Daha Özgür Çözüm": ["More open approach", "更开放的方案"], "Agent Modu": ["Agent mode", "智能体模式"],
  "⛓️ JB Modu": ["⛓️ JB mode", "⛓️ JB 模式"],
  "Ham istek": ["Raw request", "原始请求"], "Niyet çözümlendi": ["Intent understood", "意图已理解"],
  "Prison oluşturuldu": ["Task created", "任务已创建"], "Gereksinimler çözüldü": ["Requirements resolved", "需求已明确"],
  "Derlemeye hazır": ["Ready to generate", "可以生成"], "Prompt derlendi": ["Prompt generated", "提示词已生成"],
  "Prompt yeniden derlendi": ["Prompt regenerated", "提示词已重新生成"], "Prompt doğrulandı": ["Prompt checked", "提示词已检查"],
  "Hazır": ["Ready", "已就绪"], "Prison güncellendi": ["Task updated", "任务已更新"],
};

export function localizeUILabel(label: string, locale: UILocale): string {
  const translated = VOCABULARY[label];
  return locale === "tr" || !translated ? label : translated[locale === "en" ? 0 : 1];
}

export function useVocabulary() {
  const { locale } = useI18n();
  return (label: string) => localizeUILabel(label, locale);
}
