"use client";

import { useEffect, useState } from "react";
import styles from "./CouncilArena.module.css";

/** Reveals an existing recorded excerpt; it never simulates new model tokens or private reasoning. */
export function SpeechQuote({ text, animate, speed }: { text: string; animate: boolean; speed: number }) {
  const [length, setLength] = useState(text.length);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!animate || reduced) { setLength(text.length); return; }
    const words = [...text.matchAll(/\S+\s*/gu)].map((match) => match.index + match[0].length);
    if (!words.length) { setLength(text.length); return; }
    const start = performance.now();
    const duration = Math.max(180, Math.min(1100, text.length * 4) / Math.max(1, speed));
    let frame = 0;
    setLength(0);
    const tick = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const word = Math.max(0, Math.ceil(words.length * progress) - 1);
      setLength(progress >= 1 ? text.length : words[word]);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, animate, speed]);
  return (
    <p className={styles.speechQuote}>
      <span aria-hidden="true">{text.slice(0, length)}{length < text.length ? <i className={styles.quoteCursor} /> : null}</span>
      <span className={styles.srOnly}>{text}</span>
    </p>
  );
}
