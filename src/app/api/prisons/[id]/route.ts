import { getRuntime } from "@/services/runtime";
import { handle, json, type IdParams } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    return json({ prison: await getRuntime().service.get(id) });
  });
}

export async function DELETE(_request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const runtime = getRuntime();
    await runtime.operations.runIdle(id, () => runtime.service.remove(id));
    return json({ ok: true });
  });
}
