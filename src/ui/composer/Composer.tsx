"use client";

import { useEffect, useRef, useState } from "react";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import { LANGUAGE_OPTIONS, TARGET_OPTIONS } from "@/ui/common/options";
import { Segmented, type SegmentedOption } from "@/ui/common/Segmented";
import { ExecutionContextPicker } from "@/ui/common/ExecutionContextPicker";
import { CouncilModePicker } from "@/ui/common/CouncilModePicker";
import { PromptJourney } from "@/ui/participation/PromptJourney";
import { appendComposerHint } from "@/ui/participation/prompt-transfer";
import {
  clearComposerDraft,
  COMPOSER_TEXT_LIMIT,
  DEFAULT_COMPOSER_DRAFT,
  getComposerDraftStorage,
  readComposerDraft,
  saveComposerDraft,
  toComposerInput,
  type ComposerDraft,
  type ComposerInput,
  type DraftStorage,
  type PromptMode,
} from "@/ui/lib/composer-draft";
import { cx } from "@/ui/lib/format";
import styles from "./Composer.module.css";

const EXAMPLES = [
  "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.",
  "Mevcut sitemi bozmadan ana akışı daha görünür yapacak ve Google'dan gelen kullanıcıların ilgili tartışmaları direkt bulmasını sağlayacak Codex promptu üret.",
  "Windows bilgisayarımın güvenlik ayarlarını analiz edip sadece öneri sunacak bir prompt yaz.",
  "Instagram hesabım için 30 günlük içerik sistemi kuracak bir prompt hazırla.",
];

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<PromptMode>> = [
  { value: "auto", label: "İsteğe göre" },
  { value: "standard", label: "Standart" },
  { value: "jb", label: "JB modu" },
];

const MODE_DESCRIPTIONS: Record<PromptMode, string> = {
  auto: "Yazdığın isteğe göre standart veya JB modu seçilir.",
  standard: "Standart görev promptu hazırlanır.",
  jb: "JB çerçevesiyle, hedef AI'a göre uyarlanmış prompt hazırlanır.",
};

interface ComposerProps {
  engine: EngineStatus | null;
  council?: CouncilMetadata | null;
  busy: boolean;
  onSubmit: (input: ComposerInput) => Promise<boolean>;
}

export function Composer({ engine, council, busy, onSubmit }: ComposerProps) {
  const [draft, setDraft] = useState<ComposerDraft>({ ...DEFAULT_COMPOSER_DRAFT });
  const [restored, setRestored] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "unavailable">("idle");
  const [submitting, setSubmitting] = useState(false);
  const draftRef = useRef(draft);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const storageRef = useRef<DraftStorage | null>(null);
  const submittingRef = useRef(false);
  const disabled = busy || submitting || !restored;
  const canSubmit = draft.text.trim().length >= 3 && !disabled;

  useEffect(() => {
    storageRef.current = getComposerDraftStorage();
    const saved = readComposerDraft(storageRef.current);
    draftRef.current = saved;
    setDraft(saved);
    setRecovered(Boolean(saved.text.trim()));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) inputRef.current?.focus({ preventScroll: true });
  }, [restored]);

  const updateDraft = (patch: Partial<ComposerDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setRecovered(false);
    setSaveStatus(saveComposerDraft(storageRef.current, next) ? "saved" : "unavailable");
  };

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onSubmit(toComposerInput(draftRef.current))) {
        clearComposerDraft(storageRef.current);
        draftRef.current = { ...DEFAULT_COMPOSER_DRAFT };
        setDraft(draftRef.current);
        setRecovered(false);
        setSaveStatus("idle");
      }
    } catch {
      // The parent reports request errors. Keep the saved draft on failure.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const addHint = (hint: string) => {
    updateDraft({ text: appendComposerHint(draftRef.current.text, hint, COMPOSER_TEXT_LIMIT) });
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.root}>
      <header className={styles.hero}>
        <h1 className={styles.title}>PRISON</h1>
        <p className={styles.subtitle}>İsteğini anlat. Uygulanabilir bir AI promptuna dönüştürelim.</p>
      </header>

      <PromptJourney stage="input" />

      <div className={styles.modePicker}>
        <span className="label">Prompt modu</span>
        <Segmented label="Prompt modu" value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => updateDraft({ mode })} disabled={disabled} />
        <p className={styles.modeDescription}>{MODE_DESCRIPTIONS[draft.mode]}</p>
      </div>

      <div className={styles.tableSettings}>
        <ExecutionContextPicker value={draft.executionContext} onChange={(executionContext) => updateDraft({ executionContext })} disabled={disabled} />
        <CouncilModePicker value={draft.councilMode} onChange={(councilMode) => updateDraft({ councilMode })} disabled={disabled} available={Boolean(council?.enabled)} />
      </div>

      <div className={cx(styles.field, draft.mode === "jb" && styles.fieldJb)}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft.text}
          maxLength={COMPOSER_TEXT_LIMIT}
          onChange={(e) => updateDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Ne yaptırmak istiyorsun?"
          aria-label="Ne yaptırmak istiyorsun?"
          disabled={disabled}
        />
        <div className={styles.fieldFoot}>
          <div className={styles.fieldHints}>
            <span className={styles.hint}>Günlük dilde yaz. Ctrl+Enter ile analiz et.</span>
            <span className={styles.saveStatus} role="status" aria-atomic="true">
              {saveStatus === "saved" ? "Taslak kaydedildi" : saveStatus === "unavailable" ? "Bu tarayıcıda taslak kaydedilemiyor" : ""}
            </span>
          </div>
          <span className={styles.counter}>
            {draft.text.length}/{COMPOSER_TEXT_LIMIT}
          </span>
        </div>
      </div>

      {recovered ? <p className={styles.recovered} role="status">Yarım kalan taslağın geri yüklendi.</p> : null}

      <details className={styles.direction}>
        <summary>Sonucu şekillendir</summary>
        <p>Bir hedef, bir sınır veya istediğin çıktı biçimi ekle. Yazdıkların analiz edilen isteğin parçası olur.</p>
        <div className={styles.directionActions}>
          {["Başarmak istediğim sonuç: ", "Değişmemesi gereken: ", "İstediğim çıktı biçimi: "].map((hint) => (
            <button type="button" className="btn" key={hint} disabled={disabled || appendComposerHint(draft.text, hint, COMPOSER_TEXT_LIMIT) === draft.text} onClick={() => addHint(hint)}>{hint.trim().replace(/:$/, "")}</button>
          ))}
        </div>
      </details>

      <div className={styles.controls}>
        <div className={styles.control}>
          <span className="label" lang="en">
            Target AI
          </span>
          <Segmented label="Target AI" value={draft.target} options={TARGET_OPTIONS} onChange={(target) => updateDraft({ target })} disabled={disabled} />
        </div>
        <div className={styles.control}>
          <span className="label">Prompt dili</span>
          <Segmented label="Prompt dili" value={draft.language} options={LANGUAGE_OPTIONS} onChange={(language) => updateDraft({ language })} disabled={disabled} />
        </div>
        <button type="button" className={`btn btn-primary ${styles.submit}`} disabled={!canSubmit} onClick={() => void submit()}>
          {busy || submitting ? <span className="spinner" aria-hidden /> : null}
          {busy || submitting ? "Analiz ediliyor" : "İsteği analiz et"}
        </button>
      </div>

      {engine?.mode === "ai" ? (
        <p className={styles.noticeActive}>
          <strong>AI bağlantısı yapılandırıldı.</strong> İstek analizi: {engine.provider.toUpperCase()} (<code>{engine.model}</code>).
          {council?.enabled ? ` Prompt üretimi için ${council.models.length} farklı model, seçtiğin masada çalışacak.` : " Prompt, bu motorla hazırlanıp incelenecek."}
        </p>
      ) : engine?.mode === "local" ? (
        <p className={styles.notice}>
          <strong>Yerel motor etkin.</strong> {engine.reason === "forced" ? "Yerel motor seçildiği için AI bağlantısı kullanılmıyor." : "AI bağlantısı henüz yapılandırılmadı."} İsteklerin yerel motorla analiz edilecek.
        </p>
      ) : null}

      <section className={styles.examples} aria-label="Örnek istekler">
        <span className="label">Örnekler</span>
        <ul>
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button type="button" className={styles.example} onClick={() => updateDraft({ text: example })} disabled={disabled}>
                {example}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.flow}>
        İsteği anla → Planı netleştir → Promptu hazırla → Hedef AI&apos;da dene
      </footer>
    </div>
  );
}
