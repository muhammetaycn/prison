import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError } from "@/services/errors";
import { AIProviderError } from "@/services/ai/errors";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/** Parses and validates a JSON body. Invalid input becomes a 400 with a readable message. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("invalid_input", "İstek gövdesi geçerli JSON değil.");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError("invalid_input", "İstek alanları geçersiz.", result.error.message);
  return result.data;
}

/** Converts thrown errors into JSON error responses. The app never crashes on a failed operation. */
export async function handle(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AIProviderError) {
      return json<ApiErrorBody>({ error: { code: "ai_error", message: error.message } }, 502);
    }
    if (error instanceof AppError) {
      if (error.detail) console.warn(`[prison] ${error.code}: ${error.detail}`);
      return json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[prison] unhandled error", error);
    return json<ApiErrorBody>({ error: { code: "internal", message: "Beklenmeyen bir sunucu hatası oluştu." } }, 500);
  }
}

export type IdParams = { params: Promise<{ id: string }> };
