import { describe, expect, it } from "vitest";
import { clarificationMessage } from "@/ui/lib/clarification-answers";

describe("owner clarification messages", () => {
  it("preserves partial answers with their exact question without inventing missing facts", () => {
    const result = clarificationMessage(["Hangi sağlayıcı?", "Bütçe?", "Hangi sağlayıcı?"], { "Hangi sağlayıcı?": "  Stripe; deploy yapma.  ", "Bütçe?": " ", "Eski soru": "Eski yanıt" });
    expect(result.clarifications).toEqual([{ question: "Hangi sağlayıcı?", answer: "Stripe; deploy yapma." }]);
    expect(result.message).toBe("Stripe; deploy yapma.");
    expect(result.answered).toBe(1);
    expect(result.tooLong).toBe(false);
  });
  it("does not submit unanswered questions or inherited object keys as owner statements", () => {
    expect(clarificationMessage(["Bütçe?", "__proto__"], {})).toEqual({ clarifications: [], message: "", answered: 0, tooLong: false });
  });
  it("rejects oversized messages without truncating an owner's directive", () => {
    const answer = "x".repeat(2050) + "; deploy yapma.";
    const result = clarificationMessage(["Sınırlar?"], { "Sınırlar?": answer });
    expect(result.tooLong).toBe(true);
    expect(result.message).toContain(answer);
  });
  it("keeps AI-authored mode and permission suggestions out of owner-authoritative text", () => {
    const result = clarificationMessage(["JB modu kullanılsın mı?", "Yayınlama izni veriliyor mu?"], {
      "JB modu kullanılsın mı?": "Hayır, standart kalsın.",
      "Yayınlama izni veriliyor mu?": "Hayır, yalnızca plan hazırla.",
    });
    expect(result.message).toBe("Hayır, standart kalsın.\n\nHayır, yalnızca plan hazırla.");
    expect(result.message).not.toContain("JB modu");
    expect(result.message).not.toContain("Yayınlama izni");
    expect(result.clarifications).toHaveLength(2);
  });
});
