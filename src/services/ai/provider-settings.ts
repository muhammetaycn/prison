import { createHash, randomUUID } from "node:crypto";
import type { PublicProviderSettings, ProviderSettingsInput, ProviderType } from "@/models/provider-settings";
import { ProviderSettingsInputSchema } from "@/models/provider-settings";
import { AppError } from "@/services/errors";
import type { FileProviderSettingsRepository, StoredProviderSettings } from "@/services/storage/provider-settings-repository";
import { createCredentialedProvider, createProvider, providerKey, resolveEngineStatus, type EngineStatus } from "./config";
import { createCouncil, describeCouncil, DEFAULT_COUNCIL_MODELS, DEEP_DEPTH, QUICK_DEPTH, type CouncilDeps } from "./council-config";
import { DEFAULT_NVIDIA_BASE_URL, DEFAULT_DEEPSEEK_BASE_URL } from "./deepseek";
import { AIProviderError } from "./errors";
import type { LLMProvider } from "./types";

type Env = Record<string, string | undefined>;
const TYPES: ProviderType[] = ["nvidia", "deepseek", "openai", "anthropic"];
export const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  nvidia: DEFAULT_NVIDIA_BASE_URL, deepseek: DEFAULT_DEEPSEEK_BASE_URL,
  openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com", compatible: "https://api.openai.com/v1",
};
const ROLES = ["Amaç ve kullanıcı sınırları uzmanı", "Uygulama planı uzmanı", "Prompt yapısı uzmanı", "Alternatif yaklaşım uzmanı", "Çıktı kalitesi uzmanı", "Bağımsız eleştirmen"];
function invalid(message: string): never { throw new AppError("invalid_input", message); }

/** Public HTTPS endpoints only; URL credentials, local addresses, queries and fragments are rejected. */
export function normalizeProviderURL(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return invalid("API adresi geçerli bir HTTPS adresi olmalı."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== "443") || !host.includes(".")
    || /^[\d.]+$/.test(host) || host.includes(":") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)
    || /[\s\\]/.test(raw) || /%(?:2f|5c|00|0a|0d)/i.test(url.pathname)) {
    return invalid("API adresi herkese açık bir HTTPS alan adı olmalı; yerel adres veya adres içinde kimlik bilgisi kullanılamaz.");
  }
  url.hostname = host;
  return url.toString().replace(/\/+$/, "");
}

function envBaseURL(type: ProviderType, env: Env): string {
  const value = env[`${type.toUpperCase()}_BASE_URL`]?.trim();
  if (value) return value.replace(/\/+$/, "");
  if (type === "nvidia" && (env.PRISON_MODEL?.startsWith("nvidia/") || env.DEEPSEEK_BASE_URL?.includes("integrate.api.nvidia.com"))) {
    return env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, "") || PROVIDER_BASE_URLS.nvidia;
  }
  return PROVIDER_BASE_URLS[type];
}

/** Optional team configuration must not prevent a valid primary from serving single-model work. */
function environmentCouncil(engine: EngineStatus, env: Env): { council: CouncilDeps | null; councilConfigurationError: string | null } {
  try {
    return { council: createCouncil(engine, env), councilConfigurationError: null };
  } catch (error) {
    if (!(error instanceof AIProviderError) || error.kind !== "configuration") throw error;
    // createCouncil's configuration details are fixed diagnostics; credentials and raw inputs stay private.
    return { council: null, councilConfigurationError: error.detail };
  }
}

export function environmentProviderSettings(env: Env = process.env): PublicProviderSettings {
  const engine = resolveEngineStatus(env);
  const { council, councilConfigurationError } = environmentCouncil(engine, env);
  return {
    revision: "environment", source: "environment",
    providers: TYPES.map(provider => ({ id: `env_${provider}`, label: provider === "nvidia" ? "NVIDIA" : provider === "deepseek" ? "DeepSeek" : provider === "openai" ? "OpenAI" : "Anthropic",
      provider, baseURL: envBaseURL(provider, env), keyPresent: Boolean(providerKey(provider, env)), keySource: providerKey(provider, env) ? "environment" : "none" })),
    primary: engine.mode === "ai" ? { providerId: `env_${engine.provider}`, model: engine.model } : null,
    council: { enabled: Boolean(council), depth: env.PRISON_COUNCIL_DEPTH?.trim().toLowerCase() === "quick" ? "quick" : "deep",
      members: council ? describeCouncil(council).models.map(member => ({ providerId: "env_nvidia", model: member.model!, role: member.role }))
        : DEFAULT_COUNCIL_MODELS.map((model, index) => ({ providerId: "env_nvidia", model, role: ROLES[index] })) },
    ...(councilConfigurationError ? { councilConfigurationError } : {}),
  };
}

function keyFor(profile: StoredProviderSettings["providers"][number], env: Env): string | undefined {
  return profile.key ?? (profile.useEnvironmentKey ? providerKey(profile.provider, env) : undefined);
}

export function publicProviderSettings(saved: StoredProviderSettings | null, env: Env = process.env): PublicProviderSettings {
  if (!saved) return environmentProviderSettings(env);
  return { revision: saved.revision, source: "saved", primary: saved.primary, council: saved.council,
    providers: saved.providers.map(({ key, useEnvironmentKey, ...profile }) => ({ ...profile,
      keyPresent: Boolean(keyFor({ ...profile, key, useEnvironmentKey }, env)),
      keySource: key ? "saved" : useEnvironmentKey && providerKey(profile.provider, env) ? "environment" : "none" })),
  };
}

function validateReferences(settings: StoredProviderSettings, env: Env): void {
  const profiles = new Map(settings.providers.map(profile => [profile.id, profile]));
  if (profiles.size !== settings.providers.length) invalid("Her API bağlantısının kimliği farklı olmalı.");
  for (const profile of profiles.values()) {
    normalizeProviderURL(profile.baseURL);
    if (profile.useEnvironmentKey && profile.baseURL !== envBaseURL(profile.provider, env)) invalid("Ortam anahtarı farklı bir API adresine gönderilemez.");
  }
  const selections = [settings.primary, ...settings.council.members].filter(Boolean) as NonNullable<StoredProviderSettings["primary"]>[];
  for (const choice of selections) {
    const profile = profiles.get(choice.providerId);
    if (!profile) invalid("Seçilen modelin API bağlantısı listede bulunmalı.");
    if (profile.provider === "nvidia" && !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(choice.model)) invalid("NVIDIA modeli yayıncı/model biçiminde olmalı.");
  }
  if (settings.council.enabled && (!settings.primary || settings.council.members.length < 3)) invalid("Ortak üretim için ana model ve en az üç farklı model seçilmeli.");
  const identities = settings.council.members.map(member => {
    const profile = profiles.get(member.providerId)!;
    return `${profile.baseURL.toLowerCase()}|${member.model.toLowerCase()}`;
  });
  if (new Set(identities).size !== identities.length) invalid("Aynı API adresindeki aynı model iki bağımsız üye olarak kullanılamaz.");
  const modelIdentities = settings.council.members.map(member => `${profiles.get(member.providerId)!.provider}:${member.model}`.toLowerCase());
  if (new Set(modelIdentities).size !== modelIdentities.length) invalid("Aynı sağlayıcı türündeki aynı model iki ayrı konsey üyesi olamaz.");
  const required = [settings.primary, ...(settings.council.enabled ? settings.council.members : [])].filter(Boolean) as NonNullable<StoredProviderSettings["primary"]>[];
  if (required.some(choice => !keyFor(profiles.get(choice.providerId)!, env))) invalid("Kullanılacak her modelin API anahtarı bulunmalı.");
}

export function mergeProviderSettings(input: ProviderSettingsInput, previous: StoredProviderSettings | null, env: Env = process.env): StoredProviderSettings {
  const parsed = ProviderSettingsInputSchema.safeParse(input);
  if (!parsed.success) invalid("API ayarlarının alanları geçersiz.");
  input = parsed.data;
  const existing = publicProviderSettings(previous, env);
  if (input.revision !== existing.revision) throw new AppError("busy", "API ayarları başka bir pencerede değişti. Güncel ayarları açıp yeniden kaydet.");
  const providers = input.providers.map(({ apiKey, ...profile }) => {
    const baseURL = normalizeProviderURL(profile.baseURL);
    const old = previous?.providers.find(entry => entry.id === profile.id);
    const fallback = existing.providers.find(entry => entry.id === profile.id);
    const sameEndpoint = (old ?? fallback)?.provider === profile.provider && (old ?? fallback)?.baseURL === baseURL;
    if (apiKey === undefined && !sameEndpoint && (old?.key || old?.useEnvironmentKey || fallback?.keyPresent)) invalid("API adresi veya sağlayıcı değiştiğinde yeni anahtarı açıkça gir.");
    return { ...profile, baseURL,
      key: apiKey === undefined ? sameEndpoint ? old?.key ?? null : null : apiKey,
      useEnvironmentKey: apiKey === undefined && sameEndpoint ? old?.useEnvironmentKey ?? fallback?.keySource === "environment" : false,
    };
  });
  const settings: StoredProviderSettings = { version: 1, revision: randomUUID(), providers, primary: input.primary, council: input.council };
  validateReferences(settings, env);
  return settings;
}

export async function saveProviderSettings(repository: FileProviderSettingsRepository, input: ProviderSettingsInput, env: Env = process.env): Promise<PublicProviderSettings> {
  return repository.exclusive(async () => {
    const settings = mergeProviderSettings(input, repository.loadSync(), env);
    await repository.save(settings);
    return publicProviderSettings(settings, env);
  });
}

export async function resetProviderSettings(repository: FileProviderSettingsRepository, revision: string, env: Env = process.env): Promise<PublicProviderSettings> {
  return repository.exclusive(async () => {
    if (revision !== publicProviderSettings(repository.loadSync(), env).revision) throw new AppError("busy", "API ayarları değişti. Güncel ayarları açıp yeniden dene.");
    const defaults = environmentProviderSettings(env);
    await repository.reset();
    return defaults;
  });
}

/** Each runtime owns separate clients. Already accepted work keeps these instances after settings change. */
export function configuredProviders(saved: StoredProviderSettings | null, env: Env = process.env): { engine: EngineStatus; provider: LLMProvider | null; council: CouncilDeps | null; councilConfigurationError: string | null } {
  if (!saved) {
    const engine = resolveEngineStatus(env);
    // Primary configuration remains strict, including missing credentials; only the optional team is isolated.
    const provider = createProvider(engine, env);
    return { engine, provider, ...environmentCouncil(engine, env) };
  }
  validateReferences(saved, env);
  const create = (choice: NonNullable<StoredProviderSettings["primary"]>) => {
    const profile = saved.providers.find(entry => entry.id === choice.providerId)!;
    if (profile.provider === "anthropic" && !profile.key && profile.useEnvironmentKey) {
      return createProvider({ mode: "ai", provider: "anthropic", model: choice.model }, { ...env, ANTHROPIC_BASE_URL: profile.baseURL })!;
    }
    return createCredentialedProvider(profile.provider, choice.model, keyFor(profile, env)!, profile.baseURL);
  };
  const primary = saved.primary;
  const engine: EngineStatus = primary ? { mode: "ai", provider: saved.providers.find(entry => entry.id === primary.providerId)!.provider, model: primary.model }
    : { mode: "local", provider: "local", model: null, reason: "forced" };
  return { engine, provider: primary ? create(primary) : null, council: saved.council.enabled ? {
    verifySource: true, probeSelected: true, depth: saved.council.depth === "deep" ? DEEP_DEPTH : QUICK_DEPTH,
    members: saved.council.members.map((member, index) => ({ id: `member_${index + 1}`, role: member.role ?? ROLES[index], provider: create(member) })),
    // No replacement model is added without an explicit owner selection.
    reserves: [],
  } : null, councilConfigurationError: null };
}

/** Endpoint/model topology isolates recoverable reviews; credential or label edits retain their work. */
export function providerTopologyKey(settings: StoredProviderSettings): string {
  const choice = (selection: NonNullable<StoredProviderSettings["primary"]>) => {
    const profile = settings.providers.find(entry => entry.id === selection.providerId)!;
    return { provider: profile.provider, baseURL: profile.baseURL, model: selection.model };
  };
  return createHash("sha256").update(JSON.stringify({
    primary: settings.primary ? choice(settings.primary) : null,
    council: { enabled: settings.council.enabled, depth: settings.council.depth,
      members: settings.council.members.map((member, index) => ({ ...choice(member), role: member.role ?? ROLES[index] })) },
  })).digest("hex");
}
