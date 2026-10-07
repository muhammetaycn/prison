import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";

describe("critic permission boundary", () => {
  it.each(["Hesaba gönderi yayınlama yasaklanmamış", "The target AI may publish the posts"])("blocks an inferred permission while preserving legitimate clarification: %s", async (claim) => {
    const prison = await runAnalysisPipeline({ rawRequest: "Kafeterya için haftalık içerik planı promptu oluştur. Hesaba gönderi yayınlama.", targetAI: "claude", language: "tr" }, null);
    prison.spec.disallowedOperations.push({ id: "deny_publish", text: "Publish posts to the account", source: "explicit" });
    const clarification = "Check that the content plan covers all seven days";
    const result = applyPatch(prison, { add: { requirements: [claim, clarification] } }, CRITIC_POLICY);
    expect(result.blocked).toHaveLength(1);
    expect(result.prison.spec.requirements.map((item) => item.text)).not.toContain(claim);
    expect(result.prison.spec.requirements.map((item) => item.text)).toContain(clarification);
    expect(result.prison.spec.disallowedOperations.find((item) => item.id === "deny_publish")).toEqual(prison.spec.disallowedOperations.at(-1));
    expect(prison.spec.requirements.map((item) => item.text)).not.toContain(clarification);
  });

  it("requires the complete owner permission clause, preserving its approval condition", async () => {
    const permission = "Yayınlama yapılabilir, ancak önce onayımı al.";
    const prison = await runAnalysisPipeline({ rawRequest: `Bir içerik planı oluştur. ${permission}`, targetAI: "claude", language: "tr" }, null);
    const result = applyPatch(prison, { add: { requirements: ["Yayınlama yapılabilir", permission] } }, CRITIC_POLICY);
    expect(result.blocked).toHaveLength(1);
    expect(result.prison.spec.requirements.map((item) => item.text)).not.toContain("Yayınlama yapılabilir");
    expect(result.prison.spec.requirements.map((item) => item.text)).toContain(permission.replace(/\.$/u, ""));
  });
});
