import { getRuntime } from "@/services/runtime";
import { describeCouncil } from "@/services/ai/council-config";
import { handle, json } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const runtime = getRuntime();
    return json({ engine: runtime.engine, council: describeCouncil(runtime.council) });
  });
}
