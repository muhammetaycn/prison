"use client";

import { useEffect, useRef, useState } from "react";
import type { ProviderSettingsInput, ProviderType, PublicProviderSettings } from "@/models/provider-settings";
import styles from "./ProviderSettings.module.css";

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

class SettingsError extends Error { constructor(message: string, readonly status: number) { super(message); } }
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
    if (!response.ok) throw new SettingsError(result.error?.message ?? "Ekip ayarları kaydedilemedi.", response.status);
    return result.settings;
  } catch (err) {
    if (err instanceof SettingsError) throw err;
    throw new Error("Sunucu yanıtı alınamadı. Yazdıkların korundu; yeniden deneyebilirsin.");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function ProviderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [saved, setSaved] = useState<PublicProviderSettings | null>(null);
  const [draft, setDraft] = useState<ProviderSettingsInput | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const dirty = draft && saved ? JSON.stringify(draft) !== JSON.stringify(settingsDraft(saved)) : false;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    void settingsRequest("GET", undefined, controller.signal).then((value) => { setSaved(value); setDraft(settingsDraft(value)); })
      .catch(() => { if (!controller.signal.aborted) setError("Ekip ayarları yüklenemedi. Sayfayı yeniden açabilirsin."); });
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
      setMessage(reset ? "Başlangıç ekibi geri yüklendi." : "Ekibin kaydedildi. Yeni üretimler bu ekiple başlayacak.");
      try { await onSaved(); }
      catch { setError("Ekibin kaydedildi; bağlantı özeti yenilenemedi. Göreve dönüp yeniden açabilirsin."); }
    } catch (err) { setStale(err instanceof SettingsError && err.status === 409); setError(err instanceof Error ? err.message : "Ekip ayarları kaydedilemedi."); }
    finally { setWorking(false); }
  };
  const reload = async () => {
    setWorking(true);
    try { const value = await settingsRequest("GET"); setSaved(value); setDraft(settingsDraft(value)); setStale(false); setError(""); setMessage("Güncel ekip yüklendi. Yeni düzenlemelerini bu sürümde yapabilirsin."); }
    catch { setError("Güncel ayarlar yüklenemedi. Taslağın korundu."); }
    finally { setWorking(false); }
  };

  return (
    <section className={styles.root} aria-label="AI ekibim">
      <header className={styles.header}>
        <div><span className="label">Kontrol sende</span><h1 ref={heading} tabIndex={-1}>AI ekibini kur</h1><p>Bağlantılarını ekle, masada çalışacak modelleri ve uzmanlıklarını seç.</p></div>
        <button type="button" className="btn" onClick={onClose} disabled={working}>Göreve dön</button>
      </header>
      <p className={styles.note}>Hedef AI promptu kullanacağın yerdir. Bu ekip ise promptu hazırlayan modellerdir. Ayarlar yeni üretimlerde kullanılır; devam eden çalışma kendi ekibiyle tamamlanır.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {stale ? <div className={styles.actions}><p className={styles.note}>Yazdıkların bu formda duruyor. Güncel ayarları yüklemek formu kayıtlı sürümle yeniler.</p><button type="button" className="btn" disabled={working} onClick={() => void reload()}>Güncel ayarları yükle</button></div> : null}
      {message && !dirty ? <p className={styles.message} role="status">{message}</p> : null}
      {!draft ? <p>{error ? "" : "Ekip yükleniyor…"}</p> : (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={working} className={styles.fields}>
            <legend>Bağlantılar</legend>
            <p className={styles.note}>API anahtarları sunucuda yerel dosyaya kaydedilir; tarayıcıya geri gönderilmez. Boş bıraktığın alan mevcut anahtarı korur. Adres değiştirirken yeni anahtar gir.</p>
            {draft.providers.map((entry) => {
              const existing = saved?.providers.find((item) => item.id === entry.id);
              return (
                <div className={styles.connection} key={entry.id}>
                  <div className={styles.row}>
                    <label>Bağlantı adı<input value={entry.label} maxLength={80} required onChange={(event) => provider(entry.id, { label: event.target.value })} /></label>
                    <label>API türü<select value={entry.provider} onChange={(event) => {
                      const type = event.target.value as ProviderType;
                      provider(entry.id, { provider: type, baseURL: TYPES[type].url, apiKey: null });
                    }}>{Object.entries(TYPES).map(([id, type]) => <option value={id} key={id}>{type.label}</option>)}</select></label>
                  </div>
                  <label>API adresi<input type="url" value={entry.baseURL} maxLength={500} required placeholder="https://…/v1" spellCheck={false} onChange={(event) => provider(entry.id, { baseURL: event.target.value })} /></label>
                  <div className={styles.row}>
                    <label>API anahtarı<input type="password" autoComplete="new-password" value={entry.apiKey ?? ""} placeholder={existing?.keyPresent && entry.apiKey !== null ? "Anahtar kayıtlı · değiştirmek için yaz" : "Yeni anahtar"} onChange={(event) => provider(entry.id, { apiKey: event.target.value.trim() || undefined })} /></label>
                    <div className={styles.actions}>
                      <button type="button" className="btn" onClick={() => provider(entry.id, { apiKey: null })}>Anahtarı kaldır</button>
                      <button type="button" className="btn" onClick={() => removeProvider(entry.id)}>Bağlantıyı çıkar</button>
                    </div>
                  </div>
                  {entry.apiKey === null ? <small>Anahtar kayıttan kaldırılacak. Bu bağlantıyı kullanmak için yeni anahtar gerekir.</small> : null}
                </div>
              );
            })}
            <button type="button" className="btn" disabled={draft.providers.length >= 12} onClick={() => setDraft({ ...draft, providers: [...draft.providers, { id: `api_${Date.now().toString(36)}`, label: "Yeni bağlantım", provider: "compatible", baseURL: "https://api.openai.com/v1" }] })}>+ API bağlantısı ekle</button>
          </fieldset>
          <fieldset disabled={working} className={styles.fields}>
            <legend>İsteği analiz eden model</legend>
            <div className={styles.row}>
              <label>Bağlantı<select aria-label="Analiz bağlantısı" value={draft.primary?.providerId ?? ""} onChange={(event) => setDraft({ ...draft, primary: event.target.value ? { providerId: event.target.value, model: draft.primary?.model ?? "" } : null })}>
                <option value="">Yerel analiz motoru</option>{draft.providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select></label>
              {draft.primary ? <label>Model kimliği<input value={draft.primary.model} required maxLength={160} placeholder="Sağlayıcının tam model kimliği" onChange={(event) => setDraft({ ...draft, primary: { ...draft.primary!, model: event.target.value } })} /></label> : null}
            </div>
          </fieldset>
          <fieldset disabled={working} className={styles.fields}>
            <legend>Promptu hazırlayan masa</legend>
            <label className={styles.toggle}><input type="checkbox" checked={draft.council.enabled} onChange={(event) => setDraft({ ...draft, council: { ...draft.council, enabled: event.target.checked } })} /> Modeller birlikte üretsin ve birbirini değerlendirsin</label>
            <p className={styles.note}>Açıkken 3–6 farklı model seç. Aynı modelin birden çok koltuğu bağımsız görüş sayılmaz. Anahtar ve model erişimi, gerçek çağrıda sağlayıcı tarafından doğrulanır.</p>
            <label>Çalışma derinliği<select value={draft.council.depth} onChange={(event) => setDraft({ ...draft, council: { ...draft.council, depth: event.target.value as "quick" | "deep" } })}><option value="quick">Kısa karşılaştırma</option><option value="deep">Derin inceleme · daha uzun sürebilir</option></select></label>
            {draft.council.members.map((entry, index) => (
              <div className={styles.connection} key={index}>
                <span className="label">Üye {index + 1}</span>
                <div className={styles.row}>
                  <label>Bağlantı<select value={entry.providerId} required aria-label={`Üye ${index + 1} bağlantısı`} onChange={(event) => member(index, { providerId: event.target.value })}><option value="">Seç</option>{draft.providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
                  <label>Model kimliği<input value={entry.model} required maxLength={160} onChange={(event) => member(index, { model: event.target.value })} /></label>
                </div>
                <label>Uzmanlık / bakış açısı<input value={entry.role ?? ""} maxLength={160} placeholder="Örn. çıktı biçimi ve okunabilirlik" onChange={(event) => member(index, { role: event.target.value || undefined })} /></label>
                <button type="button" className="btn" onClick={() => setDraft({ ...draft, council: { ...draft.council, members: draft.council.members.filter((_, i) => i !== index) } })}>Üyeyi çıkar</button>
              </div>
            ))}
            <button type="button" className="btn" disabled={draft.council.members.length >= 6 || !draft.providers.length} onClick={() => setDraft({ ...draft, council: { ...draft.council, members: [...draft.council.members, { providerId: draft.providers[0].id, model: "" }] } })}>+ Masaya model ekle</button>
          </fieldset>
          <div className={styles.footer}>
            <button type="submit" className="btn btn-primary" disabled={working}>{working ? "Kaydediliyor…" : "Ekibimi kaydet"}</button>
            <button type="button" className="btn" disabled={working || saved?.source !== "saved"} onClick={() => void save(true)}>Başlangıç ekibine dön</button>
            <small>Değişiklikler kaydettiğinde uygulanır.</small>
          </div>
        </form>
      )}
    </section>
  );
}
