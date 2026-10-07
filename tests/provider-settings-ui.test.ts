import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProviderSettingsInputSchema, type PublicProviderSettings } from "@/models/provider-settings";
import { ProviderSettings, settingsDraft } from "@/ui/settings/ProviderSettings";
import { PrisonSidebar } from "@/ui/prison-sidebar/PrisonSidebar";

function publicSettings(): PublicProviderSettings {
  return {
    revision: "saved-revision-test", source: "saved",
    providers: [
      { id: "my_gateway", label: "API seçimim", provider: "compatible", baseURL: "https://api.service.com/v1", keyPresent: true, keySource: "saved" },
      { id: "my_anthropic", label: "İkinci bağlantı", provider: "anthropic", baseURL: "https://api.anthropic.com", keyPresent: false, keySource: "none" },
    ],
    primary: { providerId: "my_gateway", model: "my-primary-model" },
    council: { enabled: true, depth: "quick", members: [
      { providerId: "my_gateway", model: "first-model", role: "Görev sınırları uzmanı" },
      { providerId: "my_gateway", model: "second-model", role: "Çıktı uzmanı" },
      { providerId: "my_anthropic", model: "claude-test-model" },
    ] },
  };
}

describe("editable model team UI", () => {
  it("builds a writable draft without importing credential metadata or secrets into the browser form", () => {
    const settings = publicSettings();
    Object.assign(settings.providers[0], { apiKey: "fake-key-not-real", key: "fake-key-not-real", useEnvironmentKey: true });
    const draft = settingsDraft(settings);
    expect(draft.providers[0]).toEqual({ id: "my_gateway", label: "API seçimim", provider: "compatible", baseURL: "https://api.service.com/v1" });
    const json = JSON.stringify(draft);
    expect(json).not.toContain("fake-key-not-real");
    expect(json).not.toContain("keyPresent");
    expect(json).not.toContain("keySource");
    expect(json).not.toContain("useEnvironmentKey");
    expect(json).not.toContain('"source"');
    expect(ProviderSettingsInputSchema.safeParse(draft).success).toBe(true);
  });

  it("keeps the concurrency revision and the user's actual model IDs and roles", () => {
    const settings = publicSettings();
    const draft = settingsDraft(settings);
    expect(draft.revision).toBe(settings.revision);
    expect(draft.primary).toEqual(settings.primary);
    expect(draft.council).toEqual(settings.council);
    expect(draft.council.members.map(member => member.model)).toEqual(["first-model", "second-model", "claude-test-model"]);
    expect(draft.council.members[0].role).toBe("Görev sınırları uzmanı");
  });

  it("does not mutate the saved evidence while the user edits their draft", () => {
    const settings = publicSettings();
    const snapshot = structuredClone(settings);
    const draft = settingsDraft(settings);
    draft.providers[0].label = "Düzenlenen ad";
    draft.providers[0].apiKey = "fake-new-key-not-real";
    draft.primary!.model = "different-model";
    draft.council.enabled = false;
    draft.council.members[0].role = "Değişen rol";
    draft.council.members.push({ providerId: "my_gateway", model: "fourth-model" });
    expect(settings).toEqual(snapshot);
  });

  it("retains deliberate local analysis and a disabled council without inventing active models", () => {
    const settings = publicSettings();
    settings.primary = null;
    settings.council.enabled = false;
    settings.council.members = [];
    const draft = settingsDraft(settings);
    expect(draft.primary).toBeNull();
    expect(draft.council).toEqual({ enabled: false, depth: "quick", members: [] });
    expect(ProviderSettingsInputSchema.safeParse(draft).success).toBe(true);
  });

  it("does not turn an omitted key into an explicit deletion", () => {
    const draft = settingsDraft(publicSettings());
    expect(Object.prototype.hasOwnProperty.call(draft.providers[0], "apiKey")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft.providers[1], "apiKey")).toBe(false);
    draft.providers[0].apiKey = null;
    const parsed = ProviderSettingsInputSchema.parse(draft);
    expect(parsed.providers[0].apiKey).toBeNull();
    expect(parsed.providers[1].apiKey).toBeUndefined();
  });

  it("labels initial settings loading honestly without claiming a successful save or verified connectivity", () => {
    const onSaved = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const html = renderToStaticMarkup(createElement(ProviderSettings, { onClose, onSaved }));
    expect(html).toContain('aria-label="AI ekibim"');
    expect(html).toContain("AI ekibini kur");
    expect(html).toContain("Ekip yükleniyor");
    expect(html).toContain("Hedef AI promptu kullanacağın yerdir");
    expect(html).toContain("devam eden çalışma kendi ekibiyle tamamlanır");
    expect(html).not.toContain("Ekibin kaydedildi");
    expect(html).not.toContain("Bağlantı doğrulandı");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps team settings accessible while an existing task is working", () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(PrisonSidebar, { prisons: [], activeId: null, engine: null, engineLoading: false, engineHealth: null, checkingEngine: false, onCheckEngine: noop, disabled: true, onSelect: noop, onNew: noop, onDelete: noop, onSettings: noop }));
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>AI ekibim · API ayarları<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*<span aria-hidden="true">\+<\/span> Yeni istek<\/button>/);
  });
});
