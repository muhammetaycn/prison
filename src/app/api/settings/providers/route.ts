import { ProviderSettingsInputSchema, ProviderSettingsResetSchema } from "@/models/provider-settings";
import { getRuntimeDataDir } from "@/services/runtime";
import { FileProviderSettingsRepository } from "@/services/storage/provider-settings-repository";
import { publicProviderSettings, saveProviderSettings, resetProviderSettings } from "@/services/ai/provider-settings";
import { AppError } from "@/services/errors";
import { handle, json } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const repository = () => new FileProviderSettingsRepository(getRuntimeDataDir());
const privateResponse = (settings: ReturnType<typeof publicProviderSettings>) => {
  const response = json({ settings });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || site === "cross-site") {
    throw new AppError("invalid_input", "API ayarları yalnızca bu uygulama üzerinden değiştirilebilir.");
  }
}

async function body(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  if (Number(request.headers.get("content-length") ?? "0") > 100000) throw new AppError("invalid_input", "API ayarları çok büyük.");
  let text: string;
  try { text = await request.text(); }
  catch { throw new AppError("invalid_input", "API ayarları okunamadı."); }
  if (text.length > 100000) throw new AppError("invalid_input", "API ayarları çok büyük.");
  try { return JSON.parse(text); }
  catch { throw new AppError("invalid_input", "API ayarları geçerli JSON olmalı."); }
}

export async function GET() {
  return handle(async () => privateResponse(publicProviderSettings(repository().loadSync())));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const parsed = ProviderSettingsInputSchema.safeParse(await body(request));
    // Never pass schema issues to a logger: a bad field can itself contain a credential.
    if (!parsed.success) throw new AppError("invalid_input", "API ayarlarının alanları geçersiz.");
    return privateResponse(await saveProviderSettings(repository(), parsed.data));
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const parsed = ProviderSettingsResetSchema.safeParse(await body(request));
    if (!parsed.success) throw new AppError("invalid_input", "API ayarlarının sürümü geçersiz.");
    return privateResponse(await resetProviderSettings(repository(), parsed.data.revision));
  });
}
