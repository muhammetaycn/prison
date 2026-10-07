"use client";

import type { ExecutionContext } from "@/models/options";
import { useI18n } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import { Segmented } from "./Segmented";
import { EXECUTION_CONTEXT_DESCRIPTIONS, EXECUTION_CONTEXT_OPTIONS } from "./execution-context";
import styles from "./ExecutionContextPicker.module.css";

interface ExecutionContextPickerProps {
  value: ExecutionContext;
  disabled?: boolean;
  onChange: (value: ExecutionContext) => void;
}

const DESCRIPTIONS: Record<ExecutionContext, [string, string]> = {
  chat: ["The prompt is prepared for an AI that responds in a conversation.", "提示词面向在对话中回复的 AI。"],
  mobile: ["The prompt is prepared for an AI you use and read on your phone.", "提示词面向在手机上阅读和使用的 AI。"],
  browser: ["The prompt is prepared for an AI working in a browser. Your access and action boundaries are preserved.", "提示词面向在浏览器中工作的 AI，并保留你的访问和操作限制。"],
  agent: ["The prompt is prepared for an agent that can work with files and tools. Your request determines its permissions.", "提示词面向可操作文件和工具的智能体，其权限由你的请求决定。"],
};

export function ExecutionContextPicker({ value, disabled = false, onChange }: ExecutionContextPickerProps) {
  const { t } = useI18n();
  const label = useVocabulary();
  return (
    <div className={styles.root}>
      <span className="label">{t("Prompt nerede kullanılacak?", "Where will you use the prompt?", "你将在哪里使用提示词？")}</span>
      <Segmented
        label={t("Promptun kullanım ortamı", "Prompt environment", "提示词使用环境")}
        value={value}
        options={EXECUTION_CONTEXT_OPTIONS.map((option) => ({ ...option, label: label(option.label) }))}
        disabled={disabled}
        onChange={onChange}
      />
      <p className={styles.description}>{t(EXECUTION_CONTEXT_DESCRIPTIONS[value], ...DESCRIPTIONS[value])}</p>
    </div>
  );
}
