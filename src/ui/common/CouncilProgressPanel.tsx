"use client";

import { useEffect, useState } from "react";
import type { CouncilProgress } from "@/ui/lib/api";
import styles from "./CouncilProgressPanel.module.css";

const STAGE_LABELS: Record<CouncilProgress["stage"], string> = {
  preflight: "Modellerin erişimi kontrol ediliyor",
  research: "Modeller görevi kendi alanlarından inceliyor",
  proposals: "Prompt adayları hazırlanıyor",
  peer_review: "Modeller birbirini değerlendiriyor",
  revision: "Adaylar geri bildirime göre iyileştiriliyor",
  voting: "İyileştirilen adaylar karşılaştırılıyor",
  validation: "Seçilen prompt son kontrolden geçiyor",
};

export function CouncilProgressPanel({ progress }: { progress: CouncilProgress }) {
  const [elapsed, setElapsed] = useState<ReturnType<typeof elapsedOperationTime>>(null);
  useEffect(() => watchElapsedOperationTime(progress.startedAt, setElapsed), [progress.startedAt]);
  return (
    <section className={styles.root} aria-label="AI masası ilerlemesi">
      <div className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        <span className="spinner" aria-hidden />
        <div className={styles.copy}>
          <strong>{STAGE_LABELS[progress.stage]}</strong>
          <p>{progress.message}</p>
        </div>
        {progress.total > 0 ? <span className={styles.count}>{progress.completed}/{progress.total} tamamlandı</span> : null}
      </div>
      <span className={styles.elapsed} aria-live="off">
        Geçen süre {elapsed ? <time dateTime={`PT${elapsed.seconds}S`}>{elapsed.label}</time> : "…"}
      </span>
    </section>
  );
}
/** A reload or a new stage keeps the same recorded start; no estimated completion is implied. */
export function elapsedOperationTime(startedAt: string, now: number): { seconds: number; label: string } | null {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return { seconds, label: hours > 0 ? `${hours} sa ${minutes} dk ${remainder} sn` : minutes > 0 ? `${minutes} dk ${remainder} sn` : `${remainder} sn` };
}

export function watchElapsedOperationTime(startedAt: string, onElapsed: (value: ReturnType<typeof elapsedOperationTime>) => void): () => void {
  const update = () => onElapsed(elapsedOperationTime(startedAt, Date.now()));
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}
