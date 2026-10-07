import { getRuntime } from "@/services/runtime";
import { handle, json, type IdParams } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** Read-only, task-isolated status; no prompt, private reasoning, key or generated permission is exposed. */
export async function GET(_request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    return json({ progress: await getRuntime().service.getProgress(id) });
  });
}
