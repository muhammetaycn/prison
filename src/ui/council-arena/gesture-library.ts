/**
 * Small local gestures for Pırpır's existing shoulder, hip, head and tail pivots.
 * They are presentation only: no clip moves a seat across the arena or changes
 * a model's answer, vote, equipment, score or council event.
 */
export const GESTURE_CATEGORIES = ["greeting", "thinking", "presenting", "reaction", "resting"] as const;
export type GestureCategory = (typeof GESTURE_CATEGORIES)[number];

/** Additive local rotations (radians), except lift (arena units). */
export interface GesturePose {
  lift: number;
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  leftWingPitch: number;
  leftWingRoll: number;
  leftWingYaw: number;
  rightWingPitch: number;
  rightWingRoll: number;
  rightWingYaw: number;
  leftLegPitch: number;
  rightLegPitch: number;
  tailPitch: number;
  tailRoll: number;
}

export const POSE_LIMITS: Readonly<Record<keyof GesturePose, readonly [number, number]>> = Object.freeze({
  lift: [-0.06, 0.2],
  bodyPitch: [-0.32, 0.32], bodyRoll: [-0.22, 0.22], bodyYaw: [-0.3, 0.3],
  headPitch: [-0.5, 0.5], headYaw: [-0.7, 0.7], headRoll: [-0.3, 0.3],
  leftWingPitch: [-1.5, 0.5], leftWingRoll: [-1, 0.35], leftWingYaw: [-0.45, 0.45],
  rightWingPitch: [-1.5, 0.5], rightWingRoll: [-0.35, 1], rightWingYaw: [-0.45, 0.45],
  leftLegPitch: [-0.4, 0.4], rightLegPitch: [-0.4, 0.4],
  tailPitch: [-0.35, 0.35], tailRoll: [-0.3, 0.3],
});

export const NEUTRAL_GESTURE_POSE: Readonly<GesturePose> = Object.freeze({
  lift: 0, bodyPitch: 0, bodyRoll: 0, bodyYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0,
  leftWingPitch: 0, leftWingRoll: 0, leftWingYaw: 0, rightWingPitch: 0, rightWingRoll: 0,
  rightWingYaw: 0, leftLegPitch: 0, rightLegPitch: 0, tailPitch: 0, tailRoll: 0,
});

export interface GestureKeyframe {
  /** Normalized clip time, including neutral endpoints at zero and one. */
  readonly at: number;
  readonly pose: Readonly<GesturePose>;
}

export interface GestureDefinition<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly category: GestureCategory;
  readonly duration: number;
  readonly keyframes: readonly GestureKeyframe[];
}

type Frame = readonly [number, Partial<GesturePose>];

function clip<const Id extends string>(id: Id, label: string, category: GestureCategory, duration: number, frames: readonly Frame[]): GestureDefinition<Id> {
  const keyframes = [
    { at: 0, pose: NEUTRAL_GESTURE_POSE },
    ...frames.map(([at, pose]) => Object.freeze({ at, pose: Object.freeze({ ...NEUTRAL_GESTURE_POSE, ...pose }) })),
    { at: 1, pose: NEUTRAL_GESTURE_POSE },
  ].map((frame) => Object.freeze(frame));
  return Object.freeze({ id, label, category, duration, keyframes: Object.freeze(keyframes) });
}

/** Each clip has its own staged action, joint combination and timing. */
export const GESTURES = Object.freeze([
  clip("wave-small", "Küçük selam", "greeting", 1.7, [
    [0.18, { rightWingPitch: -0.75, rightWingRoll: 0.55, headRoll: -0.06 }],
    [0.38, { rightWingPitch: -0.85, rightWingRoll: 0.78, rightWingYaw: -0.18 }],
    [0.56, { rightWingPitch: -0.85, rightWingRoll: 0.5, rightWingYaw: 0.2 }],
    [0.74, { rightWingPitch: -0.7, rightWingRoll: 0.72, rightWingYaw: -0.15 }],
  ]),
  clip("wave-high", "Yüksek selam", "greeting", 2.1, [
    [0.2, { rightWingPitch: -1.3, rightWingRoll: 0.62, bodyRoll: -0.08, lift: 0.04 }],
    [0.42, { rightWingPitch: -1.4, rightWingRoll: 0.92, tailRoll: 0.1 }],
    [0.63, { rightWingPitch: -1.25, rightWingRoll: 0.58, bodyRoll: 0.06 }],
    [0.8, { rightWingPitch: -1.05, rightWingRoll: 0.82, headPitch: -0.08 }],
  ]),
  clip("wave-two-wings", "İki kanatla selam", "greeting", 2.3, [
    [0.2, { leftWingPitch: -0.9, leftWingRoll: -0.72, rightWingPitch: -0.9, rightWingRoll: 0.72 }],
    [0.4, { leftWingPitch: -1.25, leftWingRoll: -0.6, rightWingPitch: -0.8, rightWingRoll: 0.9, headRoll: 0.12 }],
    [0.63, { leftWingPitch: -0.8, leftWingRoll: -0.9, rightWingPitch: -1.25, rightWingRoll: 0.6, headRoll: -0.12 }],
    [0.8, { leftWingPitch: -0.6, leftWingRoll: -0.55, rightWingPitch: -0.6, rightWingRoll: 0.55 }],
  ]),
  clip("wing-salute", "Kanat selamı", "greeting", 1.6, [
    [0.24, { rightWingPitch: -1.35, rightWingRoll: -0.18, rightWingYaw: -0.3, headPitch: -0.08 }],
    [0.54, { rightWingPitch: -1.35, rightWingRoll: -0.18, rightWingYaw: -0.3, bodyPitch: -0.05 }],
    [0.76, { rightWingPitch: -0.85, rightWingRoll: 0.6, rightWingYaw: 0.1 }],
  ]),
  clip("welcome-open", "Karşılama", "greeting", 2.2, [
    [0.22, { leftWingPitch: -0.3, rightWingPitch: -0.3, headPitch: 0.12 }],
    [0.46, { leftWingRoll: -0.84, rightWingRoll: 0.84, leftWingPitch: -0.42, rightWingPitch: -0.42, bodyPitch: -0.12 }],
    [0.75, { leftWingRoll: -0.7, rightWingRoll: 0.7, headPitch: 0.1, tailPitch: 0.12 }],
  ]),
  clip("bow-greeting", "Eğilerek selam", "greeting", 2, [
    [0.28, { bodyPitch: 0.25, headPitch: 0.2, leftWingYaw: 0.15, rightWingYaw: -0.15, tailPitch: -0.12 }],
    [0.55, { bodyPitch: 0.3, headPitch: 0.3, leftWingPitch: 0.12, rightWingPitch: 0.12 }],
    [0.78, { bodyPitch: 0.08, headPitch: -0.08, tailPitch: 0.08 }],
  ]),
  clip("head-greeting", "Başla selam", "greeting", 1.3, [
    [0.24, { headPitch: 0.3, bodyPitch: 0.06 }],
    [0.5, { headPitch: -0.12, bodyPitch: -0.04 }],
    [0.73, { headPitch: 0.09, tailRoll: 0.05 }],
  ]),
  clip("tip-head", "Başını yana eğerek selam", "greeting", 1.8, [
    [0.25, { headRoll: -0.24, headYaw: 0.12, rightWingPitch: -0.32 }],
    [0.5, { headRoll: -0.24, headPitch: 0.18, rightWingRoll: 0.2 }],
    [0.75, { headRoll: -0.06, headPitch: -0.08 }],
  ]),
  clip("side-wave", "Yandan selam", "greeting", 2.1, [
    [0.22, { bodyYaw: 0.22, headYaw: 0.2, leftWingRoll: -0.65, leftWingPitch: -0.5 }],
    [0.45, { bodyYaw: 0.22, headYaw: 0.28, leftWingRoll: -0.9, leftWingYaw: 0.25 }],
    [0.66, { bodyYaw: 0.18, headYaw: 0.15, leftWingRoll: -0.6, leftWingYaw: -0.2 }],
    [0.82, { leftWingRoll: -0.75, leftWingPitch: -0.35 }],
  ]),
  clip("double-wave", "İki kısa selam", "greeting", 2.4, [
    [0.17, { rightWingPitch: -0.95, rightWingRoll: 0.7, headPitch: -0.1 }],
    [0.33, { rightWingPitch: -0.4, rightWingRoll: 0.24, headPitch: 0.1 }],
    [0.53, { leftWingPitch: -0.95, leftWingRoll: -0.7, headPitch: -0.1 }],
    [0.72, { leftWingPitch: -0.4, leftWingRoll: -0.24, headPitch: 0.1 }],
    [0.86, { rightWingRoll: 0.18, leftWingRoll: -0.18, tailPitch: 0.09 }],
  ]),

  clip("chin-tap", "Gagaya dokunup düşün", "thinking", 2.5, [
    [0.2, { rightWingPitch: -1.15, rightWingRoll: -0.23, headPitch: 0.08 }],
    [0.4, { rightWingPitch: -1.25, rightWingRoll: -0.2, headPitch: 0.13, headRoll: 0.12 }],
    [0.6, { rightWingPitch: -1.1, rightWingRoll: -0.27, headPitch: 0.05 }],
    [0.8, { rightWingPitch: -0.7, headYaw: 0.12 }],
  ]),
  clip("head-tilt", "Merakla düşün", "thinking", 2.6, [
    [0.23, { headRoll: 0.23, headPitch: -0.1, bodyRoll: 0.05 }],
    [0.52, { headRoll: 0.18, headYaw: -0.16, tailPitch: -0.07 }],
    [0.77, { headRoll: -0.12, headPitch: 0.08, bodyRoll: -0.03 }],
  ]),
  clip("scan-left-right", "Seçeneklere bak", "thinking", 3.1, [
    [0.2, { headYaw: -0.56, headPitch: 0.05, tailRoll: 0.08 }],
    [0.4, { headYaw: -0.35, headPitch: -0.08 }],
    [0.65, { headYaw: 0.6, headPitch: 0.04, tailRoll: -0.08 }],
    [0.84, { headYaw: 0.28, headPitch: 0.12 }],
  ]),
  clip("slow-nod", "Yavaşça tart", "thinking", 2.8, [
    [0.25, { headPitch: 0.26, bodyPitch: 0.06, rightWingPitch: -0.2 }],
    [0.5, { headPitch: 0.28, bodyPitch: 0.08, rightWingRoll: 0.09 }],
    [0.78, { headPitch: -0.12, bodyPitch: -0.03, tailPitch: 0.07 }],
  ]),
  clip("inspect-detail", "Ayrıntıyı incele", "thinking", 2.7, [
    [0.22, { bodyPitch: 0.16, headPitch: 0.3, headYaw: -0.18 }],
    [0.48, { bodyPitch: 0.21, headPitch: 0.24, headYaw: 0.22, leftWingPitch: -0.38 }],
    [0.7, { bodyPitch: 0.12, headPitch: 0.15, leftWingYaw: 0.24, leftWingRoll: -0.18 }],
    [0.86, { headPitch: -0.12 }],
  ]),
  clip("compare-sides", "İki fikri karşılaştır", "thinking", 3, [
    [0.2, { leftWingPitch: -0.6, leftWingRoll: -0.48, headYaw: -0.35, bodyRoll: -0.07 }],
    [0.42, { leftWingPitch: -0.25, leftWingRoll: -0.2, rightWingPitch: -0.65, rightWingRoll: 0.48, headYaw: 0.35, bodyRoll: 0.07 }],
    [0.65, { leftWingPitch: -0.55, leftWingRoll: -0.45, rightWingPitch: -0.55, rightWingRoll: 0.45, headPitch: 0.1 }],
    [0.83, { headPitch: -0.14, tailPitch: 0.1 }],
  ]),
  clip("wing-count", "Kanatla say", "thinking", 2.8, [
    [0.16, { rightWingPitch: -0.8, rightWingRoll: 0.3, headPitch: 0.16, headYaw: 0.16 }],
    [0.34, { rightWingPitch: -0.65, rightWingRoll: 0.5, headPitch: 0.1 }],
    [0.52, { rightWingPitch: -0.95, rightWingRoll: 0.35, leftWingPitch: -0.5, leftWingRoll: -0.22 }],
    [0.7, { rightWingPitch: -0.7, rightWingRoll: 0.65, leftWingPitch: -0.65, headPitch: -0.12 }],
    [0.86, { headYaw: -0.1 }],
  ]),
  clip("tail-thought", "Kuyrukla düşünme ritmi", "thinking", 3.2, [
    [0.18, { tailRoll: -0.22, tailPitch: -0.08, headRoll: 0.1 }],
    [0.37, { tailRoll: 0.2, tailPitch: 0.12, headPitch: 0.1 }],
    [0.56, { tailRoll: -0.16, tailPitch: -0.05, headRoll: -0.1 }],
    [0.77, { tailRoll: 0.13, tailPitch: 0.06, headPitch: -0.08 }],
  ]),
  clip("lean-listen", "Yaklaşıp dinle", "thinking", 2.9, [
    [0.23, { bodyPitch: 0.16, headYaw: -0.2, headRoll: -0.1, leftWingYaw: -0.1 }],
    [0.53, { bodyPitch: 0.19, headYaw: -0.28, headPitch: -0.08, tailPitch: -0.1 }],
    [0.8, { bodyPitch: 0.08, headPitch: 0.12 }],
  ]),
  clip("pause-reflect", "Durup yeniden düşün", "thinking", 3.4, [
    [0.2, { headPitch: 0.2, bodyPitch: 0.08, leftWingPitch: -0.2, rightWingPitch: -0.2 }],
    [0.55, { headPitch: 0.18, headRoll: 0.08, tailPitch: -0.15 }],
    [0.75, { headPitch: -0.22, bodyPitch: -0.07, rightWingRoll: 0.25 }],
    [0.88, { rightWingPitch: -0.35, headYaw: 0.1 }],
  ]),

  clip("present-left", "Soldaki fikri göster", "presenting", 2.1, [
    [0.23, { leftWingPitch: -0.8, leftWingRoll: -0.65, leftWingYaw: 0.3, headYaw: -0.3 }],
    [0.5, { leftWingPitch: -0.95, leftWingRoll: -0.72, bodyYaw: -0.12, headPitch: -0.08 }],
    [0.78, { leftWingPitch: -0.5, leftWingRoll: -0.35, headPitch: 0.1 }],
  ]),
  clip("present-right", "Sağdaki fikri göster", "presenting", 2.3, [
    [0.25, { rightWingPitch: -0.88, rightWingRoll: 0.6, rightWingYaw: -0.25, headYaw: 0.35 }],
    [0.54, { rightWingPitch: -1.1, rightWingRoll: 0.7, bodyYaw: 0.15, tailRoll: -0.08 }],
    [0.81, { rightWingPitch: -0.45, rightWingRoll: 0.4, headPitch: 0.1 }],
  ]),
  clip("present-both", "İki kanatla sun", "presenting", 2.5, [
    [0.2, { leftWingPitch: -0.6, leftWingRoll: -0.25, rightWingPitch: -0.6, rightWingRoll: 0.25 }],
    [0.46, { leftWingPitch: -0.9, leftWingRoll: -0.55, rightWingPitch: -0.9, rightWingRoll: 0.55, bodyPitch: -0.08, lift: 0.03 }],
    [0.76, { leftWingPitch: -0.7, leftWingRoll: -0.75, rightWingPitch: -0.7, rightWingRoll: 0.75, headPitch: 0.12 }],
  ]),
  clip("underline", "Önemli noktayı vurgula", "presenting", 1.9, [
    [0.18, { rightWingPitch: -1, rightWingRoll: 0.38, headPitch: -0.12 }],
    [0.42, { rightWingPitch: -0.6, rightWingRoll: 0.7, rightWingYaw: -0.32, headPitch: 0.18 }],
    [0.65, { rightWingPitch: -0.6, rightWingRoll: 0.28, rightWingYaw: 0.32, bodyPitch: 0.08 }],
    [0.82, { rightWingPitch: -0.35, headPitch: -0.06 }],
  ]),
  clip("enumerate-three", "Üç noktayı anlat", "presenting", 3.1, [
    [0.14, { rightWingPitch: -0.8, rightWingRoll: 0.24, headPitch: 0.12 }],
    [0.28, { rightWingPitch: -0.35, rightWingRoll: 0.2 }],
    [0.44, { rightWingPitch: -0.9, rightWingRoll: 0.48, headPitch: 0.1, bodyYaw: 0.07 }],
    [0.58, { rightWingPitch: -0.4, rightWingRoll: 0.24 }],
    [0.74, { rightWingPitch: -1, rightWingRoll: 0.7, headPitch: 0.1, bodyYaw: 0.13 }],
    [0.87, { rightWingPitch: -0.45, rightWingRoll: 0.3 }],
  ]),
  clip("frame-idea", "Fikre çerçeve çiz", "presenting", 2.8, [
    [0.2, { leftWingPitch: -1.1, leftWingRoll: -0.24, rightWingPitch: -1.1, rightWingRoll: 0.24, headPitch: 0.06 }],
    [0.45, { leftWingPitch: -1.2, leftWingRoll: -0.65, rightWingPitch: -1.2, rightWingRoll: 0.65, headPitch: -0.1 }],
    [0.7, { leftWingPitch: -0.55, leftWingRoll: -0.65, rightWingPitch: -0.55, rightWingRoll: 0.65, bodyPitch: 0.08 }],
    [0.87, { leftWingPitch: -0.4, rightWingPitch: -0.4, headPitch: 0.1 }],
  ]),
  clip("reveal", "Fikri açığa çıkar", "presenting", 2.4, [
    [0.22, { leftWingPitch: -0.7, leftWingRoll: 0.15, rightWingPitch: -0.7, rightWingRoll: -0.15, headPitch: 0.18 }],
    [0.5, { leftWingPitch: -0.6, leftWingRoll: -0.85, rightWingPitch: -0.6, rightWingRoll: 0.85, headPitch: -0.2, tailPitch: 0.18 }],
    [0.79, { leftWingPitch: -0.3, leftWingRoll: -0.6, rightWingPitch: -0.3, rightWingRoll: 0.6, bodyPitch: -0.1 }],
  ]),
  clip("invite-review", "İncelemeye davet et", "presenting", 2.6, [
    [0.2, { leftWingPitch: -0.8, leftWingRoll: -0.45, headYaw: -0.25 }],
    [0.44, { leftWingPitch: -0.95, leftWingRoll: -0.24, leftWingYaw: -0.2, headPitch: 0.1 }],
    [0.66, { leftWingPitch: -0.5, leftWingRoll: -0.65, leftWingYaw: 0.2, bodyYaw: -0.12 }],
    [0.83, { headYaw: 0.15, rightWingRoll: 0.15 }],
  ]),
  clip("guide-forward", "Sonraki adımı göster", "presenting", 2.2, [
    [0.22, { rightWingPitch: -0.55, rightWingYaw: 0.3, headPitch: 0.1 }],
    [0.47, { rightWingPitch: -1.1, rightWingRoll: 0.18, rightWingYaw: 0, bodyPitch: 0.1, headPitch: -0.05 }],
    [0.7, { rightWingPitch: -0.9, rightWingRoll: 0.45, rightWingYaw: -0.2, tailPitch: 0.1 }],
    [0.86, { bodyPitch: 0.04, headPitch: 0.12 }],
  ]),
  clip("summarize", "Fikirleri bir araya getir", "presenting", 3, [
    [0.18, { leftWingPitch: -0.6, leftWingRoll: -0.85, rightWingPitch: -0.6, rightWingRoll: 0.85, headYaw: -0.22 }],
    [0.4, { leftWingPitch: -0.75, leftWingRoll: -0.6, rightWingPitch: -0.75, rightWingRoll: 0.6, headYaw: 0.22 }],
    [0.68, { leftWingPitch: -0.85, leftWingRoll: 0.12, rightWingPitch: -0.85, rightWingRoll: -0.12, headPitch: 0.14 }],
    [0.84, { leftWingPitch: -0.5, rightWingPitch: -0.5, headPitch: -0.08 }],
  ]),

  clip("nod-once", "Kısa baş hareketi", "reaction", 1.1, [
    [0.2, { headPitch: -0.12 }],
    [0.48, { headPitch: 0.32, bodyPitch: 0.07, tailPitch: 0.08 }],
    [0.76, { headPitch: -0.06 }],
  ]),
  clip("nod-twice", "İki baş hareketi", "reaction", 1.8, [
    [0.2, { headPitch: 0.26, bodyPitch: 0.04 }],
    [0.36, { headPitch: -0.12 }],
    [0.58, { headPitch: 0.3, bodyPitch: 0.06, tailRoll: 0.09 }],
    [0.78, { headPitch: -0.1, tailRoll: -0.06 }],
  ]),
  clip("consider-again", "Başka açıdan değerlendir", "reaction", 2.1, [
    [0.2, { headYaw: -0.3, headRoll: 0.08, rightWingRoll: 0.2 }],
    [0.44, { headYaw: 0.32, headRoll: -0.08, rightWingPitch: -0.4 }],
    [0.68, { headYaw: -0.16, headPitch: 0.16, leftWingRoll: -0.2 }],
    [0.84, { headPitch: -0.12 }],
  ]),
  clip("curious-tilt", "Meraklı tepki", "reaction", 1.7, [
    [0.24, { headRoll: -0.28, headPitch: -0.16, bodyRoll: -0.07 }],
    [0.5, { headRoll: -0.22, headYaw: 0.25, leftWingRoll: -0.15 }],
    [0.76, { headRoll: 0.08, headPitch: 0.1 }],
  ]),
  clip("surprised-back", "Şaşkınlık", "reaction", 1.6, [
    [0.16, { bodyPitch: -0.24, headPitch: -0.25, leftWingRoll: -0.65, rightWingRoll: 0.65, tailPitch: 0.26 }],
    [0.38, { bodyPitch: -0.18, headPitch: -0.1, leftWingPitch: -0.4, rightWingPitch: -0.4 }],
    [0.68, { bodyPitch: 0.08, headPitch: 0.16, tailPitch: -0.1 }],
    [0.84, { headRoll: 0.1 }],
  ]),
  clip("pleased-bounce", "Küçük sevinç", "reaction", 1.8, [
    [0.15, { lift: -0.045, bodyPitch: 0.08, leftLegPitch: 0.12, rightLegPitch: 0.12 }],
    [0.34, { lift: 0.15, leftWingPitch: -0.5, leftWingRoll: -0.45, rightWingPitch: -0.5, rightWingRoll: 0.45, tailPitch: 0.18 }],
    [0.51, { lift: -0.025, bodyPitch: 0.1, headPitch: 0.08 }],
    [0.69, { lift: 0.07, leftWingRoll: -0.22, rightWingRoll: 0.22, tailRoll: 0.14 }],
    [0.84, { headPitch: -0.08 }],
  ]),
  clip("cautious-peek", "Dikkatle bak", "reaction", 2.3, [
    [0.23, { bodyRoll: -0.15, headYaw: -0.35, headRoll: 0.12, leftWingPitch: -0.35 }],
    [0.5, { bodyRoll: -0.16, headYaw: -0.48, headPitch: -0.15, tailRoll: 0.15 }],
    [0.78, { bodyRoll: 0.05, headYaw: 0.12, headPitch: 0.1 }],
  ]),
  clip("acknowledge-wing", "Duyduğunu belli et", "reaction", 1.9, [
    [0.22, { leftWingPitch: -0.9, leftWingRoll: -0.36, headPitch: 0.12 }],
    [0.5, { leftWingPitch: -1, leftWingRoll: -0.42, headPitch: -0.08, bodyPitch: -0.04 }],
    [0.76, { leftWingPitch: -0.45, leftWingRoll: -0.25, tailPitch: 0.1 }],
  ]),
  clip("encourage", "Destekleyici hareket", "reaction", 2.2, [
    [0.2, { rightWingPitch: -0.8, rightWingRoll: 0.4, bodyPitch: 0.1 }],
    [0.43, { rightWingPitch: -0.95, rightWingRoll: 0.3, headPitch: 0.15, tailRoll: 0.13 }],
    [0.66, { rightWingPitch: -0.7, rightWingRoll: 0.55, headPitch: -0.09, tailRoll: -0.1 }],
    [0.83, { bodyPitch: 0.05, rightWingRoll: 0.18 }],
  ]),
  clip("regroup", "Toparlan", "reaction", 2.4, [
    [0.2, { bodyPitch: 0.12, headPitch: 0.18, leftWingPitch: 0.15, rightWingPitch: 0.15, tailPitch: -0.14 }],
    [0.48, { bodyPitch: -0.08, headPitch: -0.16, leftWingRoll: -0.34, rightWingRoll: 0.34, tailPitch: 0.14 }],
    [0.75, { headPitch: 0.08, leftWingPitch: -0.2, rightWingPitch: -0.2 }],
  ]),

  clip("preen-left", "Sol tüyleri düzelt", "resting", 2.8, [
    [0.22, { headYaw: -0.6, headPitch: 0.22, leftWingPitch: -0.28, leftWingRoll: -0.2 }],
    [0.42, { headYaw: -0.62, headPitch: 0.36, leftWingPitch: -0.4 }],
    [0.61, { headYaw: -0.55, headPitch: 0.18, leftWingRoll: -0.3 }],
    [0.78, { headYaw: -0.35, headPitch: 0.31, leftWingPitch: -0.22 }],
  ]),
  clip("preen-right", "Sağ tüyleri düzelt", "resting", 3, [
    [0.2, { headYaw: 0.58, headPitch: 0.2, rightWingPitch: -0.32, rightWingRoll: 0.22 }],
    [0.4, { headYaw: 0.65, headPitch: 0.34, rightWingPitch: -0.4, tailRoll: -0.07 }],
    [0.57, { headYaw: 0.6, headPitch: 0.15, rightWingRoll: 0.3 }],
    [0.73, { headYaw: 0.5, headPitch: 0.3, rightWingPitch: -0.28 }],
    [0.87, { headYaw: 0.22, tailPitch: 0.08 }],
  ]),
  clip("stretch-up", "Yukarı gerin", "resting", 3.2, [
    [0.25, { leftWingPitch: -1.1, leftWingRoll: -0.6, rightWingPitch: -1.1, rightWingRoll: 0.6, headPitch: -0.2 }],
    [0.5, { leftWingPitch: -1.4, leftWingRoll: -0.55, rightWingPitch: -1.4, rightWingRoll: 0.55, bodyPitch: -0.14, lift: 0.06, tailPitch: 0.17 }],
    [0.75, { leftWingPitch: -0.7, leftWingRoll: -0.8, rightWingPitch: -0.7, rightWingRoll: 0.8, headPitch: 0.18 }],
    [0.9, { headPitch: 0.08, bodyPitch: 0.06 }],
  ]),
  clip("shoulder-roll", "Omuzları gevşet", "resting", 2.9, [
    [0.2, { leftWingPitch: -0.3, leftWingRoll: -0.3, leftWingYaw: 0.25, rightWingPitch: -0.3, rightWingRoll: 0.3, rightWingYaw: -0.25, headPitch: 0.12 }],
    [0.45, { leftWingPitch: 0.2, leftWingRoll: -0.2, leftWingYaw: -0.25, rightWingPitch: 0.2, rightWingRoll: 0.2, rightWingYaw: 0.25, bodyPitch: -0.1 }],
    [0.7, { leftWingPitch: -0.25, leftWingRoll: -0.15, rightWingPitch: -0.25, rightWingRoll: 0.15, headPitch: -0.08 }],
  ]),
  clip("foot-tap-left", "Sol ayak ritmi", "resting", 2.2, [
    [0.16, { leftLegPitch: -0.32, bodyRoll: -0.05 }],
    [0.31, { leftLegPitch: 0.08, headPitch: 0.07 }],
    [0.47, { leftLegPitch: -0.35, bodyRoll: -0.06, tailRoll: 0.06 }],
    [0.62, { leftLegPitch: 0.08 }],
    [0.77, { leftLegPitch: -0.22, headPitch: -0.05 }],
  ]),
  clip("foot-tap-right", "Sağ ayak ritmi", "resting", 2.4, [
    [0.18, { rightLegPitch: -0.25, bodyRoll: 0.06, tailRoll: -0.1 }],
    [0.34, { rightLegPitch: 0.1, headRoll: 0.08 }],
    [0.53, { rightLegPitch: -0.38, bodyRoll: 0.05, headPitch: 0.08 }],
    [0.7, { rightLegPitch: 0.06 }],
    [0.84, { rightLegPitch: -0.2, headRoll: -0.06 }],
  ]),
  clip("weight-shift", "Ağırlığını değiştir", "resting", 3.3, [
    [0.2, { bodyRoll: -0.13, leftLegPitch: 0.12, rightLegPitch: -0.12, headRoll: 0.1, tailRoll: 0.12 }],
    [0.48, { bodyRoll: 0.14, leftLegPitch: -0.14, rightLegPitch: 0.14, headRoll: -0.11, tailRoll: -0.13 }],
    [0.76, { bodyRoll: -0.06, leftLegPitch: 0.05, rightLegPitch: -0.05, headPitch: 0.06 }],
  ]),
  clip("tail-fan", "Kuyruğu hareket ettir", "resting", 2.7, [
    [0.18, { tailPitch: 0.28, tailRoll: -0.24, bodyYaw: 0.08 }],
    [0.4, { tailPitch: 0.22, tailRoll: 0.26, headYaw: -0.15 }],
    [0.62, { tailPitch: -0.16, tailRoll: -0.2, bodyYaw: -0.08 }],
    [0.81, { tailPitch: 0.12, tailRoll: 0.12, headPitch: 0.07 }],
  ]),
  clip("little-shimmy", "Kısa kıpırdanma", "resting", 2, [
    [0.16, { bodyRoll: -0.12, bodyYaw: -0.1, leftWingRoll: -0.2, tailRoll: 0.16 }],
    [0.32, { bodyRoll: 0.14, bodyYaw: 0.12, rightWingRoll: 0.23, headRoll: -0.1 }],
    [0.49, { bodyRoll: -0.1, bodyYaw: -0.08, leftWingRoll: -0.16, tailRoll: 0.14 }],
    [0.66, { bodyRoll: 0.08, bodyYaw: 0.06, rightWingRoll: 0.14, headRoll: -0.07 }],
    [0.82, { headPitch: 0.08 }],
  ]),
  clip("settle-breath", "Sakinleşip dur", "resting", 3.6, [
    [0.24, { bodyPitch: -0.07, leftWingRoll: -0.18, rightWingRoll: 0.18, headPitch: -0.1, tailPitch: 0.12 }],
    [0.54, { bodyPitch: 0.09, headPitch: 0.16, leftWingPitch: 0.08, rightWingPitch: 0.08, tailPitch: -0.12 }],
    [0.81, { bodyPitch: 0.02, headPitch: 0.04, tailPitch: -0.03 }],
  ]),
] as const);

export type GestureId = (typeof GESTURES)[number]["id"];
const byId = new Map<string, GestureDefinition<GestureId>>(GESTURES.map((gesture) => [gesture.id, gesture]));
const channels = Object.keys(NEUTRAL_GESTURE_POSE) as (keyof GesturePose)[];

export function getGesture(id: string): GestureDefinition<GestureId> | null {
  return byId.get(id) ?? null;
}

export interface GestureSampleOptions {
  reducedMotion?: boolean;
  seated?: boolean;
  /** Holding a weapon or umbrella reserves the shoulder pose for that item. */
  rightWingOccupied?: boolean;
  leftWingOccupied?: boolean;
}

/** A smooth, bounded one-shot clip. Invalid times/IDs and completed clips rest. */
export function sampleGesture(id: string, elapsedSeconds: number, options: GestureSampleOptions = {}): GesturePose {
  const gesture = getGesture(id);
  const pose: GesturePose = { ...NEUTRAL_GESTURE_POSE };
  if (!gesture || options.reducedMotion || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds >= gesture.duration) return pose;
  const at = elapsedSeconds / gesture.duration;
  const endIndex = gesture.keyframes.findIndex((frame) => frame.at >= at);
  const from = gesture.keyframes[endIndex - 1];
  const to = gesture.keyframes[endIndex];
  const progress = (at - from.at) / (to.at - from.at);
  // Zero velocity at each staged hold keeps shoulders from snapping direction.
  const eased = progress * progress * (3 - 2 * progress);
  for (const channel of channels) {
    const value = from.pose[channel] + (to.pose[channel] - from.pose[channel]) * eased;
    const [min, max] = POSE_LIMITS[channel];
    pose[channel] = Math.max(min, Math.min(max, value));
  }
  if (options.seated) { pose.lift = 0; pose.leftLegPitch = 0; pose.rightLegPitch = 0; }
  if (options.leftWingOccupied) { pose.leftWingPitch = 0; pose.leftWingRoll = 0; pose.leftWingYaw = 0; }
  if (options.rightWingOccupied) { pose.rightWingPitch = 0; pose.rightWingRoll = 0; pose.rightWingYaw = 0; }
  return pose;
}

export interface GestureSelection {
  seat: string | number;
  event: string | number;
  category?: GestureCategory;
}

function hash(value: string): number {
  let state = 2166136261;
  for (let index = 0; index < value.length; index++) state = Math.imul(state ^ value.charCodeAt(index), 16777619);
  state ^= state >>> 16;
  return state >>> 0;
}

/** Replays choose the same clip; seats and real event IDs vary their selection. */
export function chooseNextGesture(previous: GestureId | null, selection: GestureSelection): GestureId {
  const category = GESTURE_CATEGORIES.includes(selection.category as GestureCategory) ? selection.category : undefined;
  const candidates = GESTURES.filter((gesture) => gesture.id !== previous && (!category || gesture.category === category));
  const seed = hash(`${selection.seat}|${selection.event}|${selection.category ?? "all"}`);
  return candidates[seed % candidates.length].id;
}

export const GESTURE_COMMANDS = Object.freeze([
  { id: "wave-small", label: "Selamla", aliases: ["selamla", "selam ver", "el salla", "wave", "say hello"] },
  { id: "bow-greeting", label: "Eğilerek selamla", aliases: ["eğilerek selamla", "egilerek selamla", "bow"] },
  { id: "chin-tap", label: "Düşünme hareketi", aliases: ["düşünme hareketi", "dusunme hareketi", "düşün", "dusun", "think"] },
  { id: "present-both", label: "Sunum hareketi", aliases: ["sunum hareketi", "sun", "anlat", "present"] },
  { id: "stretch-up", label: "Gerin", aliases: ["gerin", "stretch"] },
  { id: "little-shimmy", label: "Kıpırdan", aliases: ["kıpırdan", "kipirdan", "dans et", "dance"] },
  { id: "tail-fan", label: "Kuyruğunu salla", aliases: ["kuyruğunu salla", "kuyrugunu salla", "wag tail"] },
  { id: "settle-breath", label: "Sakinleş", aliases: ["sakinleş", "sakinles", "dinlen", "rest"] },
] as const satisfies readonly { id: GestureId; label: string; aliases: readonly string[] }[]);

/** Exact allowlist only; commands never execute code or impersonate council votes. */
export function resolveGestureCommand(input: string): GestureId | null {
  const text = input.trim().normalize("NFKC");
  const values = [text.toLocaleLowerCase("tr-TR"), text.toLowerCase()];
  for (const value of values) {
    const exact = getGesture(value);
    if (exact) return exact.id;
  }
  return GESTURE_COMMANDS.find((command) => command.aliases.some((alias) => values.includes(alias)))?.id ?? null;
}
