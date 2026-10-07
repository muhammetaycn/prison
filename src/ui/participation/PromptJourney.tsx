import styles from "./PromptJourney.module.css";

export type JourneyStage = "input" | "analysis" | "working" | "ready" | "review";

interface PromptJourneyProps {
  stage: JourneyStage;
  councilEvidence?: boolean;
  compact?: boolean;
}

const CONTENT: Record<JourneyStage, { title: string; detail: string }> = {
  input: { title: "Rotayı sen çiziyorsun", detail: "Ne başarmak istediğini, korunacak şeyleri ve beklediğin çıktı biçimini anlat. Bunlar hazırlanacak promptun talimatlarını belirler." },
  analysis: { title: "İsteğin görev planına dönüşüyor", detail: "Planı incele. Eksik bağlamı tamamlayabilir, sınırlarını düzeltebilirsin. Değişikliklerin sonraki prompta taşınır." },
  working: { title: "Şimdi prompt hazırlanıyor", detail: "Kaydedilen açıklamalar, hangi önerinin neden değiştiğini gösterir. Sonuç hazır olduğunda tam promptu alıp hedef AI'da deneyebilirsin." },
  ready: { title: "Şimdi kendi işinde dene", detail: "Bu çıktı, başka bir AI'a vereceğin görev tarifidir. Aldığın yanıtı kendi hedefinle karşılaştır; eksik kalan kısmı yeni bir talimatla düzeltebilirsin." },
  review: { title: "Kaydedilen çalışmayı incele", detail: "Bu sahne son tartışma kaydını gösterir. Promptun hazır olup olmadığını işlem sonucundan kontrol et; tamamlanamayan çalışmayı yeniden deneyebilirsin." },
};

export function PromptJourney({ stage, councilEvidence = false, compact = false }: PromptJourneyProps) {
  const content = CONTENT[stage];
  const detail = stage === "working" && !councilEvidence
    ? "İsteğindeki hedef ve sınırlar prompta dönüştürülüyor. Sonuç hazır olduğunda tam promptu alıp hedef AI'da deneyebilirsin."
    : content.detail;
  return (
    <details className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <summary>{content.title}<span>Nasıl kullanırım?</span></summary>
      <p>{detail}</p>
      <ol className={styles.steps} aria-label="İstekten kullanıma">
        <li><strong>İsteğini anlat</strong><span>Hedef, sınır, çıktı.</span></li>
        <li><strong>Planı netleştir</strong><span>Eksikleri cevapla.</span></li>
        <li><strong>{councilEvidence ? "Model önerilerini incele" : "Promptu kontrol et"}</strong><span>{councilEvidence ? "Adaylar ve eleştiriler kayıtlıdır." : "Görevle uyumunu oku."}</span></li>
        <li><strong>Dene ve geliştir</strong><span>Kopyala, kullan, geri bildirim ver.</span></li>
      </ol>
      <p className={styles.note}>Arenadaki hareketler çalışmanın görsel anlatımıdır. Promptun talimatlarını değiştiren şey, verdiğin hedef ve geri bildirimdir.</p>
    </details>
  );
}
