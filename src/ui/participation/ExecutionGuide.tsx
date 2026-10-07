"use client";

import { useState } from "react";
import { useI18n } from "@/ui/i18n";
import { buildExecutionGuide, DESTINATION_LABELS, EXECUTION_DESTINATIONS, type ExecutionDestination, type ExecutionGuideInput } from "./execution-guide";
import styles from "./ExecutionGuide.module.css";

export function ExecutionGuide(input: ExecutionGuideInput) {
  const { locale, t } = useI18n();
  const [override, setOverride] = useState<ExecutionDestination | undefined>();
  const guide = buildExecutionGuide(input, locale, override);
  const deliverables = input.deliverables?.filter((value) => value.trim()).slice(0, 5) ?? [];
  const successCriteria = input.successCriteria?.filter((value) => value.trim()).slice(0, 5) ?? [];
  return (
    <details className={styles.root} open>
      <summary><span>{t("Prompttan gerçek sonuca", "From prompt to real output", "从提示词到实际成果")}</span><strong>{guide.title}</strong></summary>
      <p className={styles.reason}>{guide.reason}</p>
      <div className={styles.destination}>
        <label>{t("Bu promptu nerede kullanacaksın?", "Where will you use this prompt?", "你将在哪里使用提示词？")}
          <select value={override ?? "recommended"} onChange={(event) => setOverride(event.target.value === "recommended" ? undefined : event.target.value as ExecutionDestination)}>
            <option value="recommended">{t("Hedef AI'a göre", "Use the target AI", "使用目标 AI")} · {DESTINATION_LABELS[buildExecutionGuide(input, locale).destination]}</option>
            {EXECUTION_DESTINATIONS.map((value) => <option key={value} value={value}>{DESTINATION_LABELS[value]}</option>)}
          </select>
        </label>
        <span>{t("Bu seçim yalnızca aşağıdaki kullanım rehberini değiştirir. Promptu farklı AI'a uyarlamak için hedef AI ayarını değiştir.", "This choice changes the guide below. To adapt the prompt to a different AI, change the target AI setting.", "此选择只改变下方使用指南。如需让提示词适配其他 AI，请更改目标 AI 设置。")}</span>
      </div>
      <p className={styles.prepare}><strong>{t("Başlamadan hazırla", "Prepare before starting", "开始前准备")}</strong>{guide.prepare}</p>
      <nav className={styles.links} aria-label={t("Resmî araç ve başlangıç bağlantıları", "Official tools and quickstart links", "官方工具和入门链接")}>
        {guide.links.map((link) => <a className="btn" key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true">↗</span></a>)}
      </nav>
      <ol className={styles.steps}>{guide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      {deliverables.length > 0 ? <div className={styles.contract}><strong>{t("Bu sürümde istediğin teslimler", "Requested deliverables in this version", "此版本请求的交付物")}</strong><ul>{deliverables.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
      <div className={styles.verify}><strong>{t("Olduğunu nasıl anlayacaksın?", "How will you know it worked?", "如何确认已完成？")}</strong><p>{guide.verify}</p>
        {successCriteria.length > 0 ? <ul>{successCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      </div>
      <p className={styles.limitation}>{guide.limitation}</p>
    </details>
  );
}
