"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const UI_LOCALES = ["tr", "en", "zh"] as const;
export type UILocale = typeof UI_LOCALES[number];
export type Translate = (tr: string, en: string, zh: string) => string;
const STORAGE_KEY = "prison.ui-language";
const htmlLanguage = { tr: "tr", en: "en", zh: "zh-CN" } as const;

export function isUILocale(value: unknown): value is UILocale {
  return value === "tr" || value === "en" || value === "zh";
}

export function translate(locale: UILocale, tr: string, en: string, zh: string): string {
  return locale === "en" ? en : locale === "zh" ? zh : tr;
}

interface I18nState { locale: UILocale; setLocale: (locale: UILocale) => void; t: Translate }
const fallback: I18nState = { locale: "tr", setLocale: () => {}, t: (tr) => tr };
const I18nContext = createContext<I18nState>(fallback);

export function I18nProvider({ children, initialLocale = "tr" }: { children?: ReactNode; initialLocale?: UILocale }) {
  const [locale, updateLocale] = useState<UILocale>(initialLocale);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isUILocale(saved)) updateLocale(saved);
    } catch { /* The interface remains usable when browser storage is unavailable. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = htmlLanguage[locale]; }, [locale]);
  const setLocale = useCallback((next: UILocale) => {
    if (!isUILocale(next)) return;
    updateLocale(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Session-only choice. */ }
  }, []);
  const t = useCallback<Translate>((tr, en, zh) => translate(locale, tr, en, zh), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
