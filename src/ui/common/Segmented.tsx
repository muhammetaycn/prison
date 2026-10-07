"use client";

import { cx } from "@/ui/lib/format";
import styles from "./Segmented.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "md" | "sm";
}

/** Radio-group style segmented control (Target AI, prompt language). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, size = "md" }: SegmentedProps<T>) {
  return (
    <div className={cx(styles.root, size === "sm" && styles.sm)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cx(styles.option, option.value === value && styles.active)}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
