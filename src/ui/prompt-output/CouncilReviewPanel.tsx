import type { CouncilReview } from "@/models/council";
import { EXECUTION_CONTEXT_LABELS } from "@/ui/common/execution-context";
import { COUNCIL_MODE_LABELS } from "@/ui/common/CouncilModePicker";
import { cx } from "@/ui/lib/format";
import styles from "./CouncilReviewPanel.module.css";

const ROLE_LABELS: Record<string, string> = {
  architect: "Prompt tasarımcısı",
  strategist: "Yaklaşım uzmanı",
  intent: "İstek analisti",
  planner: "Planlama uzmanı",
  candidate: "Prompt yazarı",
  challenger: "Karşı görüş",
  critic: "Kalite eleştirmeni",
  verifier: "Doğrulayıcı",
  constraint_guard: "Sınır denetçisi",
  target_specialist: "Hedef AI uzmanı",
  synthesizer: "Birleştiren uzman",
};

const STATUS_LABELS = {
  failed: "Yanıt alınamadı",
  reviewed: "Değerlendirildi",
  eliminated: "Elendi",
  winner: "Seçildi",
} as const;

function modelLabel(model: string): string {
  return model.split("/").at(-1) ?? model;
}

function scoreLabel(score: number | null): string {
  return score !== null && Number.isFinite(score) ? `${Math.round(score * 100)}/100` : "—";
}

export function CouncilReviewPanel({ review }: { review: CouncilReview }) {
  const failedCount = review.participants.filter((participant) => participant.status === "failed").length;
  const winner = review.participants.find((participant) => participant.id === review.winnerId);
  const participantNames = new Map(review.participants.map((participant) => [participant.id, modelLabel(participant.model)]));

  return (
    <section className={styles.root} aria-label="AI masası sonucu">
      <div className={styles.heading}>
        <div>
          <span className="label">AI masası</span>
          <h3>{COUNCIL_MODE_LABELS[review.mode]}</h3>
        </div>
        <span className={styles.rounds}>{review.participants.length} model · {review.rounds} tur</span>
      </div>

      <p className={styles.environment}>
        Kullanım: {EXECUTION_CONTEXT_LABELS[review.executionContext]}
      </p>

      <div className={styles.winner}>
        <span className="label">{review.selectionBasis === "finalist" ? "Son denetimden geçen aday" : review.mode === "competition" ? "Kazanan prompt" : review.repairerModel && review.repairerModel !== review.winnerModel ? "Masada seçilen model" : "Son promptu hazırlayan model"}</span>
        <strong title={review.winnerModel}>{modelLabel(winner?.model ?? review.winnerModel)}</strong>
        <p>{review.decision}</p>
        {review.repairerModel ? <p>Son düzeltmeyi hazırlayan: <span title={review.repairerModel}>{modelLabel(review.repairerModel)}</span></p> : null}
      </div>

      {failedCount ? (
        <p className={styles.failureNotice}>
          {failedCount} modelin yanıtı tamamlanamadı. Seçim, yanıt veren modellerin adayları arasında yapıldı.
        </p>
      ) : null}

      {review.replacements?.length ? (
        <ul className={styles.failureNotice} aria-label="Ön kontrolde değiştirilen modeller">
          {review.replacements.map((entry) => (
            <li key={entry.model}>
              <span title={entry.model}>{modelLabel(entry.model)}</span> ön kontrolde yanıt vermedi;{" "}
              {entry.replacement ? <>yerine <span title={entry.replacement}>{modelLabel(entry.replacement)}</span> alındı.</> : "uygun yedek bulunamadı."}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.tableScroll} tabIndex={0} aria-label="Model karşılaştırması">
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>Modellerin rolleri, yanıt durumları ve karşılaştırma puanları</caption>
          <thead>
            <tr><th scope="col">Model</th><th scope="col">Rol</th><th scope="col">Durum</th><th scope="col">Karşılaştırma puanı</th></tr>
          </thead>
          <tbody>
            {review.participants.map((participant) => (
              <tr key={participant.id} className={participant.id === review.winnerId ? styles.winnerRow : undefined}>
                <th scope="row"><span title={participant.model}>{modelLabel(participant.model)}</span><small>{participant.provider.toUpperCase()}</small></th>
                <td>{ROLE_LABELS[participant.role] ?? participant.role}</td>
                <td><span className={cx(styles.status, participant.status === "failed" && styles.failed, participant.status === "winner" && styles.selected)}>{STATUS_LABELS[participant.status]}</span></td>
                <td className={styles.score}>{participant.status === "failed" ? "—" : scoreLabel(participant.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.scoreNote}>Puanlar, bu görevdeki adayların AI değerlendirmesidir. Son prompt ayrıca görev kuralları ve kalite incelemesinden geçer.</p>

      <details className={styles.discussion}>
        <summary>Modellerin önerileri ve karşılıklı değerlendirmeleri</summary>
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
                    <strong>{participantNames.get(item.reviewerId) ?? item.reviewerId} · {item.stage === "final" ? "Son tur değerlendirmesi" : "Karşılıklı değerlendirme"}</strong>
                    {item.issues.length ? <ul>{item.issues.map((issue, issueIndex) => <li key={issueIndex}>{issue.message}</li>)}</ul> : <p>Kaydedilmiş bir sorun yok.</p>}
                    {item.suggestions.length ? <ul>{item.suggestions.map((suggestion, suggestionIndex) => <li key={suggestionIndex}>{suggestion}</li>)}</ul> : null}
                  </div>
                ))}
                {participant.initialPrompt || participant.revisedPrompt ? (
                  <details className={styles.candidate}>
                    <summary>Bu modelin prompt adayını göster</summary>
                    {participant.initialPrompt ? <><h5>İlk aday</h5><pre tabIndex={0}>{participant.initialPrompt}</pre></> : null}
                    {participant.revisedPrompt ? <><h5>Karşılıklı değerlendirmeden sonraki aday</h5><pre tabIndex={0}>{participant.revisedPrompt}</pre></> : null}
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </details>

      <p className={styles.finalReview}>Son kalite incelemesi: <span title={review.finalReviewerModel}>{modelLabel(review.finalReviewerModel)}</span></p>
    </section>
  );
}
