"use client";

import { useEffect, useRef, useState } from "react";
import type { ProviderSettingsInput, ProviderType, PublicProviderSettings } from "@/models/provider-settings";
import { useI18n } from "@/ui/i18n";
import styles from "./ProviderSettings.module.css";

type LocalizedMessage = readonly [string, string, string];
type DisplayMessage = string | LocalizedMessage;
const SAVE_FAILED: LocalizedMessage = ["Ekip ayarları kaydedilemedi.", "Team settings could not be saved.", "无法保存团队设置。"];
const SERVER_UNAVAILABLE: LocalizedMessage = ["Sunucu yanıtı alınamadı. Yazdıkların korundu; yeniden deneyebilirsin.", "The server did not respond. Your edits are preserved; you can try again.", "服务器未响应。你的修改已保留，可以重试。"];

const TYPES: Record<ProviderType, { label: string; url: string }> = {
  nvidia: { label: "NVIDIA", url: "https://integrate.api.nvidia.com/v1" },
  deepseek: { label: "DeepSeek", url: "https://api.deepseek.com" },
  openai: { label: "OpenAI", url: "https://api.openai.com/v1" },
  anthropic: { label: "Claude / Anthropic", url: "https://api.anthropic.com" },
  compatible: { label: "OpenAI uyumlu API", url: "https://api.openai.com/v1" },
};

export function settingsDraft(settings: PublicProviderSettings): ProviderSettingsInput {
  return {
    revision: settings.revision,
    providers: settings.providers.map(({ id, label, provider, baseURL }) => ({ id, label, provider, baseURL })),
    primary: settings.primary ? { providerId: settings.primary.providerId, model: settings.primary.model } : null,
    council: { enabled: settings.council.enabled, depth: settings.council.depth, members: settings.council.members.map(({ providerId, model, role }) => ({ providerId, model, ...(role ? { role } : {}) })) },
  };
}

class SettingsError extends Error { constructor(message: string, readonly status: number, readonly copy?: LocalizedMessage) { super(message); } }
async function settingsRequest(method: "GET" | "PUT" | "DELETE", body?: unknown, signal?: AbortSignal): Promise<PublicProviderSettings> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch("/api/settings/providers", {
      method, cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new SettingsError(result.error?.message ?? SAVE_FAILED[0], response.status, result.error?.message ? undefined : SAVE_FAILED);
    return result.settings;
  } catch (err) {
    if (err instanceof SettingsError) throw err;
    throw new SettingsError(SERVER_UNAVAILABLE[0], 0, SERVER_UNAVAILABLE);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function ProviderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<PublicProviderSettings | null>(null);
  const [draft, setDraft] = useState<ProviderSettingsInput | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<DisplayMessage>("");
  const [error, setError] = useState<DisplayMessage>("");
  const [stale, setStale] = useState(false);
  const dirty = draft && saved ? JSON.stringify(draft) !== JSON.stringify(settingsDraft(saved)) : false;
  const heading = useRef<HTMLHeadingElement>(null);
  const displayMessage = (value: DisplayMessage) => typeof value === "string" ? value : t(...value);
  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    void settingsRequest("GET", undefined, controller.signal).then((value) => { setSaved(value); setDraft(settingsDraft(value)); })
      .catch(() => { if (!controller.signal.aborted) setError(["Ekip ayarları yüklenemedi. Sayfayı yeniden açabilirsin.", "Team settings could not be loaded. You can reopen this page.", "无法加载团队设置。可以重新打开此页面。"]); });
    return () => controller.abort();
  }, []);

  const provider = (id: string, patch: Partial<ProviderSettingsInput["providers"][number]>) => {
    setMessage("");
    setDraft((value) => value ? { ...value, providers: value.providers.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) } : value);
  };
  const member = (index: number, patch: Partial<ProviderSettingsInput["council"]["members"][number]>) => {
    setMessage("");
    setDraft((value) => value ? { ...value, council: { ...value.council, members: value.council.members.map((entry, i) => i === index ? { ...entry, ...patch } : entry) } } : value);
  };
  const removeProvider = (id: string) => setDraft((value) => value ? {
    ...value, providers: value.providers.filter((entry) => entry.id !== id),
    primary: value.primary?.providerId === id ? null : value.primary,
    council: { ...value.council, members: value.council.members.filter((entry) => entry.providerId !== id) },
  } : value);

  const save = async (reset = false) => {
    if (!draft || working) return;
    setWorking(true); setError(""); setMessage(""); setStale(false);
    try {
      const value = await settingsRequest(reset ? "DELETE" : "PUT", reset ? { revision: draft.revision } : draft);
      setSaved(value); setDraft(settingsDraft(value));
      setMessage(reset ? ["Başlangıç ekibi geri yüklendi.", "The original team has been restored.", "已恢复初始团队。"] : ["Ekibin kaydedildi. Yeni üretimler bu ekiple başlayacak.", "Your team has been saved. New generations will use this team.", "团队已保存。新任务将使用此团队。"]);
      try { await onSaved(); }
      catch { setError(["Ekibin kaydedildi; bağlantı özeti yenilenemedi. Göreve dönüp yeniden açabilirsin.", "Your team was saved, but the connection summary could not be refreshed. Return to the task and reopen it.", "团队已保存，但连接概览未能刷新。可以返回任务后重新打开。"]); }
    } catch (err) { setStale(err instanceof SettingsError && err.status === 409); setError(err instanceof SettingsError && err.copy ? err.copy : err instanceof Error ? err.message : SAVE_FAILED); }
    finally { setWorking(false); }
  };
  const reload = async () => {
    setWorking(true);
    try { const value = await settingsRequest("GET"); setSaved(value); setDraft(settingsDraft(value)); setStale(false); setError(""); setMessage(["Güncel ekip yüklendi. Yeni düzenlemelerini bu sürümde yapabilirsin.", "The current team has been loaded. Continue editing this version.", "已加载最新团队。可以在此版本上继续修改。"]); }
    catch { setError(["Güncel ayarlar yüklenemedi. Taslağın korundu.", "The current settings could not be loaded. Your draft is preserved.", "无法加载最新设置。草稿已保留。"]); }
    finally { setWorking(false); }
  };

  return (
    <section className={styles.root} aria-label={t("AI ekibim", "My AI team", "我的 AI 团队")}>
      <header className={styles.header}>
        <div><span className="label">{t("Kontrol sende", "You are in control", "由你掌控")}</span><h1 ref={heading} tabIndex={-1}>{t("AI ekibini kur", "Build your AI team", "组建你的 AI 团队")}</h1><p>{t("Hızlı üretim için bir model seç; ayrıntılı karşılaştırma istediğinde masaya diğer modellerini ekle.", "Choose one model for quick generation; add other models to the table when you want a detailed comparison.", "选择一个模型快速生成；需要详细比较时，再向讨论桌添加其他模型。")}</p></div>
        <button type="button" className="btn" onClick={onClose} disabled={working}>{t("Göreve dön", "Return to task", "返回任务")}</button>
      </header>
      <p className={styles.note}>{t("Hedef AI promptu kullanacağın yerdir. Bu ekip ise promptu hazırlayan modellerdir. Ayarlar yeni üretimlerde kullanılır; devam eden çalışma kendi ekibiyle tamamlanır.", "The target AI is where you will use the prompt. This team prepares it. Settings apply to new generations; work already in progress finishes with its own team.", "目标 AI 是使用提示词的地方，而此团队负责准备提示词。设置用于新任务；正在进行的任务由原团队完成。")}</p>
      {error ? <p className={styles.error} role="alert">{displayMessage(error)}</p> : null}
      {saved?.councilConfigurationError ? <p className={styles.error} role="status">{t("Masa yapılandırması tamamlanamadı. Hızlı tek model kullanılabilir; aşağıdan geçerli üyeler seçebilir veya masayı kapatabilirsin.", "Table configuration could not be completed. Quick single-model mode is available; select valid members below or turn the table off.", "讨论桌配置未完成。仍可使用快速单模型模式；请在下方选择有效成员或关闭讨论桌。")}{" "}{saved.councilConfigurationError}</p> : null}
      {stale ? <div className={styles.actions}><p className={styles.note}>{t("Yazdıkların bu formda duruyor. Güncel ayarları yüklemek formu kayıtlı sürümle yeniler.", "Your edits are still in this form. Loading current settings replaces the form with the saved version.", "你的修改仍保留在此表单中。加载最新设置会用已保存的版本替换表单。")}</p><button type="button" className="btn" disabled={working} onClick={() => void reload()}>{t("Güncel ayarları yükle", "Load current settings", "加载最新设置")}</button></div> : null}
      {message && !dirty ? <p className={styles.message} role="status">{displayMessage(message)}</p> : null}
      {!draft ? <p>{error ? "" : t("Ekip yükleniyor…", "Loading your team…", "正在加载团队…")}</p> : (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={working} className={styles.fields}>
            <legend>{t("Bağlantılar", "Connections", "连接")}</legend>
            <p className={styles.note}>{t("API anahtarları sunucuda yerel dosyaya kaydedilir; tarayıcıya geri gönderilmez. Boş bıraktığın alan mevcut anahtarı korur. Adres değiştirirken yeni anahtar gir.", "API keys are saved in a local file on the server and are never sent back to the browser. Leave the field empty to keep the existing key. Enter a new key when changing the address.", "API 密钥保存在服务器本地文件中，不会返回浏览器。留空会保留现有密钥。更改地址时请输入新密钥。")}</p>
            {draft.providers.map((entry) => {
              const existing = saved?.providers.find((item) => item.id === entry.id);
              return (
                <div className={styles.connection} key={entry.id}>
                  <div className={styles.row}>
                    <label>{t("Bağlantı adı", "Connection name", "连接名称")}<input value={entry.label} maxLength={80} required onChange={(event) => provider(entry.id, { label: event.target.value })} /></label>
                    <label>{t("API türü", "API type", "API 类型")}<select value={entry.provider} onChange={(event) => {
                      const type = event.target.value as ProviderType;
                      provider(entry.id, { provider: type, baseURL: TYPES[type].url, apiKey: null });
                    }}>{Object.entries(TYPES).map(([id, type]) => <option value={id} key={id}>{id === "compatible" ? t("OpenAI uyumlu API", "OpenAI-compatible API", "兼容 OpenAI 的 API") : type.label}</option>)}</select></label>
                  </div>
                  <label>{t("API adresi", "API address", "API 地址")}<input type="url" value={entry.baseURL} maxLength={500} required placeholder="https://…/v1" spellCheck={false} onChange={(event) => provider(entry.id, { baseURL: event.target.value })} /></label>
                  <div className={styles.row}>
                    <label>{t("API anahtarı", "API key", "API 密钥")}<input type="password" autoComplete="new-password" value={entry.apiKey ?? ""} placeholder={existing?.keyPresent && entry.apiKey !== null ? t("Anahtar kayıtlı · değiştirmek için yaz", "Key saved · enter a replacement", "密钥已保存 · 输入以替换") : t("Yeni anahtar", "New key", "新密钥")} onChange={(event) => provider(entry.id, { apiKey: event.target.value.trim() || undefined })} /></label>
                    <div className={styles.actions}>
                      <button type="button" className="btn" onClick={() => provider(entry.id, { apiKey: null })}>{t("Anahtarı kaldır", "Remove key", "移除密钥")}</button>
                      <button type="button" className="btn" onClick={() => removeProvider(entry.id)}>{t("Bağlantıyı çıkar", "Remove connection", "移除连接")}</button>
                    </div>
                  </div>
                  {entry.apiKey === null ? <small>{t("Anahtar kayıttan kaldırılacak. Bu bağlantıyı kullanmak için yeni anahtar gerekir.", "The saved key will be removed. A new key is required to use this connection.", "保存的密钥将被移除。使用此连接需要新密钥。")}</small> : null}
                </div>
              );
            })}
            <button type="button" className="btn" disabled={draft.providers.length >= 12} onClick={() => setDraft({ ...draft, providers: [...draft.providers, { id: `api_${Date.now().toString(36)}`, label: t("Yeni bağlantım", "My new connection", "我的新连接"), provider: "compatible", baseURL: "https://api.openai.com/v1" }] })}>{t("+ API bağlantısı ekle", "+ Add API connection", "+ 添加 API 连接")}</button>
          </fieldset>
          <fieldset disabled={working} className={styles.fields}>
            <legend>{t("İsteği analiz eden ve hızlı promptu üreten model", "Model for analysis and quick prompts", "分析需求并快速生成提示词的模型")}</legend>
            <div className={styles.row}>
              <label>{t("Bağlantı", "Connection", "连接")}<select aria-label={t("Analiz bağlantısı", "Analysis connection", "分析连接")} value={draft.primary?.providerId ?? ""} onChange={(event) => setDraft({ ...draft, primary: event.target.value ? { providerId: event.target.value, model: draft.primary?.model ?? "" } : null })}>
                <option value="">{t("Yerel analiz motoru", "Local analysis engine", "本地分析引擎")}</option>{draft.providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
              {draft.primary ? <label>{t("Model kimliği", "Model ID", "模型 ID")}<input value={draft.primary.model} required maxLength={160} placeholder={t("Sağlayıcının tam model kimliği", "Provider's exact model ID", "提供商的完整模型 ID")} onChange={(event) => setDraft({ ...draft, primary: { ...draft.primary!, model: event.target.value } })} /></label> : null}
            </div>
          </fieldset>
          <fieldset disabled={working} className={styles.fields}>
            <legend>{t("İsteğe bağlı masa ve kapışma ekibi", "Optional table and arena team", "可选的讨论与竞技团队")}</legend>
            <label className={styles.toggle}><input type="checkbox" checked={draft.council.enabled} onChange={(event) => setDraft({ ...draft, council: { ...draft.council, enabled: event.target.checked } })} /> {t("Masa ve kapışma için model ekibini etkinleştir", "Enable the model team for table and arena", "启用讨论与竞技的模型团队")}</label>
            <p className={styles.note}>{t("Açıkken 3–6 farklı model seç. Hızlı mod bu masayı kullanmaz; çalışma biçimini her görevde seçersin. Aynı modelin birden çok koltuğu bağımsız görüş sayılmaz. Anahtar ve model erişimi, gerçek çağrıda sağlayıcı tarafından doğrulanır.", "When enabled, choose 3–6 different models. Quick mode skips the table; choose a working mode for each task. Multiple seats for the same model do not count as independent viewpoints. The provider verifies key and model access on an actual call.", "启用时请选择 3–6 个不同模型。快速模式不使用讨论桌；每个任务都可以选择工作方式。同一模型的多个席位不代表独立观点。实际调用时，提供商会验证密钥和模型访问权限。")}</p>
            <label>{t("Çalışma derinliği", "Review depth", "评审深度")}<select value={draft.council.depth} onChange={(event) => setDraft({ ...draft, council: { ...draft.council, depth: event.target.value as "quick" | "deep" } })}><option value="quick">{t("Kısa karşılaştırma", "Brief comparison", "简要比较")}</option><option value="deep">{t("Derin inceleme · daha uzun sürebilir", "Deep review · may take longer", "深入评审 · 可能需要更长时间")}</option></select></label>
            {draft.council.members.map((entry, index) => (
              <div className={styles.connection} key={index}>
                <span className="label">{t(`Üye ${index + 1}`, `Member ${index + 1}`, `成员 ${index + 1}`)}</span>
                <div className={styles.row}>
                  <label>{t("Bağlantı", "Connection", "连接")}<select value={entry.providerId} required aria-label={t(`Üye ${index + 1} bağlantısı`, `Member ${index + 1} connection`, `成员 ${index + 1} 的连接`)} onChange={(event) => member(index, { providerId: event.target.value })}><option value="">{t("Seç", "Choose", "选择")}</option>{draft.providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
                  <label>{t("Model kimliği", "Model ID", "模型 ID")}<input value={entry.model} required maxLength={160} onChange={(event) => member(index, { model: event.target.value })} /></label>
                </div>
                <label>{t("Uzmanlık / bakış açısı", "Specialty / perspective", "专长 / 视角")}<input value={entry.role ?? ""} maxLength={160} placeholder={t("Örn. çıktı biçimi ve okunabilirlik", "E.g. output format and readability", "例如：输出格式与可读性")} onChange={(event) => member(index, { role: event.target.value || undefined })} /></label>
                <button type="button" className="btn" onClick={() => setDraft({ ...draft, council: { ...draft.council, members: draft.council.members.filter((_, i) => i !== index) } })}>{t("Üyeyi çıkar", "Remove member", "移除成员")}</button>
              </div>
            ))}
            <button type="button" className="btn" disabled={draft.council.members.length >= 6 || !draft.providers.length} onClick={() => setDraft({ ...draft, council: { ...draft.council, members: [...draft.council.members, { providerId: draft.providers[0].id, model: "" }] } })}>{t("+ Masaya model ekle", "+ Add model to table", "+ 向讨论桌添加模型")}</button>
          </fieldset>
          <div className={styles.footer}>
            <button type="submit" className="btn btn-primary" disabled={working}>{working ? t("Kaydediliyor…", "Saving…", "正在保存…") : t("Ekibimi kaydet", "Save my team", "保存我的团队")}</button>
            <button type="button" className="btn" disabled={working || saved?.source !== "saved"} onClick={() => void save(true)}>{t("Başlangıç ekibine dön", "Restore original team", "恢复初始团队")}</button>
            <small>{t("Değişiklikler kaydettiğinde uygulanır.", "Changes apply when you save.", "保存后应用修改。")}</small>
          </div>
        </form>
      )}
    </section>
  );
}
