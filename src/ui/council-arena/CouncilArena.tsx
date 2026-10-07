"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { COUNCIL_DIMENSIONS, type CouncilDimension, type CouncilEvent } from "@/models/council";
import { councilEventIndexAtSeq, councilEventSeqAtIndex, isNextCouncilEvent, nextCouncilEventSeq } from "@/models/council-events";
import type { CouncilMode } from "@/models/options";
import { cx } from "@/ui/lib/format";
import { useI18n, type Translate } from "@/ui/i18n";
import type { Anchor, ArenaScene } from "./scene";
import { kindLabel, modelLabel, seatsFrom, stateAt, weaponName, type Seat } from "./timeline";
import { WEATHER_LABELS, weatherAt, type WeatherKind } from "./weather";
import { titleCardFor, type TitleCard } from "./cards";
import { ArenaSound } from "./sound";
import { SpeechQuote } from "./SpeechQuote";
import { PromptJourney } from "@/ui/participation/PromptJourney";
import { entranceFor, juryScoreText, sceneUpdateKey, viewingDwellMs } from "./viewing";
import styles from "./CouncilArena.module.css";

interface CouncilArenaProps {
  mode: CouncilMode;
  events: CouncilEvent[];
  /** Live: follows new events as the server reports them. Replay: starts at the outcome with controls. */
  live: boolean;
  /** Only a saved prompt version can offer the handoff step. Failed ledgers remain reviewable. */
  promptReady?: boolean;
}

const SPEEDS = [1, 2, 4] as const;
const SPOKEN = new Set<CouncilEvent["kind"]>(["research", "proposal", "revision", "draft", "critique", "approval", "objection", "failed", "abstained", "winner", "finalist", "eliminated", "weapon", "replace", "memory"]);

interface Floater { key: number; seat: string; text: string; tone: "hit" | "ok" | "bad" }

function previousSpoken(events: CouncilEvent[], index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor--) if (events[cursor].kind !== "thinking") return cursor;
  return -1;
}

function nextSpoken(events: CouncilEvent[], index: number): number {
  for (let cursor = index + 1; cursor < events.length; cursor++) if (events[cursor].kind !== "thinking") return cursor;
  return events.length - 1;
}

const DECISION_KINDS = new Set<CouncilEvent["kind"]>([
  "research", "proposal", "draft", "critique", "approval", "objection", "weapon", "eliminated", "winner", "finalist", "replace", "memory",
]);

interface RoundSegment {
  round: number;
  label: string;
  startIndex: number;
  endIndex: number;
  count: number;
}

interface MilestoneMarker {
  index: number;
  seq: number;
  kind: CouncilEvent["kind"];
  icon: string;
  title: string;
  seatId?: string;
  color?: string;
}

/** Whose turn it is, what they are saying and what the rules decided — as a lamp-lit table or a fighting field. */
export function CouncilArena({ mode, events, live, promptReady = false }: CouncilArenaProps) {
  const { locale, t } = useI18n();
  const eventLabel = (kind: CouncilEvent["kind"]) => kindLabel(kind, mode, locale);
  const equipmentLabel = (dimension: CouncilDimension) => weaponName(dimension, locale);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRefs = useRef(new Map<string, HTMLDivElement>());
  const sceneRef = useRef<ArenaScene | null>(null);
  /** Stage sound: made on the fly, off until the viewer turns it on. */
  const soundRef = useRef<ArenaSound | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const shownRef = useRef(-1);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const floaterKey = useRef(0);
  const cardTimerRef = useRef<number | null>(null);
  const floaterTimersRef = useRef(new Set<number>());
  const sceneKeyRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  // A saved council also plays from the first moment, so the deliberation is seen rather than only its outcome.
  const [cursorSeq, setCursorSeq] = useState(-1);
  /** The broadcast-style title card on screen, if any. */
  const [card, setCard] = useState<TitleCard | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [following, setFollowing] = useState(live);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [decisionsOnly, setDecisionsOnly] = useState(false);
  const [readingTempo, setReadingTempo] = useState(false);

  const fight = mode === "competition";
  const index = councilEventIndexAtSeq(events, cursorSeq);
  const seats = useMemo(() => seatsFrom(events), [events]);
  const seatKey = seats.map((seat) => `${seat.id}:${seat.model}`).join("|");
  const state = useMemo(() => stateAt(events, index), [events, index]);
  // The weather follows what really happens at the table; it never changes a score.
  const weather = useMemo(() => weatherAt(events, index, state), [events, index, state]);
  const weatherLabel = localizedWeatherLabel(weather.kind, t);
  const weatherReason = localizedWeatherReason(weather.reason, t);
  const current = index >= 0 ? events[index] : undefined;
  const backlog = events.length - 1 - index;
  const effectiveSpeed = live && following && backlog > 8 ? Math.max(speed, 4) : speed;

  const roundSegments = useMemo(() => {
    if (!events.length) return [];
    const segments: RoundSegment[] = [];
    let curRound = -1;
    let startIdx = 0;
    for (let i = 0; i < events.length; i++) {
      const r = events[i].round;
      if (r !== curRound) {
        if (curRound !== -1 && i > startIdx) {
          segments.push({
            round: curRound,
            label: curRound === 0 ? t("Hazırlık", "Preparation", "准备") : t(`${curRound}. Tur`, `Round ${curRound}`, `第 ${curRound} 轮`),
            startIndex: startIdx,
            endIndex: i - 1,
            count: i - startIdx,
          });
        }
        curRound = r;
        startIdx = i;
      }
    }
    if (events.length > startIdx) {
      segments.push({
        round: curRound,
        label: curRound === 0 ? t("Hazırlık", "Preparation", "准备") : t(`${curRound}. Tur`, `Round ${curRound}`, `第 ${curRound} 轮`),
        startIndex: startIdx,
        endIndex: events.length - 1,
        count: events.length - startIdx,
      });
    }
    return segments;
  }, [events, t]);

  const milestones = useMemo(() => {
    const list: MilestoneMarker[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      let icon = "";
      let title = "";
      if (e.kind === "winner") {
        icon = fight ? t("K", "W", "胜") : t("U", "C", "合");
        title = fight ? t("Final Kararı", "Final decision", "最终决定") : t("Uzlaşma Kararı", "Consensus decision", "共识决定");
      } else if (e.kind === "finalist") {
        icon = t("D", "R", "审");
        title = t("Son denetime seçilen aday", "Candidate selected for final review", "选入最终审查的候选方案");
      } else if (e.kind === "eliminated") {
        icon = t("E", "E", "淘");
        title = t("Eleme", "Elimination", "淘汰");
      } else if (e.kind === "weapon") {
        icon = t("S", "G", "装");
        title = e.dimension ? weaponName(e.dimension, locale) : t("Silah", "Equipment", "装备");
      } else if (e.kind === "draft") {
        icon = t("T", "D", "稿");
        title = t("Ortak taslak", "Shared draft", "共同草稿");
      } else if (e.kind === "research") {
        icon = t("İ", "R", "研");
        title = fight ? t("Keşif", "Exploration", "探索") : t("İnceleme", "Research", "研究");
      }
      if (icon) {
        const s = seats.find((seat) => seat.id === e.actorId);
        const markerTitle = e.kind === "winner" ? title : s ? `${title}: ${s.label}` : title;
        list.push({
          index: i,
          seq: e.seq,
          kind: e.kind,
          icon,
          title: markerTitle,
          seatId: e.actorId,
          color: s?.color,
        });
      }
    }
    return list;
  }, [events, fight, seats, locale, t]);

  // Build the stage once per mode. three.js is loaded only here, on the client.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    void Promise.all([import("three"), import("./scene")]).then(([three, stage]) => {
      if (disposed) return;
      try {
        sceneRef.current = new stage.ArenaScene(three, host, {
          mode, reducedMotion,
          onCue: (cue, strength) => soundRef.current?.play(cue, strength),
          onFrame: (anchors: Anchor[]) => {
            const width = host.clientWidth;
            const height = host.clientHeight;
            for (const anchor of anchors) {
              const element = overlayRefs.current.get(anchor.id);
              if (!element) continue;
              // Keep the whole bubble inside the stage: it hangs above the head, centered on it.
              const half = element.offsetWidth / 2;
              const x = Math.min(Math.max(anchor.x, half + 6), Math.max(half + 6, width - half - 6));
              const y = Math.min(Math.max(anchor.y, element.offsetHeight + 6), height - 6);
              element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
              element.style.opacity = anchor.visible ? "1" : "0";
            }
          },
        });
        shownRef.current = -2;
        sceneKeyRef.current = null;
        setReady(true);
      } catch {
        setFallback(true);
      }
    }).catch(() => setFallback(true));
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [mode]);

  useEffect(() => {
    if (ready) { sceneRef.current?.setSeats(seats); sceneKeyRef.current = null; }
    // seatKey captures membership changes; seats is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, seatKey]);

  // Rain and crowd beds follow the weather and the stage; sound stops when the arena goes away.
  useEffect(() => {
    soundRef.current?.setBeds(weather.kind === "storm" ? 1 : weather.kind === "rainy" ? 0.7 : 0, fight ? 0.8 : 0.12);
  }, [weather.kind, fight, soundOn]);
  useEffect(() => () => soundRef.current?.dispose(), []);
  useEffect(() => () => {
    if (cardTimerRef.current !== null) window.clearTimeout(cardTimerRef.current);
    for (const timer of floaterTimersRef.current) window.clearTimeout(timer);
    floaterTimersRef.current.clear();
  }, []);
  // A speed change takes effect immediately without resetting the current action or camera.
  useEffect(() => { if (ready) sceneRef.current?.setSpeed(effectiveSpeed); }, [ready, effectiveSpeed]);

  const toggleSound = () => {
    const sound = (soundRef.current ??= new ArenaSound());
    const next = !soundOn;
    void sound.enable(next).then(() => setSoundOn(next && sound.on));
  };

  // Apply the moment to the stage: act it out when stepping forward by one, otherwise snap.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const sceneKey = sceneUpdateKey(state, current ?? null, seatKey);
    if (sceneKeyRef.current === sceneKey) return;
    sceneKeyRef.current = sceneKey;
    scene.setSpeed(effectiveSpeed);
    const step = current !== undefined && isNextCouncilEvent(events, shownRef.current, current.seq);
    scene.sync(state, current ?? null, step && playing);
    scene.setWeather(weather, step && playing);
    // Big moments get a title card while the replay runs forward (never on jumps).
    if (step && playing) {
      const next = titleCardFor(events, index, mode, (id) => seats.find((seat) => seat.id === id));
      if (next) {
        setCard(next);
        if (next.tone === "round" || next.tone === "weapon") soundRef.current?.play("swish", 0.7);
        if (cardTimerRef.current !== null) window.clearTimeout(cardTimerRef.current);
        cardTimerRef.current = window.setTimeout(() => { setCard((shown) => (shown?.key === next.key ? null : shown)); cardTimerRef.current = null; }, 1900 / effectiveSpeed);
      }
    }
    shownRef.current = current?.seq ?? -1;
    if (step && playing && current?.kind === "critique" && fight && current.targetId && current.score !== null) {
      const key = ++floaterKey.current;
      setFloaters((list) => [...list.slice(-6), { key, seat: current.targetId!, text: juryScoreText(current.score) ?? "", tone: "hit" }]);
      const timer = window.setTimeout(() => { setFloaters((list) => list.filter((entry) => entry.key !== key)); floaterTimersRef.current.delete(timer); }, 1400);
      floaterTimersRef.current.add(timer);
    }
    if (step && playing && (current?.kind === "approval" || current?.kind === "objection")) {
      const key = ++floaterKey.current;
      setFloaters((list) => [...list.slice(-6), { key, seat: current.actorId, text: current.kind === "approval" ? "✓" : "!", tone: current.kind === "approval" ? "ok" : "bad" }]);
      const timer = window.setTimeout(() => { setFloaters((list) => list.filter((entry) => entry.key !== key)); floaterTimersRef.current.delete(timer); }, 1400);
      floaterTimersRef.current.add(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index, state, seatKey]);

  // Only a changed playback moment or tempo resets its deadline, never an identical poll.
  const nextPlaybackSeq = nextCouncilEventSeq(events, cursorSeq);
  const playbackWait = current ? viewingDwellMs(current, readingTempo) / effectiveSpeed : 400;
  useEffect(() => {
    if (!playing) return;
    if (nextPlaybackSeq === cursorSeq) {
      if (!live) setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCursorSeq(nextPlaybackSeq), playbackWait);
    return () => window.clearTimeout(timer);
  }, [playing, cursorSeq, nextPlaybackSeq, playbackWait, live]);

  // Keep the current line visible inside the transcript without moving the page.
  useEffect(() => {
    const list = transcriptRef.current;
    const item = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - item.offsetHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  }, [index, events]);

  const thinkingText = useMemo(() => {
    const texts = new Map<string, string>();
    for (const event of events.slice(0, index + 1)) if (event.kind === "thinking") texts.set(event.actorId, event.text);
    return texts;
  }, [events, index]);

  const seatOf = (id: string | null | undefined) => seats.find((seat) => seat.id === id);
  const caption = captionFor(current, mode, seatOf, t, equipmentLabel);
  const visibleEvents = useMemo(
    () => events.map((event, position) => ({ event, position })).filter(({ event }) => event.kind !== "thinking"),
    [events],
  );
  const currentSpoken = current?.kind === "thinking" ? previousSpoken(events, index + 1) : index;
  const recorded = events[currentSpoken];
  const quote = recorded && SPOKEN.has(recorded.kind) ? recorded : null;

  const filteredEvents = useMemo(() => {
    return visibleEvents.filter(({ event }) => {
      if (actorFilter && event.actorId !== actorFilter && event.targetId !== actorFilter) {
        return false;
      }
      if (decisionsOnly && !DECISION_KINDS.has(event.kind)) {
        return false;
      }
      return true;
    });
  }, [visibleEvents, actorFilter, decisionsOnly]);

  const clearTransient = () => {
    if (cardTimerRef.current !== null) window.clearTimeout(cardTimerRef.current);
    cardTimerRef.current = null;
    for (const timer of floaterTimersRef.current) window.clearTimeout(timer);
    floaterTimersRef.current.clear();
    setCard(null);
    setFloaters([]);
  };

  const restart = () => { clearTransient(); setFollowing(false); setCursorSeq(-1); setPlaying(true); };
  const jump = (target: number) => {
    clearTransient();
    setPlaying(false);
    setFollowing(false);
    setCursorSeq(councilEventSeqAtIndex(events, Math.max(-1, target)));
  };

  const progressPercent = events.length > 1 ? Math.min(100, Math.max(0, (index / (events.length - 1)) * 100)) : 0;

  return (
    <section className={cx(styles.root, fight ? styles.fight : styles.table)} aria-label={fight ? t("Kapışma arenası", "Competition arena", "竞技场") : t("Tartışma masası", "Discussion table", "讨论桌")}>
      <div className={styles.head}>
        <div>
          <span className="label">{live ? t("Canlı", "Live", "实时") : t("Tekrar", "Replay", "回放")} · {fight ? t("Kapışma arenası", "Competition arena", "竞技场") : t("Tartışma masası", "Discussion table", "讨论桌")}</span>
          <h3>{fight ? t("Yeşil saha: silahlar, saldırılar ve eleme", "The field: equipment, critiques and elimination", "绿地：装备、评审与淘汰") : t("Karanlık oda: oylamasız ortak çalışma", "The room: collaboration through consensus", "讨论室：通过共识共同协作")}</h3>
        </div>
        <span className={styles.round}>{state.round > 0 ? t(`${state.round}. tur`, `Round ${state.round}`, `第 ${state.round} 轮`) : t("Hazırlık", "Preparation", "准备")}</span>
      </div>

      <div className={styles.stage}>
        <div ref={hostRef} className={styles.canvas} />
        {!ready && !fallback ? <div className={styles.loading}><span className="spinner" aria-hidden /> {t("Sahne hazırlanıyor…", "Preparing the scene…", "正在准备场景…")}</div> : null}
        <div className={cx(styles.overlay, fallback && styles.overlayStatic)}>
          {seats.map((seat) => {
            const speaking = state.speaker === seat.id;
            const thinking = state.thinking.includes(seat.id);
            const eliminated = state.eliminated.includes(seat.id);
            const bubble = speaking && current && SPOKEN.has(current.kind) ? current : null;
            const health = state.health[seat.id];
            return (
              <div key={seat.id} className={styles.seat} ref={(element) => { if (element) overlayRefs.current.set(seat.id, element); else overlayRefs.current.delete(seat.id); }}
                style={{ "--seat": seat.color, zIndex: speaking ? 3 : thinking ? 2 : 1 } as CSSProperties}>
                {bubble ? (
                  <div key={bubble.seq} className={cx(styles.bubble, styles[`enter_${entranceFor(bubble)}`], bubble.kind === "objection" && styles.bubbleBad, bubble.kind === "approval" && styles.bubbleGood)} role="note">
                    <strong>{eventLabel(bubble.kind)}{bubble.targetId && seatOf(bubble.targetId) ? ` → ${seatOf(bubble.targetId)!.label}` : ""}</strong>
                    <span>{bubble.kind === "weapon" && bubble.dimension ? equipmentLabel(bubble.dimension) : bubble.text}</span>
                  </div>
                ) : thinking ? (
                  <div className={cx(styles.bubble, styles.thought)}>
                    <span className={styles.dots} aria-hidden><i /><i /><i /></span>
                    <span>{thinkingText.get(seat.id) ?? t("Düşünüyor", "Thinking", "思考中")}</span>
                  </div>
                ) : null}
                <div className={cx(styles.chip, speaking && styles.speaking, thinking && styles.thinking, eliminated && styles.out, state.winner === seat.id && styles.winner)}>
                  <span className={styles.dot} />
                  <span className={styles.name} title={seat.model}>{seat.label}</span>
                  {eliminated ? <span className={styles.tag}>{fight ? t("jüri", "jury", "评审团") : t("ayrıldı", "left", "已离开")}</span> : null}
                  {state.winner === seat.id ? <span className={styles.tag}>{fight ? t("kazanan", "winner", "胜出者") : t("yazıcı", "author", "执笔者")}</span> : null}
                  {state.finalist === seat.id ? <span className={styles.tag}>{t("son denetim adayı", "final review candidate", "最终审查候选")}</span> : null}
                </div>
                {fight && health !== undefined && !eliminated ? (
                  <div className={styles.kit}>
                    {health !== undefined && !eliminated ? (
                      <span className={cx(styles.health, weather.kind === "heat" && styles.healthHeat)} title={t(`Jüri ortalaması ${Math.round(health * 100)}/100`, `Jury average ${Math.round(health * 100)}/100`, `评审平均分 ${Math.round(health * 100)}/100`)}>
                        <i style={{ width: `${Math.round(health * 100)}%` }} />
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {floaters.filter((floater) => floater.seat === seat.id).map((floater) => (
                  <span key={floater.key} className={cx(styles.floater, floater.tone === "ok" && styles.floaterOk, floater.tone === "bad" && styles.floaterBad)} aria-hidden>{floater.text}</span>
                ))}
              </div>
            );
          })}
        </div>
        {card ? (
          <div key={card.key} className={cx(styles.card, styles[`card_${card.tone}`])} aria-live="polite"
            style={{ "--seat": card.seat?.color ?? "#f2c14e", "--card-time": `${1.9 / effectiveSpeed}s` } as CSSProperties}>
            <span>{localizedCardLabel(card.label, t)}</span>
            <strong>{localizedCardTitle(card, t)}</strong>
          </div>
        ) : null}
        {ready && events.length ? (
          <div className={cx(styles.weather, styles[`weather_${weather.kind}`])} title={`${weatherLabel} · ${weatherReason}`} aria-label={t(`Hava: ${weatherLabel}, ${weatherReason}`, `Weather: ${weatherLabel}, ${weatherReason}`, `天气：${weatherLabel}，${weatherReason}`)}>
            <span className={styles.weatherIcon} aria-hidden />
            <strong>{weatherLabel}</strong>
            <span>{weatherReason}</span>
          </div>
        ) : null}
        {caption ? <div className={styles.caption} aria-live={live ? "polite" : "off"}>{caption}</div> : null}
        {seats.length === 0 ? <div className={styles.empty}>{fight ? t("Modeller sahaya geliyor…", "Models are entering the arena…", "模型正在进入竞技场…") : t("Modeller masaya geliyor…", "Models are joining the table…", "模型正在加入讨论桌…")}</div> : null}
      </div>

      {quote ? (
        <section className={cx(styles.speechDeck, styles[`enter_${entranceFor(quote)}`])} aria-label={t("Bu anın kaydedilen açıklaması", "Recorded explanation of this moment", "此刻的已记录说明")}
          style={{ "--seat": seatOf(quote.actorId)?.color ?? "#f2c14e" } as CSSProperties}>
          <div className={styles.speechMeta}>
            <strong title={seatOf(quote.actorId)?.model ?? undefined}>{seatOf(quote.actorId)?.label ?? t("Masa", "Table", "讨论桌")}</strong>
            <span>{eventLabel(quote.kind)}{quote.targetId && seatOf(quote.targetId) ? ` → ${seatOf(quote.targetId)!.label}` : ""}</span>
            <small>{t("Kaydedilen açıklama", "Recorded explanation", "已记录说明")}</small>
          </div>
          <SpeechQuote key={quote.seq} text={quote.kind === "weapon" && quote.dimension ? equipmentLabel(quote.dimension) : quote.text} animate={playing && current?.kind !== "thinking"} speed={effectiveSpeed} />
          {quote.kind === "critique" && quote.score !== null ? <span className={styles.reviewScore}>{t("Bu değerlendirme:", "This review:", "本次评审：")} {juryScoreText(quote.score)}</span> : null}
        </section>
      ) : null}

      {/* Interactive Round Timeline Scrubber */}
      {events.length > 0 ? (
        <div className={styles.timelineBar} role="region" aria-label={t("Tur çizelgesi ve ilerleme", "Round timeline and progress", "轮次时间线与进度")}>
          <div className={styles.timelineRounds}>
            {roundSegments.map((segment) => {
              const isCurrentRound = state.round === segment.round;
              return (
                <button
                  key={segment.round}
                  type="button"
                  className={cx(styles.timelineRoundBtn, isCurrentRound && styles.timelineRoundActive)}
                  onClick={() => jump(segment.startIndex)}
                  title={t(`${segment.label} (${segment.count} olay) — bu tura atla`, `${segment.label} (${segment.count} events) — jump to this round`, `${segment.label}（${segment.count} 个事件）— 跳转到此轮`)}
                  style={{ flex: Math.max(1, segment.count) }}
                >
                  <span className={styles.timelineRoundLabel}>{segment.label}</span>
                  <span className={styles.timelineRoundCount}>{segment.count}</span>
                </button>
              );
            })}
          </div>

          <div
            className={styles.scrubberTrack}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetIdx = Math.round(ratio * (events.length - 1));
              jump(targetIdx);
            }}
            title={t("İstediğin ana atlamak için çizelgeye tıkla", "Click the timeline to jump to a moment", "点击时间线跳转到某个时刻")}
          >
            <div className={styles.scrubberProgress} style={{ width: `${progressPercent}%` }} />
            {milestones.map((m) => {
              const pct = events.length > 1 ? (m.index / (events.length - 1)) * 100 : 0;
              const isPassed = index >= m.index;
              return (
                <button
                  key={m.seq}
                  type="button"
                  className={cx(styles.timelineMarker, isPassed && styles.timelineMarkerPassed)}
                  style={{ left: `${pct}%`, borderColor: m.color || "var(--accent)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    jump(m.index);
                  }}
                  title={m.title}
                  aria-label={m.title}
                >
                  <span className={styles.markerIcon}>{m.icon}</span>
                </button>
              );
            })}
            <div className={styles.scrubberThumb} style={{ left: `${progressPercent}%` }} />
          </div>
          <input className={styles.timelineSeek} type="range" min={-1} max={events.length - 1} value={index} step={1}
            aria-label={t("İzleme anını seç", "Choose a replay moment", "选择回放时刻")} aria-valuetext={index < 0 ? t("Başlangıç", "Start", "开始") : `${index + 1}/${events.length} · ${eventLabel(events[index].kind)}`}
            onChange={(event) => jump(Number(event.target.value))} />
        </div>
      ) : null}

      <div className={styles.controls}>
        <button type="button" className="btn" onClick={restart} disabled={!events.length}>{t("Baştan izle", "Watch from the start", "从头观看")}</button>
        {!live ? <button type="button" className="btn" onClick={() => jump(events.length - 1)} disabled={index >= events.length - 1}>{t("Sonuca atla", "Jump to the result", "跳转到结果")}</button> : null}
        <button type="button" className="btn" onClick={() => jump(previousSpoken(events, index))} disabled={index <= 0} aria-label={t("Önceki adım", "Previous step", "上一步")}>◀</button>
        <button type="button" className="btn" onClick={() => { if (index >= events.length - 1 && !live) { restart(); return; } setPlaying((value) => !value); }} disabled={!events.length}>
          {playing ? t("Duraklat", "Pause", "暂停") : t("Oynat", "Play", "播放")}
        </button>
        <button type="button" className="btn" onClick={() => jump(nextSpoken(events, index))} disabled={index >= events.length - 1} aria-label={t("Sonraki adım", "Next step", "下一步")}>▶</button>
        <button type="button" className={cx("btn", soundOn && styles.soundOn)} onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? t("Ses açık", "Sound on", "声音已开启") : t("Ses kapalı", "Sound off", "声音已关闭")}
        </button>
        <div className={styles.speeds} role="group" aria-label={t("Oynatma hızı", "Playback speed", "播放速度")}>
          {SPEEDS.map((value) => (
            <button key={value} type="button" className={cx(styles.speed, speed === value && styles.speedOn)} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}x</button>
          ))}
        </div>
        <button type="button" className={cx("btn", readingTempo && styles.readingOn)} aria-pressed={readingTempo} onClick={() => setReadingTempo((value) => !value)} title={t("Uzun açıklamalara daha fazla okuma süresi ayır", "Allow more time to read longer explanations", "为较长的说明留出更多阅读时间")}>{t("Okuma temposu", "Reading pace", "阅读节奏")}</button>
        {live && !following ? <button type="button" className="btn" onClick={() => { setFollowing(true); setPlaying(true); }}>{t("Canlıya dön", "Return to live", "返回实时")}</button> : null}
        <span className={styles.legend}><span className={styles.legendDot} /> {t("yeşil: konuşan · yanıp sönen: düşünen", "green: speaking · pulsing: thinking", "绿色：发言 · 闪动：思考")}</span>
      </div>

      <PromptJourney stage={live ? "working" : promptReady ? "ready" : "review"} councilEvidence={events.some((event) => event.kind === "critique" || event.kind === "approval" || event.kind === "objection")} compact />
      {fight ? <details className={styles.equipmentGuide}>
        <summary>{t("Ekipmanlar promptun hangi gücünü gösteriyor?", "Which prompt strengths does the equipment represent?", "装备代表提示词的哪些优势？")}</summary>
        <p>{t("Silahlar karakterlerin kanadında veya sırtında taşınır. Her biri jürinin değerlendirdiği bir ölçütü temsil eder; bu andaki sahipleri aşağıda.", "Equipment is carried on each character’s wing or back. Each piece represents a jury criterion; its current owner is listed below.", "装备佩戴在角色的翅膀或背部。每件装备对应一项评审标准；当前持有者列在下方。")}</p>
        <dl>{COUNCIL_DIMENSIONS.map((dimension) => <div key={dimension}><dt>{equipmentLabel(dimension)}</dt><dd>{seatOf(state.weapons[dimension])?.label ?? t("Henüz verilmedi", "Not yet awarded", "尚未授予")}</dd></div>)}</dl>
      </details> : null}

      {/* Transcript Filter Controls */}
      <div className={styles.transcriptControls} role="region" aria-label={t("Konuşma dökümü filtreleri", "Transcript filters", "对话记录筛选")}>
        <div className={styles.actorFilters} role="group" aria-label={t("Konuşmacıya göre filtrele", "Filter by speaker", "按发言者筛选")}>
          <span className={styles.filterTitle}>{t("Konuşmacı:", "Speaker:", "发言者：")}</span>
          <button
            type="button"
            className={cx(styles.filterPill, actorFilter === null && styles.filterPillActive)}
            aria-pressed={actorFilter === null}
            onClick={() => setActorFilter(null)}
          >
            {t("Tümü", "All", "全部")}
          </button>
          {seats.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className={cx(styles.filterPill, actorFilter === seat.id && styles.filterPillActive)}
              aria-pressed={actorFilter === seat.id}
              onClick={() => setActorFilter(actorFilter === seat.id ? null : seat.id)}
            >
              <span className={styles.pillDot} style={{ background: seat.color }} />
              {seat.label}
            </button>
          ))}
        </div>

        <div className={styles.kindFilters}>
          <button
            type="button"
            className={cx(styles.filterPill, decisionsOnly && styles.filterPillActive)}
            onClick={() => setDecisionsOnly((v) => !v)}
            aria-pressed={decisionsOnly}
          >
            {t("Sadece Kararlar & Önemli Anlar", "Only decisions & key moments", "仅显示决定与关键时刻")}
          </button>
          <span className={styles.filterCount}>
            {filteredEvents.length}/{visibleEvents.length} {t("olay", "events", "个事件")}
          </span>
        </div>
      </div>

      <ol className={styles.transcript} ref={transcriptRef} aria-label={t("Konuşma akışı", "Conversation timeline", "对话时间线")}>
        {filteredEvents.length === 0 ? (
          <li className={styles.emptyFiltered}>{t("Seçilen filtrelere uygun konuşma olayı bulunamadı.", "No conversation events match these filters.", "没有符合所选条件的对话事件。")}</li>
        ) : (
          filteredEvents.map(({ event, position }) => {
            const seat = seatOf(event.actorId);
            const target = seatOf(event.targetId);
            return (
              <li key={event.seq} data-current={position === currentSpoken}
                className={cx(styles.line, position === currentSpoken && styles.lineCurrent, position > index && styles.lineFuture)}>
                <button type="button" onClick={() => jump(position)}>
                  <span className={styles.lineDot} style={{ background: seat?.color ?? "var(--text-faint)" }} />
                  <span className={styles.lineWho}>{seat?.label ?? t("Masa", "Table", "讨论桌")}{target ? ` → ${target.label}` : ""}</span>
                  <span className={styles.lineKind}>{eventLabel(event.kind)}{event.dimension ? ` · ${equipmentLabel(event.dimension)}` : ""}</span>
                  <span className={styles.lineText}>{event.text}</span>
                </button>
              </li>
            );
          })
        )}
      </ol>
      <p className={styles.note}>
        {t("Karakterlerin hareketleri çalışma akışına göre otomatik seçilir. ", "Character movements are selected automatically from the work flow. ", "角色动作根据工作流程自动选择。")}
        {t("Baloncuklar modellerin masada paylaştığı önerilerden, eleştirilerden ve kararlardan alıntıdır; modellerin gizli iç düşünce izi kaydedilmez.", "Bubbles quote the models’ shared proposals, critiques and decisions. Private model reasoning is not recorded.", "气泡引用模型公开分享的提案、评审和决定，不记录模型的私有思考过程。")}
        {fight ? t(" Silahlar jürinin altı ölçütteki puanlarını, can barı ise o turdaki jüri ortalamasını gösterir.", " Equipment represents scores on six criteria; the bar shows that round’s jury average.", " 装备代表六项评审标准的得分；状态条显示该轮评审平均分。") : ""}
      </p>
    </section>
  );
}

function captionFor(event: CouncilEvent | undefined, mode: CouncilMode, seatOf: (id: string | null | undefined) => Seat | undefined, t: Translate, equipmentLabel: (dimension: CouncilDimension) => string): string | null {
  if (!event) return null;
  const who = seatOf(event.actorId)?.label ?? modelLabel(event.model);
  switch (event.kind) {
    case "memory": return event.text;
    case "replace": return event.text;
    case "weapon": return event.dimension ? t(`Silah kazandı: ${equipmentLabel(event.dimension)} → ${who}`, `Equipment earned: ${equipmentLabel(event.dimension)} → ${who}`, `获得装备：${equipmentLabel(event.dimension)} → ${who}`) : null;
    case "eliminated": return t(`${who} elendi ve jüri sırasına geçti`, `${who} was eliminated and joined the jury`, `${who} 被淘汰并加入评审团`);
    case "winner": return mode === "competition" ? t(`Kazanan: ${who}`, `Winner: ${who}`, `胜出者：${who}`) : t(`Masa uzlaştı · ortak metni yazan: ${who}`, `The table reached consensus · shared draft author: ${who}`, `讨论桌达成共识 · 共同草稿执笔者：${who}`);
    case "finalist": return t(`Uzlaşma sağlanmadı · son denetime seçilen: ${who}`, `No consensus · selected for final review: ${who}`, `未达成共识 · 选入最终审查：${who}`);
    case "draft": return t(`${who} ortak metni ${mode === "collaboration" ? "masaya koydu" : "yazdı"}`, `${who} ${mode === "collaboration" ? "presented" : "wrote"} the shared draft`, `${who} ${mode === "collaboration" ? "提交了" : "写出了"}共同草稿`);
    default: return null;
  }
}

/** Localize scene-generated captions while leaving recorded model excerpts intact. */
const CARD_LABELS: Record<string, [string, string]> = {
  Elendi: ["Eliminated", "淘汰"], Ayrıldı: ["Left the table", "已离开"],
  Kazanan: ["Winner", "胜出者"], Uzlaşma: ["Consensus", "共识"],
  "Son denetime seçildi": ["Selected for final review", "选入最终审查"],
  "Yeni silah": ["New equipment", "新装备"], Kapışma: ["Competition", "竞赛"], Masa: ["Table", "讨论桌"],
};

function localizedCardLabel(label: string, t: Translate): string {
  const localized = CARD_LABELS[label];
  return localized ? t(label, ...localized) : label;
}

const EQUIPMENT_NAMES: Record<string, [string, string]> = {
  Kılıç: ["Sword", "剑"], Yay: ["Bow", "弓"], Kalkan: ["Shield", "盾"],
  Çekiç: ["Hammer", "锤"], Mızrak: ["Spear", "矛"], Asa: ["Staff", "杖"],
};

function localizedCardTitle(card: TitleCard, t: Translate): string {
  if (card.tone === "round") {
    const round = card.key.slice("round-".length);
    return t(card.title, `ROUND ${round}`, `第 ${round} 轮`);
  }
  const localized = card.tone === "weapon" ? EQUIPMENT_NAMES[card.title] : undefined;
  return localized ? t(card.title, ...localized) : card.title;
}

const WEATHER_NAMES: Record<WeatherKind, [string, string]> = {
  sunny: ["Sunny", "晴天"], cloudy: ["Cloudy", "多云"], rainy: ["Rainy", "雨天"],
  storm: ["Storm", "风暴"], heat: ["Extreme heat", "高温"],
};
function localizedWeatherLabel(kind: WeatherKind, t: Translate): string {
  return t(WEATHER_LABELS[kind], ...WEATHER_NAMES[kind]);
}

const WEATHER_REASONS: Record<string, [string, string]> = {
  "Modeller yerini alıyor": ["Models are taking their seats", "模型正在就位"],
  "Sonuç belli oldu": ["The result has been decided", "结果已确定"], Eleme: ["Elimination", "淘汰"],
  "Sistem zorlanıyor: yanıtsız çağrılar ve yedek geçişleri": ["System strain: unanswered calls and reserve replacements", "系统负载过高：调用未获响应与替补切换"],
  "İtirazlar arttı": ["More objections", "异议增加"], "Düşük puanlar": ["Low scores", "得分较低"],
  "Onaylar geliyor": ["Approvals are coming in", "收到认可"], "Puanlar yüksek": ["High scores", "得分较高"],
  "İnceleme sürüyor": ["Research is in progress", "研究进行中"], "Son denetim": ["Final review", "最终审查"],
  "Tartışma sürüyor": ["Discussion is in progress", "讨论进行中"],
};
function localizedWeatherReason(reason: string, t: Translate): string {
  const localized = WEATHER_REASONS[reason];
  return localized ? t(reason, ...localized) : reason;
}
