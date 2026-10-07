"use client";

import type { CouncilReview } from "@/models/council";
import { EXECUTION_CONTEXT_LABELS } from "@/ui/common/execution-context";
import { COUNCIL_MODE_LABELS } from "@/ui/common/CouncilModePicker";
import { cx } from "@/ui/lib/format";
import { useI18n, type Translate } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import styles from "./CouncilReviewPanel.module.css";

const ROLE_LABELS: Record<string, readonly [string, string, string]> = {
  architect: ["Prompt tasarımcısı", "Prompt designer", "提示词设计师"],
  strategist: ["Yaklaşım uzmanı", "Strategy specialist", "策略专家"],
  intent: ["İstek analisti", "Request analyst", "需求分析师"],
  planner: ["Planlama uzmanı", "Planning specialist", "规划专家"],
  candidate: ["Prompt yazarı", "Prompt author", "提示词作者"],
  challenger: ["Karşı görüş", "Challenger", "挑战者"],
  critic: ["Kalite eleştirmeni", "Quality critic", "质量评审员"],
  verifier: ["Doğrulayıcı", "Verifier", "验证员"],
  constraint_guard: ["Sınır denetçisi", "Constraint reviewer", "约束检查员"],
  target_specialist: ["Hedef AI uzmanı", "Target AI specialist", "目标 AI 专家"],
  synthesizer: ["Birleştiren uzman", "Synthesis specialist", "综合专家"],
};

const STATUS_LABELS = {
  failed: ["Yanıt alınamadı", "No response", "未收到回复"],
  reviewed: ["Değerlendirildi", "Reviewed", "已评审"],
  eliminated: ["Elendi", "Eliminated", "已淘汰"],
  winner: ["Seçildi", "Selected", "已选定"],
} as const;

function modelLabel(model: string): string {
  return model.split("/").at(-1) ?? model;
}

function roleLabel(role: string, t: Translate): string {
  const copy = ROLE_LABELS[role];
  return copy ? t(copy[0], copy[1], copy[2]) : role;
}

function statusLabel(status: keyof typeof STATUS_LABELS, t: Translate): string {
  const copy = STATUS_LABELS[status];
  return t(copy[0], copy[1], copy[2]);
}

function scoreLabel(score: number | null): string {
  return score !== null && Number.isFinite(score) ? `${Math.round(score * 100)}/100` : "—";
}

export function CouncilReviewPanel({ review }: { review: CouncilReview }) {
  const { t } = useI18n();
  const label = useVocabulary();
  const failedCount = review.participants.filter((participant) => participant.status === "failed").length;
  const winner = review.participants.find((participant) => participant.id === review.winnerId);
  const participantNames = new Map(review.participants.map((participant) => [participant.id, modelLabel(participant.model)]));

  return (
    <section className={styles.root} aria-label={t("AI masası sonucu", "AI table result", "AI 讨论结果")}>
      <div className={styles.heading}>
        <div>
          <span className="label">{t("AI masası", "AI table", "AI 讨论桌")}</span>
          <h3>{label(COUNCIL_MODE_LABELS[review.mode])}</h3>
        </div>
        <span className={styles.rounds}>{t(`${review.participants.length} model · ${review.rounds} tur`, `${review.participants.length} models · ${review.rounds} rounds`, `${review.participants.length} 个模型 · ${review.rounds} 轮`)}</span>
      </div>

      <p className={styles.environment}>
        {t("Kullanım:", "Use in:", "使用场景：")} {label(EXECUTION_CONTEXT_LABELS[review.executionContext])}
      </p>

      <div className={styles.winner}>
        <span className="label">{review.selectionBasis === "finalist" ? t("Son denetimden geçen aday", "Finalist that passed the final review", "通过最终检查的候选方案") : review.mode === "competition" ? t("Kazanan prompt", "Winning prompt", "获胜提示词") : review.repairerModel && review.repairerModel !== review.winnerModel ? t("Masada seçilen model", "Model selected at the table", "讨论桌选定的模型") : t("Son promptu hazırlayan model", "Model that prepared the final prompt", "生成最终提示词的模型")}</span>
        <strong title={review.winnerModel}>{modelLabel(winner?.model ?? review.winnerModel)}</strong>
        <p>{review.decision}</p>
        {review.repairerModel ? <p>{t("Son düzeltmeyi hazırlayan:", "Final revision prepared by:", "最终修订由以下模型完成：")} <span title={review.repairerModel}>{modelLabel(review.repairerModel)}</span></p> : null}
      </div>

      {failedCount ? (
        <p className={styles.failureNotice}>
          {t(`${failedCount} modelin yanıtı tamamlanamadı. Seçim, yanıt veren modellerin adayları arasında yapıldı.`, `${failedCount} model responses could not be completed. Selection was made among candidates from the responding models.`, `${failedCount} 个模型未能完成回复。结果从已回复模型的候选方案中选出。`)}
        </p>
      ) : null}

      {review.replacements?.length ? (
        <ul className={styles.failureNotice} aria-label={t("Ön kontrolde değiştirilen modeller", "Models replaced during preflight", "预检查中被替换的模型")}>
          {review.replacements.map((entry) => (
            <li key={entry.model}>
              <span title={entry.model}>{modelLabel(entry.model)}</span> {t("ön kontrolde yanıt vermedi;", "did not respond during preflight;", "在预检查中未回复；")}{" "}
              {entry.replacement ? <>{t("yerine", "replaced by", "已替换为")} <span title={entry.replacement}>{modelLabel(entry.replacement)}</span>{t(" alındı.", ".", "。")}</> : t("uygun yedek bulunamadı.", "no suitable replacement was found.", "未找到合适的替代模型。")}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.tableScroll} tabIndex={0} aria-label={t("Model karşılaştırması", "Model comparison", "模型比较")}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>{t("Modellerin rolleri, yanıt durumları ve karşılaştırma puanları", "Model roles, response statuses and comparison scores", "模型角色、回复状态和比较评分")}</caption>
          <thead>
            <tr><th scope="col">{t("Model", "Model", "模型")}</th><th scope="col">{t("Rol", "Role", "角色")}</th><th scope="col">{t("Durum", "Status", "状态")}</th><th scope="col">{t("Karşılaştırma puanı", "Comparison score", "比较评分")}</th></tr>
          </thead>
          <tbody>
            {review.participants.map((participant) => (
              <tr key={participant.id} className={participant.id === review.winnerId ? styles.winnerRow : undefined}>
                <th scope="row"><span title={participant.model}>{modelLabel(participant.model)}</span><small>{participant.provider.toUpperCase()}</small></th>
                <td>{label(roleLabel(participant.role, t))}</td>
                <td><span className={cx(styles.status, participant.status === "failed" && styles.failed, participant.status === "winner" && styles.selected)}>{statusLabel(participant.status, t)}</span></td>
                <td className={styles.score}>{participant.status === "failed" ? "—" : scoreLabel(participant.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.scoreNote}>{t("Puanlar, bu görevdeki adayların AI değerlendirmesidir. Son prompt ayrıca görev kuralları ve kalite incelemesinden geçer.", "Scores are AI assessments of the candidates for this task. The final prompt also undergoes task-rule and quality review.", "评分是 AI 对此任务候选方案的评估。最终提示词还会经过任务规则与质量检查。")}</p>

      <details className={styles.discussion}>
        <summary>{t("Modellerin önerileri ve karşılıklı değerlendirmeleri", "Model proposals and peer reviews", "模型建议与相互评审")}</summary>
        <div className={styles.participants}>
          {review.participants.map((participant) => {
            const reviews = review.reviews.filter((item) => item.candidateId === participant.id);
            return (
              <article className={styles.participant} key={participant.id}>
                <h4>{modelLabel(participant.model)}</h4>
                {participant.error ? <p className={styles.failureNotice}>{participant.error}</p> : null}
                {participant.findings.length ? <ul>{participant.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul> : null}
                {reviews.map((item, index) => (
                  <div className={styles.peerReview} key={`${item.reviewerId}-${index}`}>
                    <strong>{participantNames.get(item.reviewerId) ?? item.reviewerId} · {item.stage === "final" ? t("Son tur değerlendirmesi", "Final round review", "最终轮评审") : t("Karşılıklı değerlendirme", "Peer review", "相互评审")}</strong>
                    {item.issues.length ? <ul>{item.issues.map((issue, issueIndex) => <li key={issueIndex}>{issue.message}</li>)}</ul> : <p>{t("Kaydedilmiş bir sorun yok.", "No issues were recorded.", "未记录问题。")}</p>}
                    {item.suggestions.length ? <ul>{item.suggestions.map((suggestion, suggestionIndex) => <li key={suggestionIndex}>{suggestion}</li>)}</ul> : null}
                  </div>
                ))}
                {participant.initialPrompt || participant.revisedPrompt ? (
                  <details className={styles.candidate}>
                    <summary>{t("Bu modelin prompt adayını göster", "Show this model's prompt candidate", "显示此模型的候选提示词")}</summary>
                    {participant.initialPrompt ? <><h5>{t("İlk aday", "Initial candidate", "初始候选方案")}</h5><pre tabIndex={0}>{participant.initialPrompt}</pre></> : null}
                    {participant.revisedPrompt ? <><h5>{t("Karşılıklı değerlendirmeden sonraki aday", "Candidate after peer review", "相互评审后的候选方案")}</h5><pre tabIndex={0}>{participant.revisedPrompt}</pre></> : null}
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </details>

      <p className={styles.finalReview}>{t("Son kalite incelemesi:", "Final quality review:", "最终质量检查：")} <span title={review.finalReviewerModel}>{modelLabel(review.finalReviewerModel)}</span></p>
    </section>
  );
}
