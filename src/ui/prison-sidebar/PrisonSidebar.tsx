"use client";

import type { PrisonSummary } from "@/models/prison";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import type { EngineHealthResult } from "@/models/engine-health";
import { EngineConnection } from "@/ui/common/EngineConnection";
import { getTaskType } from "@/core/task-types/registry";
import { TARGET_LABELS } from "@/templates/ui-labels";
import { cx, relativeTime } from "@/ui/lib/format";
import styles from "./PrisonSidebar.module.css";

interface PrisonSidebarProps {
  prisons: PrisonSummary[];
  activeId: string | null;
  engine: EngineStatus | null;
  council?: CouncilMetadata | null;
  engineLoading: boolean;
  engineHealth: EngineHealthResult | null;
  checkingEngine: boolean;
  onCheckEngine: () => void;
  onSettings?: () => void;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function PrisonSidebar({ prisons, activeId, engine, council, engineLoading, engineHealth, checkingEngine, onCheckEngine, onSettings, disabled, onSelect, onNew, onDelete }: PrisonSidebarProps) {
  return (
    <aside className={styles.root}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>PRISON</span>
      </div>

      <button type="button" className={`btn ${styles.newButton}`} onClick={onNew} disabled={disabled}>
        <span aria-hidden>+</span> Yeni istek
      </button>

      <div className={styles.listHeader}>
        <span className="label" lang="en">
          Prisons
        </span>
        <span className={styles.count}>{prisons.length}</span>
      </div>

      <nav className={styles.list} aria-label="Prisons">
        {prisons.length === 0 ? <p className={styles.empty}>Henüz prison yok. İlk isteğini yaz.</p> : null}
        {prisons.map((prison) => (
          <div key={prison.id} className={cx(styles.item, prison.id === activeId && styles.active)}>
            <button
              type="button"
              className={styles.itemMain}
              onClick={() => onSelect(prison.id)}
              disabled={disabled}
              aria-current={prison.id === activeId ? "page" : undefined}
            >
              <span className={styles.itemTitle}>{prison.title || "Adsız istek"}</span>
              <span className={styles.itemMeta}>
                {prison.taskType ? getTaskType(prison.taskType).label.tr : "—"} · {TARGET_LABELS[prison.targetAI]}
                {prison.versionCount ? ` · v${prison.versionCount}` : ""}
              </span>
              <span className={styles.itemTime}>{relativeTime(prison.updatedAt)}</span>
            </button>
            <button
              type="button"
              className={styles.delete}
              onClick={() => onDelete(prison.id)}
              disabled={disabled}
              aria-label={`${prison.title} prison'ını sil`}
              title="Sil"
            >
              ×
            </button>
          </div>
        ))}
      </nav>

      <EngineConnection engine={engine} council={council} loading={engineLoading} health={engineHealth} checking={checkingEngine} disabled={disabled} onCheck={onCheckEngine} />
      {onSettings ? <button type="button" className="btn" onClick={onSettings}>AI ekibim · API ayarları</button> : null}
    </aside>
  );
}
