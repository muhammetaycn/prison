import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CouncilReview } from "@/models/council";
import { I18nProvider } from "@/ui/i18n";
import { CouncilReviewPanel } from "@/ui/prompt-output/CouncilReviewPanel";

function evidence(mode: "competition" | "collaboration"): CouncilReview {
  return {
    mode, executionContext: "agent", startedAt: "2026-10-07T10:00:00Z", completedAt: "2026-10-07T10:01:00Z", rounds: 2,
    selectionBasis: "finalist", winnerId: "a", winnerModel: "test/selected-model", finalReviewerModel: "test/final-reviewer",
    decision: "Original decision: uzlaşma yok; 通过检查。",
    participants: [
      { id: "a", provider: "test", model: "test/selected-model", role: "architect", status: "winner", score: 0.9, error: null, initialPrompt: "Original prompt: vliegtuig uçak 飞机.", revisedPrompt: null, strategies: [], findings: ["Original finding: preserve wing dimensions."] },
      { id: "b", provider: "test", model: "test/reviewed-model", role: "My custom specialist: kanat", status: "reviewed", score: 0.8, error: null, initialPrompt: null, revisedPrompt: null, strategies: [], findings: [] },
      { id: "c", provider: "test", model: "test/failed-model", role: "verifier", status: "failed", score: null, error: "Provider error in original language.", initialPrompt: null, revisedPrompt: null, strategies: [], findings: [] },
    ],
    reviews: [],
  };
}

describe("translated council evidence", () => {
  it.each([
    ["en", "competition", "Finalist that passed the final review", "Competition (detailed)", "Prompt designer", "Agent with tools"],
    ["en", "collaboration", "Finalist that passed the final review", "Team discussion (detailed)", "Prompt designer", "Agent with tools"],
    ["zh", "competition", "通过最终检查的候选方案", "竞争模式（详细）", "提示词设计师", "可使用工具的智能体"],
    ["zh", "collaboration", "通过最终检查的候选方案", "团队讨论（详细）", "提示词设计师", "可使用工具的智能体"],
  ] as const)("preserves a %s %s finalist and the actual editorial content", (locale, mode, finalist, modeLabel, role, context) => {
    const review = evidence(mode);
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale, children: createElement(CouncilReviewPanel, { review }) }));
    expect(html).toContain(finalist);
    expect(html).toContain(modeLabel);
    expect(html).toContain(role);
    expect(html).toContain(context);
    expect(html).not.toContain("Winning prompt");
    expect(html).not.toContain("获胜提示词");
    expect(html).not.toContain("Son denetimden geçen aday");
    expect(html).toContain(review.decision);
    expect(html).toContain(review.participants[0].initialPrompt);
    expect(html).toContain(review.participants[0].findings[0]);
    expect(html).toContain(review.participants[1].role);
    expect(html).toContain(review.participants[2].error);
    expect(html).toContain('title="test/selected-model"');
    expect(html).toContain('title="test/final-reviewer"');
    expect(html).toContain("90/100");
    expect(html).not.toContain("NaN");
  });
});
