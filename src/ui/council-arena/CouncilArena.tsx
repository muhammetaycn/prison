"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { COUNCIL_DIMENSIONS, COUNCIL_WEAPONS, type CouncilEvent } from "@/models/council";
import { councilEventIndexAtSeq, councilEventSeqAtIndex, isNextCouncilEvent, nextCouncilEventSeq } from "@/models/council-events";
import type { CouncilMode } from "@/models/options";
import { cx } from "@/ui/lib/format";
import type { Anchor, ArenaScene } from "./scene";
import { kindLabel, modelLabel, seatsFrom, stateAt, weaponName, type Seat } from "./timeline";
import { WEATHER_LABELS, weatherAt } from "./weather";
import { titleCardFor, type TitleCard } from "./cards";
import { ArenaSound } from "./sound";
import { SpeechQuote } from "./SpeechQuote";
import { StageControls } from "./StageControls";
import { getGesture } from "./gesture-library";
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
  const [viewerGesture, setViewerGesture] = useState<{ seatId: string; label: string; seq: number } | null>(null);

  const fight = mode === "competition";
  const index = councilEventIndexAtSeq(events, cursorSeq);
  const seats = useMemo(() => seatsFrom(events), [events]);
  const seatKey = seats.map((seat) => `${seat.id}:${seat.model}`).join("|");
  const state = useMemo(() => stateAt(events, index), [events, index]);
  // The weather follows what really happens at the table; it never changes a score.
  const weather = useMemo(() => weatherAt(events, index, state), [events, index, state]);
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
            label: curRound === 0 ? "Hazırlık" : `${curRound}. Tur`,
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
        label: curRound === 0 ? "Hazırlık" : `${curRound}. Tur`,
        startIndex: startIdx,
        endIndex: events.length - 1,
        count: events.length - startIdx,
      });
    }
    return segments;
  }, [events]);

  const milestones = useMemo(() => {
    const list: MilestoneMarker[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      let icon = "";
      let title = "";
      if (e.kind === "winner") {
        icon = fight ? "K" : "U";
        title = fight ? "Final Kararı" : "Uzlaşma Kararı";
      } else if (e.kind === "finalist") {
        icon = "D";
        title = "Son denetime seçilen aday";
      } else if (e.kind === "eliminated") {
        icon = "E";
        title = "Eleme";
      } else if (e.kind === "weapon") {
        icon = "S";
        title = e.dimension ? weaponName(e.dimension) : "Silah";
      } else if (e.kind === "draft") {
        icon = "T";
        title = "Ortak taslak";
      } else if (e.kind === "research") {
        icon = "İ";
        title = fight ? "Keşif" : "İnceleme";
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
  }, [events, fight, seats]);

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
  const caption = captionFor(current, mode, seatOf);
  const viewerCaption = !playing && viewerGesture?.seq === cursorSeq
    ? `Senin hareket isteğin · ${seatOf(viewerGesture.seatId)?.label ?? "Karakter"} · ${viewerGesture.label}` : null;
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
    setViewerGesture(null);
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
    <section className={cx(styles.root, fight ? styles.fight : styles.table)} aria-label={fight ? "Kapışma arenası" : "Tartışma masası"}>
      <div className={styles.head}>
        <div>
          <span className="label">{live ? "Canlı" : "Tekrar"} · {fight ? "Kapışma arenası" : "Tartışma masası"}</span>
          <h3>{fight ? "Yeşil saha: silahlar, saldırılar ve eleme" : "Karanlık oda: oylamasız ortak çalışma"}</h3>
        </div>
        <span className={styles.round}>{state.round > 0 ? `${state.round}. tur` : "Hazırlık"}</span>
      </div>

      <div className={styles.stage}>
        <div ref={hostRef} className={styles.canvas} />
        {!ready && !fallback ? <div className={styles.loading}><span className="spinner" aria-hidden /> Sahne hazırlanıyor…</div> : null}
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
                    <strong>{kindLabel(bubble.kind, mode)}{bubble.targetId && seatOf(bubble.targetId) ? ` → ${seatOf(bubble.targetId)!.label}` : ""}</strong>
                    <span>{bubble.kind === "weapon" && bubble.dimension ? weaponName(bubble.dimension) : bubble.text}</span>
                  </div>
                ) : thinking ? (
                  <div className={cx(styles.bubble, styles.thought)}>
                    <span className={styles.dots} aria-hidden><i /><i /><i /></span>
                    <span>{thinkingText.get(seat.id) ?? "Düşünüyor"}</span>
                  </div>
                ) : null}
                <div className={cx(styles.chip, speaking && styles.speaking, thinking && styles.thinking, eliminated && styles.out, state.winner === seat.id && styles.winner)}>
                  <span className={styles.dot} />
                  <span className={styles.name} title={seat.model}>{seat.label}</span>
                  {eliminated ? <span className={styles.tag}>{fight ? "jüri" : "ayrıldı"}</span> : null}
                  {state.winner === seat.id ? <span className={styles.tag}>{fight ? "kazanan" : "yazıcı"}</span> : null}
                  {state.finalist === seat.id ? <span className={styles.tag}>son denetim adayı</span> : null}
                </div>
                {fight && health !== undefined && !eliminated ? (
                  <div className={styles.kit}>
                    {health !== undefined && !eliminated ? (
                      <span className={cx(styles.health, weather.kind === "heat" && styles.healthHeat)} title={`Jüri ortalaması ${Math.round(health * 100)}/100`}>
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
            <span>{card.label}</span>
            <strong>{card.title}</strong>
          </div>
        ) : null}
        {ready && events.length ? (
          <div className={cx(styles.weather, styles[`weather_${weather.kind}`])} title={`${WEATHER_LABELS[weather.kind]} · ${weather.reason}`} aria-label={`Hava: ${WEATHER_LABELS[weather.kind]}, ${weather.reason}`}>
            <span className={styles.weatherIcon} aria-hidden />
            <strong>{WEATHER_LABELS[weather.kind]}</strong>
            <span>{weather.reason}</span>
          </div>
        ) : null}
        {viewerCaption || caption ? <div className={styles.caption} aria-live={live && !viewerCaption ? "polite" : "off"}>{viewerCaption ?? caption}</div> : null}
        {seats.length === 0 ? <div className={styles.empty}>Modeller {fight ? "sahaya" : "masaya"} geliyor…</div> : null}
      </div>

      {quote ? (
        <section className={cx(styles.speechDeck, styles[`enter_${entranceFor(quote)}`])} aria-label="Bu anın kaydedilen açıklaması"
          style={{ "--seat": seatOf(quote.actorId)?.color ?? "#f2c14e" } as CSSProperties}>
          <div className={styles.speechMeta}>
            <strong title={seatOf(quote.actorId)?.model ?? undefined}>{seatOf(quote.actorId)?.label ?? "Masa"}</strong>
            <span>{kindLabel(quote.kind, mode)}{quote.targetId && seatOf(quote.targetId) ? ` → ${seatOf(quote.targetId)!.label}` : ""}</span>
            <small>Kaydedilen açıklama</small>
          </div>
          <SpeechQuote key={quote.seq} text={quote.kind === "weapon" && quote.dimension ? weaponName(quote.dimension) : quote.text} animate={playing && current?.kind !== "thinking"} speed={effectiveSpeed} />
          {quote.kind === "critique" && quote.score !== null ? <span className={styles.reviewScore}>Bu değerlendirme: {juryScoreText(quote.score)}</span> : null}
        </section>
      ) : null}

      {/* Interactive Round Timeline Scrubber */}
      {events.length > 0 ? (
        <div className={styles.timelineBar} role="region" aria-label="Tur çizelgesi ve ilerleme">
          <div className={styles.timelineRounds}>
            {roundSegments.map((segment) => {
              const isCurrentRound = state.round === segment.round;
              return (
                <button
                  key={segment.round}
                  type="button"
                  className={cx(styles.timelineRoundBtn, isCurrentRound && styles.timelineRoundActive)}
                  onClick={() => jump(segment.startIndex)}
                  title={`${segment.label} (${segment.count} olay) — bu tura atla`}
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
            title="İstediğin ana atlamak için çizelgeye tıkla"
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
            aria-label="İzleme anını seç" aria-valuetext={index < 0 ? "Başlangıç" : `${index + 1}/${events.length} · ${kindLabel(events[index].kind, mode)}`}
            onChange={(event) => jump(Number(event.target.value))} />
        </div>
      ) : null}

      <div className={styles.controls}>
        <button type="button" className="btn" onClick={restart} disabled={!events.length}>Baştan izle</button>
        {!live ? <button type="button" className="btn" onClick={() => jump(events.length - 1)} disabled={index >= events.length - 1}>Sonuca atla</button> : null}
        <button type="button" className="btn" onClick={() => jump(previousSpoken(events, index))} disabled={index <= 0} aria-label="Önceki adım">◀</button>
        <button type="button" className="btn" onClick={() => { setViewerGesture(null); if (index >= events.length - 1 && !live) { restart(); return; } setPlaying((value) => !value); }} disabled={!events.length}>
          {playing ? "Duraklat" : "Oynat"}
        </button>
        <button type="button" className="btn" onClick={() => jump(nextSpoken(events, index))} disabled={index >= events.length - 1} aria-label="Sonraki adım">▶</button>
        <button type="button" className={cx("btn", soundOn && styles.soundOn)} onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? "Ses açık" : "Ses kapalı"}
        </button>
        <div className={styles.speeds} role="group" aria-label="Oynatma hızı">
          {SPEEDS.map((value) => (
            <button key={value} type="button" className={cx(styles.speed, speed === value && styles.speedOn)} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}x</button>
          ))}
        </div>
        <button type="button" className={cx("btn", readingTempo && styles.readingOn)} aria-pressed={readingTempo} onClick={() => setReadingTempo((value) => !value)} title="Uzun açıklamalara daha fazla okuma süresi ayır">Okuma temposu</button>
        {live && !following ? <button type="button" className="btn" onClick={() => { setViewerGesture(null); setFollowing(true); setPlaying(true); }}>Canlıya dön</button> : null}
        <span className={styles.legend}><span className={styles.legendDot} /> yeşil: konuşan · yanıp sönen: düşünen</span>
      </div>

      <StageControls seats={seats} ready={ready} onMotion={(seatId, gesture) => {
        const scene = sceneRef.current;
        if (!scene?.playGesture) return false;
        clearTransient();
        setPlaying(false); setFollowing(false);
        // Pause this visual moment and clear its action before a deliberate viewer gesture.
        // The backend job and its real event ledger continue independently.
        sceneKeyRef.current = sceneUpdateKey(state, current ?? null, seatKey);
        shownRef.current = current?.seq ?? -1;
        scene.setSpeed(speed);
        scene.sync(state, current ?? null, false);
        scene.setWeather(weather, false);
        hostRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
        const accepted = scene.playGesture(seatId, gesture);
        if (accepted) setViewerGesture({ seatId, label: getGesture(gesture)?.label ?? gesture, seq: cursorSeq });
        return accepted;
      }} />
      <PromptJourney stage={live ? "working" : promptReady ? "ready" : "review"} councilEvidence={events.some((event) => event.kind === "critique" || event.kind === "approval" || event.kind === "objection")} compact />
      {fight ? <details className={styles.equipmentGuide}>
        <summary>Ekipmanlar promptun hangi gücünü gösteriyor?</summary>
        <p>Silahlar karakterlerin kanadında veya sırtında taşınır. Her biri jürinin değerlendirdiği bir ölçütü temsil eder; bu andaki sahipleri aşağıda.</p>
        <dl>{COUNCIL_DIMENSIONS.map((dimension) => <div key={dimension}><dt>{COUNCIL_WEAPONS[dimension].name} · {COUNCIL_WEAPONS[dimension].meaning}</dt><dd>{seatOf(state.weapons[dimension])?.label ?? "Henüz verilmedi"}</dd></div>)}</dl>
      </details> : null}

      {/* Transcript Filter Controls */}
      <div className={styles.transcriptControls} role="region" aria-label="Konuşma dökümü filtreleri">
        <div className={styles.actorFilters} role="group" aria-label="Konuşmacıya göre filtrele">
          <span className={styles.filterTitle}>Konuşmacı:</span>
          <button
            type="button"
            className={cx(styles.filterPill, actorFilter === null && styles.filterPillActive)}
            aria-pressed={actorFilter === null}
            onClick={() => setActorFilter(null)}
          >
            Tümü
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
            Sadece Kararlar & Önemli Anlar
          </button>
          <span className={styles.filterCount}>
            {filteredEvents.length}/{visibleEvents.length} olay
          </span>
        </div>
      </div>

      <ol className={styles.transcript} ref={transcriptRef} aria-label="Konuşma akışı">
        {filteredEvents.length === 0 ? (
          <li className={styles.emptyFiltered}>Seçilen filtrelere uygun konuşma olayı bulunamadı.</li>
        ) : (
          filteredEvents.map(({ event, position }) => {
            const seat = seatOf(event.actorId);
            const target = seatOf(event.targetId);
            return (
              <li key={event.seq} data-current={position === currentSpoken}
                className={cx(styles.line, position === currentSpoken && styles.lineCurrent, position > index && styles.lineFuture)}>
                <button type="button" onClick={() => jump(position)}>
                  <span className={styles.lineDot} style={{ background: seat?.color ?? "var(--text-faint)" }} />
                  <span className={styles.lineWho}>{seat?.label ?? "Masa"}{target ? ` → ${target.label}` : ""}</span>
                  <span className={styles.lineKind}>{kindLabel(event.kind, mode)}{event.dimension ? ` · ${weaponName(event.dimension)}` : ""}</span>
                  <span className={styles.lineText}>{event.text}</span>
                </button>
              </li>
            );
          })
        )}
      </ol>
      <p className={styles.note}>
        Baloncuklar modellerin masada paylaştığı önerilerden, eleştirilerden ve kararlardan alıntıdır; modellerin gizli iç düşünce izi kaydedilmez.
        {fight ? " Silahlar jürinin altı ölçütteki puanlarını, can barı ise o turdaki jüri ortalamasını gösterir." : ""}
      </p>
    </section>
  );
}

function captionFor(event: CouncilEvent | undefined, mode: CouncilMode, seatOf: (id: string | null | undefined) => Seat | undefined): string | null {
  if (!event) return null;
  const who = seatOf(event.actorId)?.label ?? modelLabel(event.model);
  switch (event.kind) {
    case "memory": return event.text;
    case "replace": return event.text;
    case "weapon": return event.dimension ? `Silah kazandı: ${weaponName(event.dimension)} → ${who}` : null;
    case "eliminated": return `${who} elendi ve jüri sırasına geçti`;
    case "winner": return mode === "competition" ? `Kazanan: ${who}` : `Masa uzlaştı · ortak metni yazan: ${who}`;
    case "finalist": return `Uzlaşma sağlanmadı · son denetime seçilen: ${who}`;
    case "draft": return `${who} ortak metni ${mode === "collaboration" ? "masaya koydu" : "yazdı"}`;
    default: return null;
  }
}
