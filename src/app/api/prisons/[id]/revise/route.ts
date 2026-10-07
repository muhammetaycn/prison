import { z } from "zod";
import { ClarifyOperationInputSchema, ReviseOperationInputSchema } from "@/models/operation";
import { getRuntime } from "@/services/runtime";
import { handle, json, readBody, type IdParams } from "../../../_lib/http";
import { after } from "next/server";

export const dynamic = "force-dynamic";

const ReviseBody = z.union([
  ReviseOperationInputSchema,
  ClarifyOperationInputSchema,
]);

/** Free-text revision of the ACTIVE prison ("Bunu daha katı yap.", "Canlı deploy yapmasına izin verme."). */
export async function POST(request: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, ReviseBody);
    const runtime = getRuntime();
    const operation = await runtime.operations.start(id, "clarifications" in body ? "clarify" : "revise", () => "clarifications" in body
      ? runtime.service.clarify(id, body.clarifications) : runtime.service.revise(id, body.message), "clarifications" in body
        ? { kind: "clarify", input: body } : { kind: "revise", input: body });
    after(() => runtime.operations.wait(operation.id));
    return json({ operation, accepted: true }, 202);
  });
}
