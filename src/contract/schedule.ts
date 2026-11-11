import { Type, type Static } from "typebox";

const instant = Type.Integer({ minimum: 0, maximum: 253_402_300_799_999 });
const id = Type.String({ minLength: 1, maxLength: 128 });
const clock = {
  time: Type.String({ pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }),
  timeZone: Type.String({ minLength: 1, maxLength: 100 }),
};

export const scheduleRule = Type.Union([
  Type.Object({ kind: Type.Literal("once"), at: instant }),
  Type.Object({ kind: Type.Literal("interval"), minutes: Type.Integer({ minimum: 1, maximum: 525_600 }) }),
  Type.Object({ kind: Type.Literal("daily"), ...clock }),
  Type.Object({
    kind: Type.Literal("weekly"),
    ...clock,
    weekdays: Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), { minItems: 1, maxItems: 7, uniqueItems: true }),
  }),
]);
export type ScheduleRule = Static<typeof scheduleRule>;

const taskFields = {
  name: Type.String({ minLength: 1, maxLength: 120 }),
  prompt: Type.String({ minLength: 1, maxLength: 16_000 }),
  sessionId: id,
  rule: scheduleRule,
};
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const taskIdentity = { id, revision };
export const scheduleSave = Type.Object({
  ...taskFields,
  id: Type.Optional(id),
  revision: Type.Optional(revision),
});
export type ScheduleSave = Static<typeof scheduleSave>;

export const scheduleTaskRef = Type.Object(taskIdentity);
export const scheduleTaskId = Type.Object({ id });
export const schedulePause = Type.Object({ ...taskIdentity, paused: Type.Boolean() });
export const scheduleTask = Type.Object({
  ...taskFields,
  ...taskIdentity,
  status: Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("completed")]),
  nextAt: Type.Union([instant, Type.Null()]),
  runs: Type.Array(
    Type.Object({
      id,
      trigger: Type.Union([Type.Literal("scheduled"), Type.Literal("manual")]),
      scheduledAt: instant,
      sessionId: id,
      status: Type.Union([
        Type.Literal("running"),
        Type.Literal("succeeded"),
        Type.Literal("failed"),
        Type.Literal("interrupted"),
      ]),
      error: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    { maxItems: 20 },
  ),
});

export type ScheduleTask = Static<typeof scheduleTask>;
export type ScheduleRun = ScheduleTask["runs"][number];
