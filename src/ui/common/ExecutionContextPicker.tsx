"use client";

import type { ExecutionContext } from "@/models/options";
import { Segmented } from "./Segmented";
import { EXECUTION_CONTEXT_DESCRIPTIONS, EXECUTION_CONTEXT_OPTIONS } from "./execution-context";
import styles from "./ExecutionContextPicker.module.css";

interface ExecutionContextPickerProps {
  value: ExecutionContext;
  disabled?: boolean;
  onChange: (value: ExecutionContext) => void;
}

export function ExecutionContextPicker({ value, disabled = false, onChange }: ExecutionContextPickerProps) {
  return (
    <div className={styles.root}>
      <span className="label">Prompt nerede kullanılacak?</span>
      <Segmented
        label="Promptun kullanım ortamı"
        value={value}
        options={EXECUTION_CONTEXT_OPTIONS}
        disabled={disabled}
        onChange={onChange}
      />
      <p className={styles.description}>{EXECUTION_CONTEXT_DESCRIPTIONS[value]}</p>
    </div>
  );
}
