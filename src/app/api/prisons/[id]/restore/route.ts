import { z } from "zod";
import { getRuntime } from "@/services/runtime";
import { handle, json, readBody, type IdParams } from "../../../_lib/http";

export const dynamic = "force-dynamic";

const RestoreBody = z.object({ version: z.number().int().positive() });

export async function POST(request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const { version } = await readBody(request, RestoreBody);
    const runtime = getRuntime();
    return json({ prison: await runtime.operations.runIdle(id, () => runtime.service.restore(id, version)) });
  });
}
