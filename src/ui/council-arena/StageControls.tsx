"use client";

import { useEffect, useState } from "react";
import { GESTURES, GESTURE_CATEGORIES, GESTURE_COMMANDS, resolveGestureCommand, type GestureId } from "./gesture-library";
import type { Seat } from "./timeline";
import styles from "./StageControls.module.css";

const CATEGORY_LABELS = { greeting: "Selamlama", thinking: "Düşünme jestleri", presenting: "Anlatım", reaction: "Tepkiler", resting: "Dinlenme" };

export function StageControls({ seats, ready, onMotion }: { seats: Seat[]; ready: boolean; onMotion: (seatId: string, gesture: GestureId) => boolean }) {
  const [seatId, setSeatId] = useState(seats[0]?.id ?? "");
  const [gesture, setGesture] = useState<GestureId>("wave-small");
  const [command, setCommand] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (!seats.some((seat) => seat.id === seatId)) setSeatId(seats[0]?.id ?? ""); }, [seats, seatId]);
  const send = (id: GestureId) => {
    if (!ready || !seatId) return;
    const accepted = onMotion(seatId, id);
    const name = GESTURES.find((entry) => entry.id === id)?.label;
    setMessage(accepted ? `${seats.find((seat) => seat.id === seatId)?.label}: ${name}. Hareketi izlemek için tekrar duraklatıldı.` : "Sahne henüz komut alamıyor. Hazırlanmasını bekleyip yeniden dene.");
  };
  return (
    <details className={styles.root}>
      <summary>Sahneye katıl<span>{GESTURES.length} hareket · karakteri sen seç</span></summary>
      <p>Bir modeli selamlatabilir, anlatımını veya duruşunu değiştirebilirsin. Hareket seçerken izleme duraklar; canlı AI çalışması sürer. Promptu değiştirmek için görev talimatlarını veya aşağıdaki geri bildirimi kullan.</p>
      <div className={styles.row}>
        <label>Karakter<select aria-label="Karakter" value={seatId} disabled={!ready || !seats.length} onChange={(event) => { setSeatId(event.target.value); setMessage(""); }}>{seats.map((seat) => <option value={seat.id} key={seat.id}>{seat.label}</option>)}</select></label>
        <label>Hareket<select aria-label="Hareket" value={gesture} disabled={!ready} onChange={(event) => setGesture(event.target.value as GestureId)}>{GESTURE_CATEGORIES.map((category) => <optgroup label={CATEGORY_LABELS[category]} key={category}>{GESTURES.filter((entry) => entry.category === category).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>)}</select></label>
        <button type="button" className="btn" disabled={!ready || !seatId} onClick={() => send(gesture)}>Hareketi göster</button>
      </div>
      <div className={styles.quick}>{GESTURE_COMMANDS.slice(0, 6).map((entry) => <button type="button" className="btn" key={entry.id} disabled={!ready || !seatId} onClick={() => send(entry.id)}>{entry.label}</button>)}</div>
      <form className={styles.row} onSubmit={(event) => { event.preventDefault(); const id = resolveGestureCommand(command); if (id) send(id); else setMessage("Bu hareketi tanımadım. Örneğin ‘selam ver’, ‘anlat’, ‘gerin’ yazabilir veya listeden seçebilirsin."); }}>
        <label className={styles.command}>Kısa hareket isteğin<input value={command} maxLength={120} placeholder="Örn. selam ver" onChange={(event) => setCommand(event.target.value)} disabled={!ready || !seatId} /></label>
        <button type="submit" className="btn" disabled={!ready || !seatId || !command.trim()}>Sahneye ilet</button>
      </form>
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </details>
  );
}
