"use client";

import { useEffect, useState } from "react";
import type { CouncilProgress } from "@/ui/lib/api";
import { useI18n, type Translate } from "@/ui/i18n";
import styles from "./CouncilProgressPanel.module.css";

const STAGE_LABELS: Record<CouncilProgress["stage"], string> = {
  preflight: "Modellerin erişimi kontrol ediliyor",
  research: "Modeller görevi kendi alanlarından inceliyor",
  proposals: "Prompt adayları hazırlanıyor",
  peer_review: "Modeller birbirini değerlendiriyor",
  revision: "Adaylar geri bildirime göre iyileştiriliyor",
  voting: "İyileştirilen adaylar karşılaştırılıyor",
  validation: "Seçilen prompt son kontrolden geçiyor",
};

const STAGE_TRANSLATIONS: Record<CouncilProgress["stage"], [string, string]> = {
  preflight: ["Checking model availability", "正在检查模型可用性"],
  research: ["Models are examining the task from their specialties", "模型正从各自的专业角度研究任务"],
  proposals: ["Preparing prompt candidates", "正在准备提示词候选方案"],
  peer_review: ["Models are reviewing one another", "模型正在相互评审"],
  revision: ["Improving candidates with feedback", "正在根据反馈改进候选方案"],
  voting: ["Comparing improved candidates", "正在比较改进后的候选方案"],
  validation: ["Running the final prompt review", "正在对提示词进行最终审查"],
};

export function CouncilProgressPanel({ progress }: { progress: CouncilProgress }) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState<ReturnType<typeof elapsedOperationTime>>(null);
  useEffect(() => watchElapsedOperationTime(progress.startedAt, setElapsed), [progress.startedAt]);
  return (
    <section className={styles.root} aria-label={progress.councilMode === "single" ? t("AI çalışma ilerlemesi", "AI work progress", "AI 工作进度") : t("AI masası ilerlemesi", "AI table progress", "AI 讨论桌进度")}>
      <div className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        <span className="spinner" aria-hidden />
        <div className={styles.copy}>
          <strong>{t(STAGE_LABELS[progress.stage], ...STAGE_TRANSLATIONS[progress.stage])}</strong>
          <p>{localizeProgressMessage(progress.message, t)}</p>
        </div>
        {progress.total > 0 ? <span className={styles.count}>{progress.completed}/{progress.total} {t("tamamlandı", "completed", "已完成")}</span> : null}
      </div>
      <span className={styles.elapsed} aria-live="off">
        {t("Geçen süre", "Elapsed time", "已用时间")} {elapsed ? <time dateTime={`PT${elapsed.seconds}S`}>{localizedElapsedTime(elapsed.seconds, t)}</time> : "…"}
      </span>
    </section>
  );
}

function localizedElapsedTime(seconds: number, t: Translate): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0 ? t(`${hours} sa ${minutes} dk ${remainder} sn`, `${hours} h ${minutes} min ${remainder} s`, `${hours} 小时 ${minutes} 分 ${remainder} 秒`)
    : minutes > 0 ? t(`${minutes} dk ${remainder} sn`, `${minutes} min ${remainder} s`, `${minutes} 分 ${remainder} 秒`)
      : t(`${remainder} sn`, `${remainder} s`, `${remainder} 秒`);
}

const PROGRESS_MESSAGES: Record<string, [string, string]> = {
  "Seçilen modellerin yanıt verip vermediği kontrol ediliyor.": ["Checking whether the selected models respond.", "正在检查所选模型能否响应。"],
  "Modeller görevi kendi uzmanlık alanlarından inceliyor; notlar masaya paylaşılacak.": ["Models are examining the task from their specialties; notes will be shared with the table.", "模型正从各自的专业角度研究任务，随后将与讨论桌共享笔记。"],
  "Modeller bağımsız prompt adayları hazırlıyor.": ["Models are preparing independent prompt candidates.", "模型正在准备独立的提示词候选方案。"],
  "Modeller diğer adayları eleştiriyor ve geliştirme önerileri veriyor.": ["Models are reviewing other candidates and suggesting improvements.", "模型正在评审其他候选方案并提出改进建议。"],
  "Modeller karşılıklı eleştirilerle ikinci tur adaylarını geliştiriyor.": ["Models are improving second-round candidates using peer critiques.", "模型正在根据相互评审改进第二轮候选方案。"],
  "Bağımsız modeller son adayları puanlıyor; kendi adayına oy verilmiyor.": ["Independent models are scoring the final candidates; they do not vote for their own candidates.", "独立模型正在给最终候选方案打分，不为自己的方案投票。"],
  "Seçilen prompt kullanıcının gerçek koşullarıyla son kez denetleniyor.": ["The selected prompt is being checked against the user's actual requirements one last time.", "正在依据用户的实际要求对所选提示词进行最终检查。"],
  "Bu turdaki jüri üyeleri önceki kimlik doğrulama veya yapılandırma hatası nedeniyle yeni değerlendirme yapamadı; önceki gerçek bulgular korunuyor.": ["The jury could not review this round because of earlier authentication or configuration errors; previous findings are preserved.", "由于先前的身份验证或配置错误，评审团未能完成本轮新评审；此前的实际评审结果已保留。"],
  "Değerlendirmesi yarım kalan jüri üyelerine bir kez daha söz veriliyor.": ["Jurors whose reviews did not complete are being given one more attempt.", "未完成评审的成员正在获得一次重试机会。"],
  "Önerisi yetişmeyen modellere bir kez daha söz veriliyor.": ["Models whose proposals did not complete are being given one more attempt.", "未完成提案的模型正在获得一次重试机会。"],
  "Yazıcı model tüm önerileri ve tartışmayı ortak metinde birleştiriyor.": ["The scribe is combining all proposals and the discussion into a shared draft.", "执笔模型正在将所有提案与讨论内容整合成共同草稿。"],
  "Yazıcı model masanın yorumlarını ortak metne işliyor.": ["The scribe is incorporating the table's comments into the shared draft.", "执笔模型正在将讨论桌的意见纳入共同草稿。"],
  "Masa her öneriyi kendi uzmanlık alanından tartışıyor; oylama yapılmıyor.": ["The table is discussing every proposal from each specialty; there is no voting.", "讨论桌正在从各专业角度讨论每个提案，不进行投票。"],
  "Masa üyeleri tartışmadan öğrendiklerini kendi önerilerine işliyor.": ["Table members are incorporating what they learned into their own proposals.", "讨论桌成员正在将交流所得纳入各自的提案。"],
  "Final karşılaştırmasına hazırlık: kalan adaylar son eleştirilerle güçleniyor.": ["Preparing for the final comparison: remaining candidates are improving with the latest critiques.", "准备最终比较：剩余候选方案正在根据最新评审进行改进。"],
  "Önceki çalışmanın seçilen promptu geri yüklendi; son metin denetiminden devam ediliyor.": ["The earlier selected prompt was restored; work is resuming from the final text review.", "先前选定的提示词已恢复，工作将从最终文本审查继续。"],
  "Görev sözleşmesi konseyden önce kullanıcının gerçek talimatlarıyla denetleniyor.": ["The task specification is being checked against the user's actual instructions before the council starts.", "讨论开始前，正在依据用户的实际指令检查任务规范。"],
  "Görev sözleşmesi doğrulandı; konsey başlayabilir.": ["The task specification was verified; the council can begin.", "任务规范已验证，可以开始讨论。"],
  "Seçilen prompt son metin denetiminin bulgularıyla düzeltiliyor.": ["The selected prompt is being corrected using findings from the final text review.", "正在根据最终文本审查结果修正所选提示词。"],
  "Seçilen prompt görev denetimini geçti.": ["The selected prompt passed the task review.", "所选提示词已通过任务检查。"],
};

/** Only recognized service captions are translated; unfamiliar or quoted content remains verbatim. */
export function localizeProgressMessage(message: string, t: Translate): string {
  const known = PROGRESS_MESSAGES[message];
  if (known) return t(message, ...known);
  let match = /^(\d+)\. tur: kalan adaylar eleştirilere göre güçleniyor\.$/u.exec(message);
  if (match) return t(message, `Round ${match[1]}: remaining candidates are improving with critiques.`, `第 ${match[1]} 轮：剩余候选方案正在根据评审改进。`);
  match = /^(\d+)\. dövüş turu: jüri adayları yeniden puanlıyor\.$/u.exec(message);
  if (match) return t(message, `Competition round ${match[1]}: the jury is scoring candidates again.`, `第 ${match[1]} 轮竞争：评审团正在重新给候选方案打分。`);
  match = /^(\d+)\. denetim turu: masa ortak metni kendi uzmanlık alanından denetliyor; oylama yapılmıyor, herkesin onayı aranıyor\.$/u.exec(message);
  if (match) return t(message, `Review round ${match[1]}: the table is checking the shared draft from each specialty; there is no voting and everyone's approval is sought.`, `第 ${match[1]} 轮审查：讨论桌从各专业角度检查共同草稿，不投票，而是争取所有成员认可。`);
  return message;
}
/** A reload or a new stage keeps the same recorded start; no estimated completion is implied. */
export function elapsedOperationTime(startedAt: string, now: number): { seconds: number; label: string } | null {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return { seconds, label: hours > 0 ? `${hours} sa ${minutes} dk ${remainder} sn` : minutes > 0 ? `${minutes} dk ${remainder} sn` : `${remainder} sn` };
}

export function watchElapsedOperationTime(startedAt: string, onElapsed: (value: ReturnType<typeof elapsedOperationTime>) => void): () => void {
  const update = () => onElapsed(elapsedOperationTime(startedAt, Date.now()));
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}
