"use client";

import type { CouncilMode } from "@/models/options";
import { OPTION_VALUE_LABELS } from "@/templates/ui-labels";
import { Segmented } from "./Segmented";
import styles from "./ExecutionContextPicker.module.css";

export const COUNCIL_MODE_LABELS: Record<CouncilMode, string> = OPTION_VALUE_LABELS.councilMode;

const OPTIONS = [
  { value: "competition" as const, label: COUNCIL_MODE_LABELS.competition },
  { value: "collaboration" as const, label: COUNCIL_MODE_LABELS.collaboration },
];

interface CouncilModePickerProps {
  value: CouncilMode;
  disabled?: boolean;
  available?: boolean;
  onChange: (value: CouncilMode) => void;
}

export function CouncilModePicker({ value, disabled = false, available = true, onChange }: CouncilModePickerProps) {
  if (!available) {
    return (
      <div className={styles.root}>
        <span className="label">AI çalışma masası</span>
        <p className={styles.description}>Çok modelli AI masası henüz yapılandırılmadı. Üretim, mevcut motorla devam eder.</p>
      </div>
    );
  }
  return (
    <div className={styles.root}>
      <span className="label">AI çalışma masası</span>
      <Segmented label="AI çalışma masası" value={value} options={OPTIONS} disabled={disabled} onChange={onChange} />
      <p className={styles.description}>
        {value === "competition"
          ? "Kapışma: modeller önce görevi kendi alanlarından inceler, sonra yeşil sahada ayrı adaylarla yarışır. Her turda jüri puanlar, altı ölçütün her birinde en iyiye silah verilir, en zayıflar elenip jüriye geçer. Finalden önce en az üç tur dövüşürler; finalde kendi adayına oy vermeden en güçlü prompt kazanır."
          : "Masa: modeller karanlık odada önce görevi inceler, sonra oylama yapmadan tartışır ve birbirlerinden öğrenerek önerilerini geliştirir. Bir yazıcı ortak metni birleştirir; masa en az iki tur denetler ve herkes onaylayana kadar birlikte düzeltirler."}
      </p>
    </div>
  );
}
