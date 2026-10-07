"use client";

import { useEffect, useRef } from "react";
import { TARGET_AIS, type TargetAI } from "@/models/common";
import { DEFAULT_COMPILE_OPTIONS, MODIFIER_ACTIONS, type CompileOptions, type CouncilMode, type ExecutionContext, type ModifierAction } from "@/models/options";
import type { ResolvedPrison } from "@/models/prison";
import type { PromptVersion } from "@/models/prompt";
import { modifierChanges } from "@/core/prison-engine/modifiers";
import {
  MODIFIER_LABELS,
  OPTION_VALUE_LABELS,
  TARGET_LABELS,
  TARGET_REASON_LABELS,
  VERSION_TRIGGER_LABELS,
} from "@/templates/ui-labels";
import { cx, relativeTime } from "@/ui/lib/format";
import { EXECUTION_CONTEXT_LABELS, EXECUTION_CONTEXT_OPTIONS } from "@/ui/common/execution-context";
import { COUNCIL_MODE_LABELS } from "@/ui/common/CouncilModePicker";
import { CouncilReviewPanel } from "@/ui/prompt-output/CouncilReviewPanel";
import { PromptHandoff } from "@/ui/participation/PromptHandoff";
import { PromptJourney } from "@/ui/participation/PromptJourney";
import styles from "./PromptOutput.module.css";

function isPressed(options: CompileOptions, action: ModifierAction): boolean {
  switch (action) {
    case "more_technical":
      return options.technicality === "technical";
    case "shorter":
      return options.verbosity === "concise";
    case "longer":
      return options.verbosity === "detailed";
    case "stricter":
      return options.scope === "strict";
    case "freer":
      return options.scope === "open";
    case "toggle_agent":
      return options.agentMode;
    case "toggle_jailbreak":
      return options.jailbreakMode;
  }
}

/** Only the settings that differ from the defaults, so the meta line stays readable. */
function optionSummary(options: CompileOptions): string[] {
  const parts = [
    options.verbosity !== DEFAULT_COMPILE_OPTIONS.verbosity && OPTION_VALUE_LABELS.verbosity[options.verbosity],
    options.technicality !== DEFAULT_COMPILE_OPTIONS.technicality && OPTION_VALUE_LABELS.technicality[options.technicality],
    options.scope !== DEFAULT_COMPILE_OPTIONS.scope && OPTION_VALUE_LABELS.scope[options.scope],
    options.agentMode && "Agent modu",
    options.jailbreakMode && "JB Modu",
    options.executionContext !== "chat" && EXECUTION_CONTEXT_LABELS[options.executionContext],
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts : ["Varsayılan ayarlar"];
}

function generationLabel(version: PromptVersion): string {
  const generation = version.generation;
  if (!generation) return "Bu sürümün üretim kaynağı kaydedilmemiş";
  if (generation.source === "ai") {
    const engine = [generation.provider, generation.model].filter(Boolean).join(" · ");
    return engine ? `AI ile üretildi · ${engine}` : "AI ile üretildi";
  }
  return generation.source === "local" ? "Yerel motorla üretildi" : "Prompt derleyicisi ile üretildi";
}

interface PromptOutputProps {
  prison: ResolvedPrison;
  viewVersion: number | null;
  busy: boolean;
  onViewVersion: (version: number) => void;
  onModify: (action: ModifierAction) => void;
  onRetarget: (target: TargetAI) => void;
  onExecutionContext?: (context: ExecutionContext) => void;
  onCouncilMode?: (mode: CouncilMode) => void;
  councilEnabled?: boolean;
  onRegenerate: () => void;
  onRestore: (version: number) => void;
  onRevise?: (feedback: string) => Promise<boolean>;
}

export function PromptOutput({
  prison,
  viewVersion,
  busy,
  onViewVersion,
  onModify,
  onRetarget,
  onExecutionContext,
  onCouncilMode,
  councilEnabled = true,
  onRegenerate,
  onRestore,
  onRevise,
}: PromptOutputProps) {
  const versions = prison.promptVersions;
  const shown: PromptVersion | undefined =
    versions.find((v) => v.version === (viewVersion ?? prison.activeVersion)) ?? versions.at(-1);
  const isActive = shown?.version === prison.activeVersion;
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tabsRef.current?.scrollTo({ left: tabsRef.current.scrollWidth, behavior: "smooth" });
  }, [versions.length]);

  if (!shown) return null;

  const { critic } = shown;
  const unresolved = critic.issues.filter((issue) => !issue.fixed);
  const warnings = unresolved.filter((issue) => issue.severity !== "low");
  const isJailbreak = shown.options.jailbreakMode;

  return (
    <section className={cx(styles.root, isJailbreak && styles.jailbreakRoot)} aria-label="Üretilen prompt">
      <div className={styles.topbar}>
        <div className={styles.tabs} ref={tabsRef} role="tablist" aria-label="Prompt sürümleri">
          {versions.map((version) => (
            <button
              key={version.version}
              type="button"
              role="tab"
              aria-selected={version.version === shown.version}
              className={cx(
                styles.tab,
                version.version === shown.version && styles.tabSelected,
                version.version === prison.activeVersion && styles.tabActive,
                version.options.jailbreakMode && styles.tabJailbreak,
              )}
              onClick={() => onViewVersion(version.version)}
              title={`${VERSION_TRIGGER_LABELS[version.trigger]}${version.note ? ` — ${version.note}` : ""}`}
            >
              {version.options.jailbreakMode ? "JB " : ""}v{version.version}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.target} lang="en">
          {TARGET_LABELS[shown.resolvedTarget]}
        </span>
        <span>
          {shown.targetAI === "auto" ? "AUTO · " : ""}
          {TARGET_REASON_LABELS[shown.targetReason]}
        </span>
        <span className={styles.sep} aria-hidden>
          ·
        </span>
        <span>{optionSummary(shown.options).join(" · ")}</span>
        <span className={styles.sep} aria-hidden>
          ·
        </span>
        <span>
          {VERSION_TRIGGER_LABELS[shown.trigger]}, {relativeTime(shown.createdAt)}
        </span>
      </div>

      {!isActive ? (
        <div className={styles.historyNote}>
          <span>v{shown.version} görüntüleniyor. Aktif sürüm v{prison.activeVersion}.</span>
          <button type="button" className="btn" onClick={() => onRestore(shown.version)} disabled={busy}>
            Bu sürüme dön
          </button>
        </div>
      ) : null}

      {isJailbreak && (
        <div className={styles.jbBanner}>
          <strong>JB Modu Aktif:</strong> {generationLabel(shown)}. Hedef AI: {TARGET_LABELS[shown.resolvedTarget]}.
        </div>
      )}

      {shown.councilReview ? <CouncilReviewPanel review={shown.councilReview} /> : null}

      <pre className={cx(styles.prompt, busy && styles.dimmed, isJailbreak && styles.jbPrompt)} tabIndex={0} aria-label="Prompt metni">
        {shown.text}
      </pre>

      <PromptHandoff
        text={shown.text}
        version={shown.version}
        target={shown.resolvedTarget}
        context={shown.options.executionContext ?? "chat"}
        active={isActive}
        busy={busy}
        onRevise={onRevise}
      />
      <PromptJourney stage="ready" councilEvidence={Boolean(shown.councilReview)} compact />

      <div className={styles.toolbar} role="toolbar" aria-label="Prompt ayarları">
        {MODIFIER_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className={cx("btn", action === "toggle_jailbreak" && shown.options.jailbreakMode && styles.btnJailbreakActive)}
            aria-pressed={isPressed(shown.options, action)}
            disabled={busy || !isActive || !modifierChanges(prison.compileOptions, action)}
            onClick={() => onModify(action)}
          >
            {MODIFIER_LABELS[action]}
          </button>
        ))}
        <label className={styles.targetSelect}>
          <span className="label">Hedef AI</span>
          <select
            value={shown.targetAI}
            disabled={busy || !isActive}
            onChange={(e) => onRetarget(e.target.value as TargetAI)}
            aria-label="Hedef AI değiştir"
          >
            {TARGET_AIS.map((target) => (
              <option key={target} value={target}>
                {TARGET_LABELS[target]}
              </option>
            ))}
          </select>
        </label>
        {onExecutionContext ? (
          <label className={styles.targetSelect}>
            <span className="label">Kullanım</span>
            <select value={shown.options.executionContext ?? "chat"} disabled={busy || !isActive} onChange={(e) => onExecutionContext(e.target.value as ExecutionContext)} aria-label="Promptun kullanım ortamını değiştir">
              {EXECUTION_CONTEXT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
        {onCouncilMode && councilEnabled ? (
          <label className={styles.targetSelect}>
            <span className="label">Masa</span>
            <select value={shown.options.councilMode ?? "competition"} disabled={busy || !isActive || !councilEnabled} onChange={(e) => onCouncilMode(e.target.value as CouncilMode)} aria-label="AI çalışma masasını değiştir">
              {Object.entries(COUNCIL_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ) : null}
        <button type="button" className={`btn ${styles.regenerate}`} onClick={onRegenerate} disabled={busy}>
          Promptu yeniden üret
        </button>
      </div>

      <div className={styles.validation} aria-label="Üretim ve kalite kontrolü">
        <div className={styles.validationHeading}>
          <h3>Üretim ve kontrol bilgisi</h3>
          <span className={cx(styles.badge, warnings.length ? styles.badgeWarn : isJailbreak ? styles.badgeJb : styles.badgeOk)}>
            {warnings.length ? `${warnings.length} kontrol notu` : isJailbreak ? "JB · kontrol edildi" : "Kontrol edildi"}
          </span>
        </div>
        <dl className={styles.evidence}>
          <div>
            <dt>Prompt üretimi</dt>
            <dd>{generationLabel(shown)}</dd>
          </div>
          <div>
            <dt>Kalite incelemesi</dt>
            <dd>{critic.llmReviewed ? "Kural kontrolü + AI eleştirmeni" : "Kural kontrolü"}</dd>
          </div>
          <div>
            <dt>Düzeltmeler</dt>
            <dd>{critic.refined ? `${critic.appliedFixes.length} düzeltmeyle yeniden üretildi` : "Otomatik düzeltme uygulanmadı"}</dd>
          </div>
        </dl>
        {critic.llmError ? <p className={styles.reviewError}>AI incelemesi tamamlanamadı: {critic.llmError}</p> : null}
        <p className={styles.validationText}>Kontroller, hazırlanan promptun yapısını ve görevle uyumunu değerlendirir.</p>
        {unresolved.length || critic.appliedFixes.length ? (
          <details className={styles.details}>
            <summary>Kontrol notları ({unresolved.length} açık, {critic.appliedFixes.length} düzeltme)</summary>
            <ul>
              {unresolved.map((issue, i) => (
                <li key={`w${i}`} className={styles.warnItem}>
                  {issue.message}
                </li>
              ))}
              {critic.appliedFixes.map((fix, i) => (
                <li key={`f${i}`} className={styles.fixItem}>
                  {fix}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
