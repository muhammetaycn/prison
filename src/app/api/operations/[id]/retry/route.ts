import { after } from "next/server";
import { getRuntime } from "@/services/runtime";
import { handle, json, type IdParams } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** The server replays its validated saved action; the browser cannot substitute stale choices. */
export async function POST(_request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const runtime = getRuntime();
    const operation = await runtime.operations.retry(id);
    after(() => runtime.operations.wait(operation.id));
    return json({ operation, accepted: true }, 202);
  });
}
