import { getRuntime } from "@/services/runtime";
import { handle, json } from "../../_lib/http";

export const dynamic = "force-dynamic";
// Hosted platforms can allow the provider's bounded timeout/retry to finish.
export const maxDuration = 200;

/** Called only by an explicit connectivity check; GET /api/engine makes no remote call. */
export async function POST() {
  return handle(async () => json({ health: await getRuntime().checkEngine() }));
}
