"use client";

import type { CouncilMode } from "@/models/options";
import { OPTION_VALUE_LABELS } from "@/templates/ui-labels";
import { useI18n } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import { Segmented } from "./Segmented";
import styles from "./ExecutionContextPicker.module.css";

export const COUNCIL_MODE_LABELS: Record<CouncilMode, string> = OPTION_VALUE_LABELS.councilMode;

const ALL_OPTIONS = [
  { value: "single" as const, label: COUNCIL_MODE_LABELS.single },
  { value: "competition" as const, label: COUNCIL_MODE_LABELS.competition },
  { value: "collaboration" as const, label: COUNCIL_MODE_LABELS.collaboration },
];

const DESCRIPTIONS: Record<CouncilMode, string> = {
  single: "Hızlı: tek bir yapay zekâ API'si promptu doğrudan yazar; son metin yine denetlenir. Çoğu iş için yeterli ve en hızlı yol. Daha ayrıntılı, çok modelli bir çalışma istiyorsan masalardan birini seç.",
  competition: "Kapışma: modeller önce görevi kendi alanlarından inceler, sonra yeşil sahada ayrı adaylarla yarışır. Her turda jüri puanlar, altı ölçütün her birinde en iyiye silah verilir, en zayıflar elenip jüriye geçer. Finalden önce en az üç tur dövüşürler; finalde kendi adayına oy vermeden en güçlü prompt kazanır. Daha uzun sürer.",
  collaboration: "Masa: modeller karanlık odada önce görevi inceler, sonra oylama yapmadan tartışır ve birbirlerinden öğrenerek önerilerini geliştirir. Bir yazıcı ortak metni birleştirir; masa en az iki tur denetler ve herkes onaylayana kadar birlikte düzeltirler. Daha uzun sürer.",
};

const DESCRIPTIONS_EN: Record<CouncilMode, string> = {
  single: "Quick: one AI API writes the prompt directly; the final text is still checked. This is the fastest route and sufficient for most tasks. Choose a table for more detailed work with multiple models.",
  competition: "Competition: models examine the task from their specialties, then compete with separate candidates in the green arena. The jury scores each round, awards equipment for the best of six criteria, and moves eliminated contenders to the jury. They compete for at least three rounds before the final; jurors do not vote for their own candidates. This takes longer.",
  collaboration: "Team discussion: models examine the task in the room, discuss without voting, and improve their proposals by learning from one another. A scribe combines the shared draft; the table reviews it for at least two rounds and works toward everyone's approval. This takes longer.",
};
const DESCRIPTIONS_ZH: Record<CouncilMode, string> = {
  single: "快速：由一个 AI API 直接编写提示词，最终文本仍会经过检查。这是最快的方式，适用于大多数任务。如果需要更详细的多模型协作，可以选择讨论桌。",
  competition: "竞争：模型先从各自的专业角度研究任务，再在绿色竞技场中提交独立方案。评审团为每轮打分，按六项标准授予装备，淘汰的选手转入评审团。决赛前至少进行三轮，评审不为自己的方案投票。此方式需要更长时间。",
  collaboration: "团队讨论：模型在讨论室内研究任务，在不投票的情况下交流，并通过相互学习改进提案。执笔模型整合共同草稿；讨论桌至少审查两轮，继续修改以争取所有成员认可。此方式需要更长时间。",
};

interface CouncilModePickerProps {
  value: CouncilMode;
  disabled?: boolean;
  /** Whether a multi-model council is configured; without one only the fast single-model path is offered. */
  available?: boolean;
  onChange: (value: CouncilMode) => void;
}

export function CouncilModePicker({ value, disabled = false, available = true, onChange }: CouncilModePickerProps) {
  const { t } = useI18n();
  const label = useVocabulary();
  const options = available ? ALL_OPTIONS : ALL_OPTIONS.slice(0, 1);
  const shown = available ? value : "single";
  return (
    <div className={styles.root}>
      <span className="label">{t("Çalışma biçimi", "Working mode", "工作方式")}</span>
      <Segmented label={t("Çalışma biçimi", "Working mode", "工作方式")} value={shown} options={options.map((option) => ({ ...option, label: label(option.label) }))} disabled={disabled} onChange={onChange} />
      <p className={styles.description}>
        {t(DESCRIPTIONS[shown], DESCRIPTIONS_EN[shown], DESCRIPTIONS_ZH[shown])}
        {available ? null : t(" Çok modelli masa için yan menüdeki AI ekibim · API ayarları bölümünden 3–6 model seçebilirsin.", " For a multi-model table, choose 3–6 models in My AI team · API settings in the sidebar.", " 如需多模型讨论桌，可在侧栏的“我的 AI 团队 · API 设置”中选择 3–6 个模型。")}
      </p>
    </div>
  );
}
