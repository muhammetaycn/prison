"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TargetAI } from "@/models/common";
import type { EngineHealthResult } from "@/models/engine-health";
import type { PrisonOperation } from "@/models/operation";
import type { ComposerInput } from "@/ui/lib/composer-draft";
import type { ModifierAction } from "@/models/options";
import { summarizePrison, type Prison, type PrisonSummary } from "@/models/prison";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import { MODIFIER_LABELS, TARGET_LABELS } from "@/templates/ui-labels";
import { EXECUTION_CONTEXT_LABELS } from "@/ui/common/execution-context";
import { COUNCIL_MODE_LABELS } from "@/ui/common/CouncilModePicker";
import { Composer } from "@/ui/composer/Composer";
import { api, ApiError, type CouncilProgress } from "@/ui/lib/api";
import { watchOperationProgress, type OperationProgressWatch, type OperationWatchPhase } from "@/ui/lib/operation-progress-watch";
import { PrisonSidebar } from "@/ui/prison-sidebar/PrisonSidebar";
import { PrisonView } from "@/ui/prison-view/PrisonView";
import { ProviderSettings } from "@/ui/settings/ProviderSettings";
import { I18nProvider, useI18n } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import { HandoffTaskProvider } from "@/ui/participation/HandoffTaskContext";
import styles from "./PrisonApp.module.css";

export interface BusyState {
  kind: "analyze" | "load" | "compile" | "modify" | "revise" | "restore" | "delete";
  label: string;
}

const QUERY_KEY = "p";

function readActiveIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(QUERY_KEY);
}

function writeActiveIdToUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(QUERY_KEY, id);
  else url.searchParams.delete(QUERY_KEY);
  window.history.replaceState(null, "", url);
}

export function PrisonApp() {
  return <I18nProvider><PrisonWorkspace /></I18nProvider>;
}

function PrisonWorkspace() {
  const { t } = useI18n();
  const label = useVocabulary();
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [council, setCouncil] = useState<CouncilMetadata | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineHealth, setEngineHealth] = useState<EngineHealthResult | null>(null);
  const [checkingEngine, setCheckingEngine] = useState(false);
  const [prisons, setPrisons] = useState<PrisonSummary[]>([]);
  const [active, setActive] = useState<Prison | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [progress, setProgress] = useState<{ id: string; value: CouncilProgress } | null>(null);
  const [operation, setOperation] = useState<PrisonOperation | null>(null);
  const [observed, setObserved] = useState<{ id: string; phase: OperationWatchPhase } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const operationInFlight = useRef(false);
  const engineCheckInFlight = useRef(false);
  const engineEpoch = useRef(0);
  const progressWatch = useRef<{ id: string; watch: OperationProgressWatch } | null>(null);
  const selectedId = useRef<string | null>(null);
  const selectionEpoch = useRef(0);
  const activeId = active?.id ?? null;
  const watchesProgress = busy?.kind === "compile" || busy?.kind === "modify" || busy?.kind === "revise";

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [activeId]);

  const mutationBlocked = useCallback((id: string) => {
    if (selectedId.current !== id) return false;
    const current = progressWatch.current;
    return !current || current.id !== id || !current.watch.canMutate();
  }, []);

  /** Runs an API operation with a busy label; failures surface as a dismissible error, never a crash. */
  const run = useCallback(async <T,>(state: BusyState, operation: () => Promise<T>, prisonId?: string): Promise<T | null> => {
    if (operationInFlight.current || (prisonId && mutationBlocked(prisonId))) return null;
    operationInFlight.current = true;
    if (state.kind === "compile" || state.kind === "modify" || state.kind === "revise") {
      setProgress(null);
      setOperation(null);
    }
    setBusy(state);
    setError(null);
    try {
      return await operation();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Beklenmeyen bir hata oluştu.", "An unexpected error occurred.", "发生了意外错误。"));
      if (err instanceof ApiError && err.details?.operation) {
        setOperation(err.details.operation);
        const failedProgress = err.details.operation.progress;
        if (failedProgress) setProgress({ id: err.details.operation.prisonId, value: failedProgress });
      }
      return null;
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  }, [mutationBlocked, t]);

  const refreshSummary = useCallback((prison: Prison) => {
    const summary = summarizePrison(prison);
    setPrisons((list) => [summary, ...list.filter((p) => p.id !== prison.id)]);
  }, []);

  /** Puts an updated prison on screen and refreshes its row in the sidebar. */
  const showPrison = useCallback((prison: Prison | null) => {
    selectionEpoch.current++;
    selectedId.current = prison?.id ?? null;
    setActive(prison);
    setViewVersion(null);
    writeActiveIdToUrl(prison?.id ?? null);
    if (prison) refreshSummary(prison);
  }, [refreshSummary]);

  useEffect(() => {
    setProgress((current) => current?.id === activeId ? current : null);
    setOperation((current) => current?.prisonId === activeId ? current : null);
    if (!activeId) { setObserved(null); return; }
    const watch = watchOperationProgress({
      id: activeId, local: watchesProgress,
      readOperation: api.latestOperation, readPrison: api.get,
      onPhase: (phase) => {
        if (selectedId.current === activeId) setObserved({ id: activeId, phase });
      },
      onProgress: (value) => {
        if (selectedId.current === activeId) setProgress(value ? { id: activeId, value } : null);
      },
      onOperation: (value) => {
        if (selectedId.current === activeId) setOperation(value);
      },
      onCompleted: (prison) => {
        if (selectedId.current !== activeId) return;
        setActive(prison);
        setViewVersion(null);
        refreshSummary(prison);
      },
      onError: (err) => {
        if (selectedId.current === activeId) setError(err instanceof ApiError ? err.message : "Görevin güncel sonucu alınamadı.");
      },
    });
    progressWatch.current = { id: activeId, watch };
    return () => {
      watch.stop();
      if (progressWatch.current?.watch === watch) progressWatch.current = null;
    };
  }, [activeId, watchesProgress, refreshSummary]);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const initialSelection = selectionEpoch.current;
    void api
      .engine()
      .then((r) => {
        if (stopped) return;
        setEngine(r.engine);
        setCouncil(r.council ?? null);
      })
      .catch((err) => { if (!stopped) setError(err instanceof ApiError ? err.message : "Motor bilgisi alınamadı."); })
      .finally(() => { if (!stopped) setEngineLoading(false); });
    void api
      .list()
      .then((r) => {
        if (stopped) return;
        setPrisons((current) => {
          const rows = new Map(r.prisons.map((prison) => [prison.id, prison]));
          for (const prison of current) if (!rows.has(prison.id) || prison.updatedAt >= rows.get(prison.id)!.updatedAt) rows.set(prison.id, prison);
          return [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      })
      .catch((err) => { if (!stopped) setError(err instanceof ApiError ? err.message : "Prison listesi yüklenemedi."); });
    const id = readActiveIdFromUrl();
    if (id) {
      void api
        .getWithRetry(id, controller.signal)
        .then((r) => {
          if (!stopped && selectionEpoch.current === initialSelection) showPrison(r.prison);
        })
        .catch((err) => {
          if (stopped || selectionEpoch.current !== initialSelection) return;
          if (err instanceof ApiError && err.code === "not_found") writeActiveIdToUrl(null);
          else setError(err instanceof ApiError ? err.message : "Görev yüklenemedi.");
        });
    }
    return () => { stopped = true; controller.abort(); };
  }, [showPrison]);

  const analyze = async (input: ComposerInput): Promise<boolean> => {
    const result = await run({ kind: "analyze", label: t("İstek anlaşılıyor ve çözüm planı hazırlanıyor", "Understanding your request and preparing a plan", "正在理解你的请求并制定方案") }, () => api.create(input));
    if (result) showPrison(result.prison);
    return Boolean(result);
  };

  const checkEngine = async () => {
    if (!engine || engineCheckInFlight.current || operationInFlight.current) return;
    engineCheckInFlight.current = true;
    setCheckingEngine(true);
    const checkingEpoch = engineEpoch.current;
    try {
      const result = await api.checkEngine();
      if (checkingEpoch === engineEpoch.current) setEngineHealth(result.health);
    } catch (err) {
      if (checkingEpoch === engineEpoch.current) setEngineHealth({
        status: "error",
        provider: engine.provider,
        model: engine.model,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        message: err instanceof ApiError ? err.message : "Bağlantı kontrolü tamamlanamadı.",
      });
    } finally {
      engineCheckInFlight.current = false;
      setCheckingEngine(false);
    }
  };

  const select = async (id: string) => {
    if (id === active?.id || operationInFlight.current) return;
    const selection = ++selectionEpoch.current;
    const result = await run({ kind: "load", label: t("İstek açılıyor", "Opening request", "正在打开请求") }, () => api.get(id));
    if (result && selectionEpoch.current === selection) showPrison(result.prison);
  };

  const remove = async (id: string) => {
    if (operationInFlight.current || mutationBlocked(id)) return;
    const target = prisons.find((p) => p.id === id);
    if (!window.confirm(t(`"${target?.title ?? id}" silinsin mi? Bu işlem geri alınamaz.`, `Delete "${target?.title ?? id}"? This cannot be undone.`, `删除“${target?.title ?? id}”？此操作无法撤销。`))) return;
    const result = await run({ kind: "delete", label: t("Siliniyor", "Deleting", "正在删除") }, () => api.remove(id), id);
    if (result) {
      setPrisons((list) => list.filter((p) => p.id !== id));
      if (active?.id === id) showPrison(null);
    }
  };

  const withActive = async (state: BusyState, operation: (id: string) => Promise<{ prison: Prison }>) => {
    if (!active || selectedId.current !== active.id) return false;
    const id = active.id;
    const result = await run(state, () => operation(id), id);
    if (result && selectedId.current === id) showPrison(result.prison);
    return Boolean(result);
  };

  const phase = observed?.id === activeId ? observed.phase : "discovering";
  const remoteBusy: BusyState | null = !activeId || phase === "idle" ? null : {
    kind: phase === "running" ? "compile" : "load",
    label: phase === "running" ? t("Bu görevin devam eden işlemi izleniyor", "Following the ongoing work", "正在跟踪任务进度") : phase === "refreshing" ? t("Görevin güncel sonucu alınıyor", "Retrieving the latest result", "正在获取最新结果") : t("Görevin işlem durumu kontrol ediliyor", "Checking task status", "正在检查任务状态"),
  };
  const displayBusy = busy ?? remoteBusy;
  const shownVersion = active?.promptVersions.find((version) => version.version === (viewVersion ?? active.activeVersion)) ?? active?.promptVersions.at(-1);
  const handoffSpec = shownVersion?.specSnapshot ?? active?.spec;

  return (
    <div className={styles.shell}>
      <PrisonSidebar
        prisons={prisons}
        activeId={active?.id ?? null}
        engine={engine}
        council={council}
        engineLoading={engineLoading}
        engineHealth={engineHealth}
        checkingEngine={checkingEngine}
        onCheckEngine={() => void checkEngine()}
        onSettings={() => setShowSettings(true)}
        disabled={displayBusy !== null}
        onSelect={(id) => { setShowSettings(false); void select(id); }}
        onNew={() => { setShowSettings(false); showPrison(null); }}
        onDelete={(id) => void remove(id)}
      />

      <main className={styles.main} ref={mainRef}>
        {error ? (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setError(null)} aria-label={t("Hatayı kapat", "Dismiss error", "关闭错误提示")}>
              {t("Kapat", "Close", "关闭")}
            </button>
          </div>
        ) : null}

        {showSettings ? (
          <ProviderSettings onClose={() => setShowSettings(false)} onSaved={async () => {
            engineEpoch.current++; setEngineHealth(null);
            const result = await api.engine();
            setEngine(result.engine); setCouncil(result.council ?? null); setEngineHealth(null);
          }} />
        ) : active ? (
          <HandoffTaskProvider value={{ goal: handoffSpec?.primaryGoal, rawRequest: active.rawRequest, taskType: handoffSpec?.taskType, deliverables: handoffSpec?.expectedOutput.deliverables, successCriteria: handoffSpec?.successCriteria.map((item) => item.text) }}>
          <PrisonView
            prison={active}
            busy={displayBusy}
            progress={progress?.id === activeId ? progress.value : null}
            operation={operation?.prisonId === activeId ? operation : null}
            councilEnabled={Boolean(council?.enabled)}
            viewVersion={viewVersion}
            onViewVersion={setViewVersion}
            onCompile={(options) =>
              void withActive(
                { kind: "compile", label: council?.enabled && (options?.councilMode ?? active.compileOptions.councilMode) !== "single" ? t("Modeller prompt adaylarını hazırlıyor ve karşılaştırıyor", "The team is preparing and comparing prompts", "团队正在生成并比较提示词") : engine?.mode === "ai" ? t("AI promptu üretiyor ve denetliyor", "Your AI is generating and checking the prompt", "AI 正在生成并检查提示词") : t("Prompt hazırlanıyor ve denetleniyor", "Preparing and checking the prompt", "正在准备并检查提示词") },
                (id) => api.compile(id, options),
              )
            }
            onRetryOperation={(failed) =>
              void withActive({ kind: failed.kind === "compile" ? "compile" : failed.kind === "adjust" ? "modify" : "revise", label: t("Kaydedilen işlem yeniden deneniyor", "Retrying the saved operation", "正在重试已保存的操作") },
                () => api.retryOperation(failed.id))
            }
            onModify={(action: ModifierAction) =>
              void withActive({ kind: "modify", label: t(`${MODIFIER_LABELS[action]} uygulanıyor`, `Applying: ${label(MODIFIER_LABELS[action])}`, `正在应用：${label(MODIFIER_LABELS[action])}`) }, (id) =>
                api.modify(id, action),
              )
            }
            onRetarget={(target: TargetAI) =>
              void withActive({ kind: "modify", label: t(`${TARGET_LABELS[target]} için derleniyor`, `Preparing for ${TARGET_LABELS[target]}`, `正在为 ${TARGET_LABELS[target]} 准备`) }, (id) =>
                api.retarget(id, target),
              )
            }
            onExecutionContext={(executionContext) =>
              void withActive({ kind: "modify", label: t(`${EXECUTION_CONTEXT_LABELS[executionContext]} için hazırlanıyor`, `Preparing for ${label(EXECUTION_CONTEXT_LABELS[executionContext])}`, `正在为${label(EXECUTION_CONTEXT_LABELS[executionContext])}准备`) }, (id) =>
                api.executionContext(id, executionContext),
              )
            }
            onCouncilMode={(councilMode) =>
              void withActive({ kind: "modify", label: t(`${COUNCIL_MODE_LABELS[councilMode]} promptu hazırlıyor`, `Preparing prompt: ${label(COUNCIL_MODE_LABELS[councilMode])}`, `正在生成提示词：${label(COUNCIL_MODE_LABELS[councilMode])}`) }, (id) =>
                api.councilMode(id, councilMode),
              )
            }
            onRevise={(message) =>
              withActive({ kind: "revise", label: t("Revizyon uygulanıyor", "Applying your revision", "正在应用你的修改") }, (id) => api.revise(id, message))
            }
            onClarify={(clarifications) =>
              withActive({ kind: "revise", label: t("Yanıtlar işleniyor ve plan güncelleniyor", "Processing your answers and updating the plan", "正在处理你的回答并更新方案") }, (id) => api.clarify(id, clarifications))
            }
            onRestore={(version) =>
              void withActive({ kind: "restore", label: t(`v${version} geri yükleniyor`, `Restoring v${version}`, `正在恢复 v${version}`) }, (id) => api.restore(id, version))
            }
          />
          </HandoffTaskProvider>
        ) : (
          <Composer engine={engine} council={council} busy={busy?.kind === "analyze"} onSubmit={analyze} />
        )}
      </main>
    </div>
  );
}
