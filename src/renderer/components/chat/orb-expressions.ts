import { gsap } from "gsap";

// Each eye is one cubic stroke; each mouth is a closed pair of cubics.
// Matching control points let the ink bend continuously between expressions.
export const restingEye = { d: "M0 -7 C-1 -3 -1 3 0 7", width: 12 };
export const restingMouth = "M-7 0 C-3 4 3 5 7 -1 C5 8 -4 9 -7 0Z";

const crescent = { d: "M-8 2 C-5 -5 4 -6 8 1", width: 4.6 };
const closed = { d: "M-8 0 C-3 4 3 4 7 -1", width: 4.4 };
const wide = { d: "M0 -5 C0 -3 0 0 0 3", width: 15 };
const raised = { d: "M2 -11 C1 -7 0 -1 0 3", width: 10.5 };
const sidelong = { d: "M-3 -2 C-3 0 -3 4 -2 7", width: 9.5 };

interface Expression {
  eyes: [typeof restingEye, typeof restingEye];
  mouth: string;
  blush: number;
  tilt: number;
  lift: number;
}

const expressions = {
  laugh: {
    eyes: [crescent, crescent],
    mouth: "M-10 -2 C-5 0 5 0 10 -2 C8 12 -7 13 -10 -2Z",
    blush: 0.72,
    tilt: -3,
    lift: -2,
  },
  wink: { eyes: [restingEye, crescent], mouth: "M-7 0 C-1 3 5 2 9 -3 C6 6 -3 8 -7 0Z", blush: 0.54, tilt: -6, lift: 0 },
  curious: { eyes: [raised, sidelong], mouth: "M-5 2 C-2 0 3 -2 7 -1 C5 2 -2 4 -5 2Z", blush: 0, tilt: 6, lift: -1 },
  surprised: { eyes: [wide, wide], mouth: "M-4 0 C-4 -9 5 -9 5 0 C5 10 -4 10 -4 0Z", blush: 0.14, tilt: 0, lift: -4 },
  sleepy: { eyes: [closed, closed], mouth: "M-3 1 C-3 -4 4 -4 4 1 C4 10 -3 10 -3 1Z", blush: 0.2, tilt: 4, lift: 3 },
  shy: { eyes: [sidelong, sidelong], mouth: "M-4 1 C-2 3 2 4 5 0 C4 6 -2 7 -4 1Z", blush: 0.92, tilt: -5, lift: 2 },
} satisfies Record<string, Expression>;

export function animateOrbExpressions() {
  let remaining: Expression[] = [];
  function draw(previous?: Expression) {
    if (remaining.length === 0) remaining = Object.values(expressions);
    const choices = remaining.filter((expression) => expression !== previous);
    const next = choices[Math.floor(Math.random() * choices.length)];
    remaining.splice(remaining.indexOf(next), 1);
    return next;
  }

  let mood = draw();
  const timeline = gsap.timeline({
    repeat: -1,
    repeatRefresh: true,
    defaults: { duration: 0.38, ease: "sine.inOut" },
    onRepeat: () => {
      mood = draw(mood);
    },
  });
  timeline
    .addLabel("pose", 0.95)
    .to(
      "[data-orb-expression]",
      { svgOrigin: "235 111", rotation: () => mood.tilt, y: () => mood.lift, duration: 0.54 },
      "pose",
    )
    .to(
      "[data-orb-eye]",
      { attr: { d: (i: number) => mood.eyes[i].d, "stroke-width": (i: number) => mood.eyes[i].width } },
      "pose",
    )
    .to("[data-orb-mouth]", { attr: { d: () => mood.mouth } }, "pose+=0.08")
    .to("[data-orb-cheeks]", { opacity: () => mood.blush, duration: 0.6 }, "pose+=0.12")
    .addLabel("rest", 3.15)
    .to("[data-orb-eye]", { attr: { d: restingEye.d, "stroke-width": restingEye.width } }, "rest")
    .to("[data-orb-mouth]", { attr: { d: restingMouth } }, "rest+=0.06")
    .to("[data-orb-cheeks]", { opacity: 0 }, "rest")
    .to("[data-orb-expression]", { rotation: 0, y: 0, duration: 0.5 }, "rest")
    .to(
      "[data-orb-blink]",
      { svgOrigin: "234 104", scaleY: 0.12, duration: 0.085, repeat: 1, yoyo: true },
      "rest+=0.9",
    );

  return {
    timeline,
    restart() {
      timeline.pause(0);
      mood = draw(mood);
      timeline.invalidate().restart();
    },
  };
}
