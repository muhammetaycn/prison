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
import { useI18n } from "@/ui/i18n";
import styles from "./Composer.module.css";

const EXAMPLES = [
  ["Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.", "Create a Codex prompt to add payments without breaking my existing project.", "生成一段 Codex 提示词，在不破坏现有项目的前提下添加支付系统。"],
  ["Mevcut sitemi bozmadan ana akışı daha görünür yapacak ve Google'dan gelen kullanıcıların ilgili tartışmaları direkt bulmasını sağlayacak Codex promptu üret.", "Create a Codex prompt to make my site's main feed clearer and help visitors from Google find relevant discussions directly, without breaking the site.", "生成一段 Codex 提示词，让网站主要动态更清晰，帮助来自 Google 的用户直接找到相关讨论，同时保持现有网站正常工作。"],
  ["Windows bilgisayarımın güvenlik ayarlarını analiz edip sadece öneri sunacak bir prompt yaz.", "Write a prompt to analyze my Windows security settings and give recommendations only.", "编写一段提示词，分析我的 Windows 安全设置，只提供建议。"],
  ["Instagram hesabım için 30 günlük içerik sistemi kuracak bir prompt hazırla.", "Prepare a prompt for a 30-day content plan for my Instagram account.", "为我的 Instagram 账户编写一段提示词，建立 30 天内容计划。"],
] as const;

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<PromptMode>> = [
  { value: "auto", label: "İsteğe göre" },
  { value: "standard", label: "Standart" },
  { value: "jb", label: "JB modu" },
];

const MODE_DESCRIPTIONS: Record<PromptMode, readonly [string, string, string]> = {
  auto: ["Yazdığın isteğe göre standart veya JB modu seçilir.", "Standard or JB mode is selected based on your request.", "根据你的需求选择标准模式或 JB 模式。"],
  standard: ["Standart görev promptu hazırlanır.", "A standard task prompt is prepared.", "生成标准任务提示词。"],
  jb: ["JB çerçevesiyle, hedef AI'a göre uyarlanmış prompt hazırlanır.", "A prompt using the JB framework is adapted to the target AI.", "使用 JB 框架，生成适配目标 AI 的提示词。"],
};

interface ComposerProps {
  engine: EngineStatus | null;
  council?: CouncilMetadata | null;
  busy: boolean;
  onSubmit: (input: ComposerInput) => Promise<boolean>;
}

export function Composer({ engine, council, busy, onSubmit }: ComposerProps) {
  const { t } = useI18n();
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
        <p className={styles.subtitle}>{t("İsteğini anlat. Uygulanabilir bir AI promptuna dönüştürelim.", "Describe your idea. Let's turn it into an actionable AI prompt.", "说出你的想法，让我们把它变成可执行的 AI 提示词。")}</p>
      </header>

      <PromptJourney stage="input" />

      <div className={styles.modePicker}>
        <span className="label">{t("Prompt modu", "Prompt mode", "提示词模式")}</span>
        <Segmented label={t("Prompt modu", "Prompt mode", "提示词模式")} value={draft.mode} options={MODE_OPTIONS.map((option) => ({ ...option, label: option.value === "auto" ? t("İsteğe göre", "Based on request", "根据需求") : option.value === "standard" ? t("Standart", "Standard", "标准") : t("JB modu", "JB mode", "JB 模式") }))} onChange={(mode) => updateDraft({ mode })} disabled={disabled} />
        <p className={styles.modeDescription}>{t(MODE_DESCRIPTIONS[draft.mode][0], MODE_DESCRIPTIONS[draft.mode][1], MODE_DESCRIPTIONS[draft.mode][2])}</p>
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
          placeholder={t("Ne yaptırmak istiyorsun?", "What would you like to create or accomplish?", "你想创作或完成什么？")}
          aria-label={t("Ne yaptırmak istiyorsun?", "What would you like to create or accomplish?", "你想创作或完成什么？")}
          disabled={disabled}
        />
        <div className={styles.fieldFoot}>
          <div className={styles.fieldHints}>
            <span className={styles.hint}>{t("Günlük dilde yaz. Ctrl+Enter ile analiz et.", "Use everyday language. Press Ctrl+Enter to analyze.", "用日常语言描述，按 Ctrl+Enter 开始分析。")}</span>
            <span className={styles.saveStatus} role="status" aria-atomic="true">
              {saveStatus === "saved" ? t("Taslak kaydedildi", "Draft saved", "草稿已保存") : saveStatus === "unavailable" ? t("Bu tarayıcıda taslak kaydedilemiyor", "Drafts cannot be saved in this browser", "此浏览器无法保存草稿") : ""}
            </span>
          </div>
          <span className={styles.counter}>
            {draft.text.length}/{COMPOSER_TEXT_LIMIT}
          </span>
        </div>
      </div>

      {recovered ? <p className={styles.recovered} role="status">{t("Yarım kalan taslağın geri yüklendi.", "Your unfinished draft has been restored.", "已恢复未完成的草稿。")}</p> : null}

      <details className={styles.direction}>
        <summary>{t("Sonucu şekillendir", "Shape the result", "塑造结果")}</summary>
        <p>{t("Bir hedef, bir sınır veya istediğin çıktı biçimi ekle. Yazdıkların analiz edilen isteğin parçası olur.", "Add a goal, a boundary or your preferred output format. What you write becomes part of the request being analyzed.", "添加目标、限制或所需输出格式。你填写的内容会成为待分析需求的一部分。")}</p>
        <div className={styles.directionActions}>
          {[t("Başarmak istediğim sonuç: ", "The outcome I want: ", "我想实现的结果: "), t("Değişmemesi gereken: ", "What must stay unchanged: ", "必须保持不变的内容: "), t("İstediğim çıktı biçimi: ", "My preferred output format: ", "我想要的输出格式: ")].map((hint) => (
            <button type="button" className="btn" key={hint} disabled={disabled || appendComposerHint(draft.text, hint, COMPOSER_TEXT_LIMIT) === draft.text} onClick={() => addHint(hint)}>{hint.trim().replace(/:$/, "")}</button>
          ))}
        </div>
      </details>

      <div className={styles.controls}>
        <div className={styles.control}>
          <span className="label">
            {t("Hedef AI", "Target AI", "目标 AI")}
          </span>
          <Segmented label={t("Hedef AI", "Target AI", "目标 AI")} value={draft.target} options={TARGET_OPTIONS} onChange={(target) => updateDraft({ target })} disabled={disabled} />
        </div>
        <div className={styles.control}>
          <span className="label">{t("Prompt dili", "Prompt language", "提示词语言")}</span>
          <Segmented label={t("Prompt dili", "Prompt language", "提示词语言")} value={draft.language} options={LANGUAGE_OPTIONS} onChange={(language) => updateDraft({ language })} disabled={disabled} />
        </div>
        <button type="button" className={`btn btn-primary ${styles.submit}`} disabled={!canSubmit} onClick={() => void submit()}>
          {busy || submitting ? <span className="spinner" aria-hidden /> : null}
          {busy || submitting ? t("Analiz ediliyor", "Analyzing", "正在分析") : t("İsteği analiz et", "Analyze request", "分析需求")}
        </button>
      </div>

      {engine?.mode === "ai" ? (
        <p className={styles.noticeActive}>
          <strong>{t("AI bağlantısı yapılandırıldı.", "AI connection configured.", "AI 连接已配置。")}</strong> {t("İstek analizi:", "Request analysis:", "需求分析：")} {engine.provider.toUpperCase()} (<code>{engine.model}</code>).
          {council?.enabled ? t(` Masa seçimi için ${council.models.length} farklı model yapılandırıldı. Hızlı modda tek model kullanılır.`, ` ${council.models.length} different models are configured for table mode. Quick mode uses one model.`, ` 讨论模式已配置 ${council.models.length} 个不同模型。快速模式使用一个模型。`) : t(" Prompt, bu motorla hazırlanıp incelenecek.", " This engine will prepare and review the prompt.", " 此引擎将生成并评审提示词。")}
        </p>
      ) : engine?.mode === "local" ? (
        <p className={styles.notice}>
          <strong>{t("Yerel motor etkin.", "Local engine active.", "本地引擎已启用。")}</strong> {engine.reason === "forced" ? t("Yerel motor seçildiği için AI bağlantısı kullanılmıyor.", "The local engine is selected, so no AI connection is used.", "已选择本地引擎，因此不使用 AI 连接。") : t("AI bağlantısı henüz yapılandırılmadı.", "An AI connection has not been configured yet.", "尚未配置 AI 连接。")} {t("İsteklerin yerel motorla analiz edilecek.", "Your requests will be analyzed by the local engine.", "你的需求将由本地引擎分析。")}
        </p>
      ) : null}

      <section className={styles.examples} aria-label={t("Örnek istekler", "Example requests", "需求示例")}>
        <span className="label">{t("Örnekler", "Examples", "示例")}</span>
        <ul>
          {EXAMPLES.map((copy) => {
            const example = t(copy[0], copy[1], copy[2]);
            return (
              <li key={example}>
                <button type="button" className={styles.example} onClick={() => updateDraft({ text: example })} disabled={disabled}>
                  {example}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className={styles.flow}>
        {t("İsteği anla → Planı netleştir → Promptu hazırla → Hedef AI'da dene", "Understand the request → Refine the plan → Prepare the prompt → Try it with the target AI", "理解需求 → 明确计划 → 生成提示词 → 在目标 AI 中试用")}
      </footer>
    </div>
  );
}
