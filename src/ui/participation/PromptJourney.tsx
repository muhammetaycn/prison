"use client";

import { useI18n } from "@/ui/i18n";
import styles from "./PromptJourney.module.css";

export type JourneyStage = "input" | "analysis" | "working" | "ready" | "review";

interface PromptJourneyProps {
  stage: JourneyStage;
  councilEvidence?: boolean;
  compact?: boolean;
}

export function PromptJourney({ stage, councilEvidence = false, compact = false }: PromptJourneyProps) {
  const { t } = useI18n();
  const content: Record<JourneyStage, { title: string; detail: string }> = {
    input: { title: t("Rotayı sen çiziyorsun", "You set the direction", "由你决定方向"), detail: t("Ne başarmak istediğini, korunacak şeyleri ve beklediğin çıktı biçimini anlat. Bunlar hazırlanacak promptun talimatlarını belirler.", "Describe your goal, what must stay and the expected output format. These details shape the prompt's instructions.", "说明你的目标、需要保留的内容和预期输出格式。这些信息将决定提示词的指令。") },
    analysis: { title: t("İsteğin görev planına dönüşüyor", "Your request becomes a task plan", "把请求变成任务计划"), detail: t("Planı incele. Eksik bağlamı tamamlayabilir, sınırlarını düzeltebilirsin. Değişikliklerin sonraki prompta taşınır.", "Review the plan. Fill in missing context or adjust its boundaries; your changes carry into the next prompt.", "检查计划，补充缺少的背景或调整边界。你的改动会带入下一个提示词。") },
    working: { title: t("Şimdi prompt hazırlanıyor", "Your prompt is being prepared", "正在准备提示词"), detail: t("Kaydedilen açıklamalar, hangi önerinin neden değiştiğini gösterir. Sonuç hazır olduğunda tam promptu alıp hedef AI'da deneyebilirsin.", "Recorded explanations show which proposals changed and why. When ready, take the full prompt to the target AI and try it.", "记录的说明展示提案改动及其原因。完成后可以复制完整提示词，在目标 AI 中尝试。") },
    ready: { title: t("Şimdi kendi işinde dene", "Try it in your own work", "把它用到你的实际任务中"), detail: t("Bu çıktı, başka bir AI'a vereceğin görev tarifidir. Aldığın yanıtı kendi hedefinle karşılaştır; eksik kalan kısmı yeni bir talimatla düzeltebilirsin.", "This output is a task brief for another AI. Compare its response with your goal and refine any gaps with a new instruction.", "这是交给另一个 AI 的任务说明。将回答与你的目标对照，并用新指令补足差距。") },
    review: { title: t("Kaydedilen çalışmayı incele", "Review the recorded work", "查看已记录的工作"), detail: t("Bu sahne son tartışma kaydını gösterir. Promptun hazır olup olmadığını işlem sonucundan kontrol et; tamamlanamayan çalışmayı yeniden deneyebilirsin.", "This scene shows the latest discussion record. Check the operation result to see whether a prompt is ready; incomplete work can be retried.", "场景展示最近的讨论记录。请查看操作结果以确认提示词是否就绪；未完成的工作可以重试。") },
  };
  const current = content[stage];
  const detail = stage === "working" && !councilEvidence
    ? t("İsteğindeki hedef ve sınırlar prompta dönüştürülüyor. Sonuç hazır olduğunda tam promptu alıp hedef AI'da deneyebilirsin.", "Your goal and boundaries are being turned into a prompt. When ready, take the full prompt to your target AI and try it.", "正在把目标和边界转化为提示词。完成后可以复制完整提示词，在目标 AI 中尝试。")
    : current.detail;
  return (
    <details className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <summary>{current.title}<span>{t("Nasıl kullanırım?", "How do I use it?", "如何使用？")}</span></summary>
      <p>{detail}</p>
      <ol className={styles.steps} aria-label={t("İstekten kullanıma", "From request to use", "从请求到应用")}>
        <li><strong>{t("İsteğini anlat", "Describe your request", "说明请求")}</strong><span>{t("Hedef, sınır, çıktı.", "Goal, boundaries, output.", "目标、边界、输出。")}</span></li>
        <li><strong>{t("Planı netleştir", "Clarify the plan", "明确计划")}</strong><span>{t("Eksikleri cevapla.", "Fill in the gaps.", "补充缺失信息。")}</span></li>
        <li><strong>{councilEvidence ? t("Model önerilerini incele", "Review model proposals", "检查模型提案") : t("Promptu kontrol et", "Check the prompt", "检查提示词")}</strong><span>{councilEvidence ? t("Adaylar ve eleştiriler kayıtlıdır.", "Candidates and critiques are recorded.", "候选方案和评审已记录。") : t("Görevle uyumunu oku.", "Check that it matches your task.", "确认符合任务。")}</span></li>
        <li><strong>{t("Dene ve geliştir", "Try and refine", "尝试并完善")}</strong><span>{t("Kopyala, kullan, geri bildirim ver.", "Copy, use and give feedback.", "复制、使用并反馈。")}</span></li>
      </ol>
      <p className={styles.note}>{t("Arenadaki hareketler çalışmanın görsel anlatımıdır. Promptun talimatlarını değiştiren şey, verdiğin hedef ve geri bildirimdir.", "Arena motion illustrates the work. Your goal and feedback are what change the prompt's instructions.", "竞技场动作是工作的视觉呈现。改变提示词指令的是你的目标和反馈。")}</p>
    </details>
  );
}
