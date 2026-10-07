import { getRuntime } from "@/services/runtime";
import { CompileOperationInputSchema } from "@/models/operation";
import { AppError } from "@/services/errors";
import { after } from "next/server";
import { handle, json, type IdParams } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** PROMPTU ÜRET (first compile) and Promptu Yeniden Üret (full regeneration with critic review). */
export async function POST(request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    let value: unknown;
    try { const raw = await request.text(); value = raw.trim() ? JSON.parse(raw) : {}; }
    catch { throw new AppError("invalid_input", "İstek gövdesi geçerli JSON değil."); }
    const parsed = CompileOperationInputSchema.safeParse(value);
    if (!parsed.success) throw new AppError("invalid_input", "Prompt ayarları geçersiz.");
    const runtime = getRuntime();
    const operation = await runtime.operations.start(id, "compile", () => runtime.service.compile(id, parsed.data), { kind: "compile", input: parsed.data });
    after(() => runtime.operations.wait(operation.id));
    return json({ operation, accepted: true }, 202);
  });
}
