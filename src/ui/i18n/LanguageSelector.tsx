"use client";

import { UI_LOCALES, useI18n } from "./index";
import styles from "./LanguageSelector.module.css";

const LABELS = { tr: "Türkçe", en: "English", zh: "简体中文" } as const;
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return <div className={styles.root}>
    <span className={styles.label}>{t("Arayüz dili", "Interface language", "界面语言")}</span>
    <div className={styles.options} role="group" aria-label={t("Arayüz dili", "Interface language", "界面语言")}>
      {UI_LOCALES.map((value) => <button key={value} type="button" lang={value === "zh" ? "zh-CN" : value} aria-pressed={locale === value} onClick={() => setLocale(value)}>{LABELS[value]}</button>)}
    </div>
  </div>;
}
