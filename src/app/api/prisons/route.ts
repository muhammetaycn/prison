import { z } from "zod";
import { LanguageSchema, TargetAISchema } from "@/models/common";
import { getRuntime } from "@/services/runtime";
import { CouncilModeSchema, ExecutionContextSchema } from "@/models/options";
import { handle, json, readBody } from "../_lib/http";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  rawRequest: z.string(),
  targetAI: TargetAISchema.default("auto"),
  language: LanguageSchema.default("tr"),
  jailbreakMode: z.boolean().optional(),
  executionContext: ExecutionContextSchema.optional(),
  councilMode: CouncilModeSchema.optional(),
});

export async function GET() {
  return handle(async () => json({ prisons: await getRuntime().service.list() }));
}

/** İSTEĞİ ANALİZ ET: creates a new isolated prison from a natural-language request. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, CreateBody);
    const prison = await getRuntime().service.analyze(body);
    return json({ prison }, 201);
  });
}
