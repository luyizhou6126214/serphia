import type { ScheduleRule } from "../contract/schedule.ts";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
type CalendarRule = Extract<ScheduleRule, { kind: "daily" | "weekly" }>;

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
}

function localAsUtc(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function findCalendarOccurrence(rule: CalendarRule, now: number, direction: 1 | -1): number | null {
  const formatter = clockFormatter(rule.timeZone);
  const localDay = Math.floor(localAsUtc(formatter, now) / DAY_MS) * DAY_MS;
  const [hour, minute] = rule.time.split(":").map(Number);

  // Two weeks also cover a skipped weekly occurrence during a DST transition.
  for (let index = 0; index <= 14; index++) {
    const day = localDay + direction * index * DAY_MS;
    const weekday = new Date(day).getUTCDay() || 7;
    if (rule.kind === "weekly" && !rule.weekdays.includes(weekday)) continue;

    const local = day + (hour * 60 + minute) * MINUTE_MS;
    const candidates = [local - DAY_MS, local, local + DAY_MS]
      .map((probe) => local - (localAsUtc(formatter, probe) - probe))
      .filter((instant) => localAsUtc(formatter, instant) === local);
    // Gaps have no matching instant. Overlaps use the earlier one once.
    const instant = Math.min(...candidates);
    if (Number.isFinite(instant) && (direction === 1 ? instant > now : instant <= now)) return instant;
  }
  return null;
}

export function normalizeScheduleRule(rule: ScheduleRule): ScheduleRule {
  if (rule.kind === "once") return { kind: rule.kind, at: rule.at };
  if (rule.kind === "interval") return { kind: rule.kind, minutes: rule.minutes };
  const timeZone = clockFormatter(rule.timeZone.trim()).resolvedOptions().timeZone;
  if (/^[+-]/.test(timeZone)) throw new RangeError("Use an IANA time zone");
  return rule.kind === "daily"
    ? { kind: rule.kind, time: rule.time, timeZone }
    : { kind: rule.kind, time: rule.time, timeZone, weekdays: [...rule.weekdays].sort((a, b) => a - b) };
}

export function firstScheduleTarget(rule: ScheduleRule, now: number): number | null {
  if (rule.kind === "once") return rule.at > now ? rule.at : null;
  if (rule.kind === "interval") return now + rule.minutes * MINUTE_MS;
  return findCalendarOccurrence(rule, now, 1);
}

/** Collapse all missed slots into one run and keep fixed intervals anchored to their original cadence. */
export function consumeScheduleTarget(
  rule: ScheduleRule,
  target: number,
  now: number,
): { scheduledAt: number; nextAt: number | null } {
  if (rule.kind === "once") return { scheduledAt: target, nextAt: null };
  if (rule.kind === "interval") {
    const interval = rule.minutes * MINUTE_MS;
    const scheduledAt = target + Math.floor((now - target) / interval) * interval;
    return { scheduledAt, nextAt: scheduledAt + interval };
  }
  return {
    scheduledAt: Math.max(target, findCalendarOccurrence(rule, now, -1) ?? target),
    nextAt: findCalendarOccurrence(rule, now, 1),
  };
}
