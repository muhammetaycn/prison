import { AdjustOperationInputSchema } from "@/models/operation";
import { getRuntime } from "@/services/runtime";
import { handle, json, readBody, type IdParams } from "../../../_lib/http";
import { after } from "next/server";

export const dynamic = "force-dynamic";

/** Toolbar modifiers (Daha Teknik, Daha Kısa, …) and target switches. */
export async function POST(request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, AdjustOperationInputSchema);
    const adjustment =
      "action" in body ? { kind: "modifier" as const, action: body.action }
        : "target" in body ? { kind: "target" as const, target: body.target }
          : "executionContext" in body ? { kind: "context" as const, executionContext: body.executionContext }
            : { kind: "council_mode" as const, councilMode: body.councilMode };
    const runtime = getRuntime();
    const operation = await runtime.operations.start(id, "adjust", () => runtime.service.adjust(id, adjustment), { kind: "adjust", input: body });
    after(() => runtime.operations.wait(operation.id));
    return json({ operation, accepted: true }, 202);
  });
}
