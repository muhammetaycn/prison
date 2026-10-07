import { getRuntime } from "@/services/runtime";
import { handle, json, type IdParams } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    return json({ operation: await getRuntime().operations.latest(id) });
  });
}
