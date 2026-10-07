"use client";

import type { PrisonSummary } from "@/models/prison";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import type { EngineHealthResult } from "@/models/engine-health";
import { EngineConnection } from "@/ui/common/EngineConnection";
import { getTaskType } from "@/core/task-types/registry";
import { TARGET_LABELS } from "@/templates/ui-labels";
import { cx, relativeTime } from "@/ui/lib/format";
import { useI18n } from "@/ui/i18n";
import { LanguageSelector } from "@/ui/i18n/LanguageSelector";
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
  const { locale, t } = useI18n();
  return (
    <aside className={styles.root}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>PRISON</span>
      </div>

      <LanguageSelector />

      <button type="button" className={`btn ${styles.newButton}`} onClick={onNew} disabled={disabled}>
        <span aria-hidden>+</span> {t("Yeni istek", "New request", "新建请求")}
      </button>

      <div className={styles.listHeader}>
        <span className="label">
          {t("İsteklerin", "Your requests", "你的请求")}
        </span>
        <span className={styles.count}>{prisons.length}</span>
      </div>

      <nav className={styles.list} aria-label={t("İsteklerin", "Your requests", "你的请求")}>
        {prisons.length === 0 ? <p className={styles.empty}>{t("İlk isteğini yaz; burası senin çalışma alanın.", "Start with your first request; this is your workspace.", "写下你的第一个请求，开启你的创作空间。")}</p> : null}
        {prisons.map((prison) => (
          <div key={prison.id} className={cx(styles.item, prison.id === activeId && styles.active)}>
            <button
              type="button"
              className={styles.itemMain}
              onClick={() => onSelect(prison.id)}
              disabled={disabled}
              aria-current={prison.id === activeId ? "page" : undefined}
            >
              <span className={styles.itemTitle}>{prison.title || t("Adsız istek", "Untitled request", "未命名请求")}</span>
              <span className={styles.itemMeta}>
                {prison.taskType ? (getTaskType(prison.taskType).label as Partial<Record<string, string>>)[locale] ?? getTaskType(prison.taskType).label.en : "—"} · {TARGET_LABELS[prison.targetAI]}
                {prison.versionCount ? ` · v${prison.versionCount}` : ""}
              </span>
              <span className={styles.itemTime}>{relativeTime(prison.updatedAt, Date.now(), locale)}</span>
            </button>
            <button
              type="button"
              className={styles.delete}
              onClick={() => onDelete(prison.id)}
              disabled={disabled}
              aria-label={t(`${prison.title} isteğini sil`, `Delete ${prison.title}`, `删除请求：${prison.title}`)}
              title={t("Sil", "Delete", "删除")}
            >
              ×
            </button>
          </div>
        ))}
      </nav>

      <EngineConnection engine={engine} council={council} loading={engineLoading} health={engineHealth} checking={checkingEngine} disabled={disabled} onCheck={onCheckEngine} />
      {onSettings ? <button type="button" className="btn" onClick={onSettings}>{t("AI ekibim · API ayarları", "My AI team · API settings", "我的 AI 团队 · API 设置")}</button> : null}
    </aside>
  );
}
