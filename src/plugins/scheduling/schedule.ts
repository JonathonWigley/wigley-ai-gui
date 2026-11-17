import { isJsonObject, type JsonObject } from '../../shared/json';
import type { TaskSchedule } from './contract';

type ScheduleKind = TaskSchedule['kind'];

// Each kind's fields besides `kind`, in the order the task file writes them.
const KIND_FIELDS: Readonly<Record<ScheduleKind, readonly string[]>> = {
  hourly: ['minute'],
  daily: ['time'],
  weekdays: ['time'],
  weekly: ['day', 'time'],
  once: ['at'],
  cron: ['line'],
};
const KINDS = Object.keys(KIND_FIELDS) as ScheduleKind[];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// 366 days for 8 years: reaches a 29 February past a skipped leap year (2100).
const SEARCH_DAYS = 366 * 8;

const TIME = /^(\d{2}):(\d{2})$/;
const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
// `*`, `a` or `a-b`, each with an optional `/n` step.
const CRON_ITEM = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;

interface CronField {
  name: string;
  min: number;
  max: number;
}

const CRON_FIELDS: readonly CronField[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

// The most days each month 1–12 can hold, 29 February included.
const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface CronFieldValues {
  values: Set<number>;
  restricted: boolean; // the field does not start with `*`
}

interface CronSpec {
  minutes: number[];
  hours: number[];
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>; // 0 Sunday … 6; a 7 is read as 0
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

interface LocalMinute {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

// The local days a schedule fires on and the times of day it fires at.
interface DayPlan {
  // `month` 1–12, `weekday` 0 Sunday … 6.
  firesOn(month: number, day: number, weekday: number): boolean;
  // [hour, minute] pairs, earliest first.
  times: readonly (readonly [number, number])[];
}

// The schedule `value` holds, or the reason it is not one, naming the bad
// field.
export function readSchedule(value: unknown): TaskSchedule | string {
  if (!isJsonObject(value)) {
    return `schedule must be an object, got ${shown(value)}`;
  }
  const kind = KINDS.find((known) => known === value.kind);
  if (kind === undefined) {
    return `schedule.kind must be one of ${KINDS.join(', ')}, got ${shown(value.kind)}`;
  }
  const fields = KIND_FIELDS[kind];
  const unknownKey = Object.keys(value).find(
    (key) => key !== 'kind' && !fields.includes(key),
  );
  if (unknownKey !== undefined) {
    return `schedule.${unknownKey} is not a field of a ${kind} schedule`;
  }
  const missingField = fields.find((field) => !(field in value));
  if (missingField !== undefined) {
    return `schedule.${missingField} is missing from a ${kind} schedule`;
  }
  return readFields(kind, value);
}

// The first occurrence strictly after `after` (epoch ms); null when none comes
// (a spent one-time task).
export function nextOccurrence(
  schedule: TaskSchedule,
  after: number,
): number | null {
  if (schedule.kind === 'once') {
    const at = onceInstant(schedule.at);
    return at > after ? at : null;
  }
  const plan = dayPlan(schedule);
  const start = new Date(after);
  for (let offset = 0; offset < SEARCH_DAYS; offset++) {
    const day = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset,
      12,
    );
    if (!plan.firesOn(day.getMonth() + 1, day.getDate(), day.getDay())) {
      continue;
    }
    for (const [hour, minute] of plan.times) {
      const instant = localInstant(localMinuteOf(day, hour, minute));
      if (instant !== null && instant > after) {
        return instant;
      }
    }
  }
  return null;
}

// The latest occurrence in `(after, notAfter]`; null when none.
export function latestOccurrence(
  schedule: TaskSchedule,
  after: number,
  notAfter: number,
): number | null {
  if (after >= notAfter) {
    return null;
  }
  if (schedule.kind === 'once') {
    const at = onceInstant(schedule.at);
    return at > after && at <= notAfter ? at : null;
  }
  const plan = dayPlan(schedule);
  const end = new Date(notAfter);
  const firstDay = dateKey(new Date(after));
  for (let offset = 0; offset < SEARCH_DAYS; offset++) {
    const day = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate() - offset,
      12,
    );
    if (dateKey(day) < firstDay) {
      return null;
    }
    if (!plan.firesOn(day.getMonth() + 1, day.getDate(), day.getDay())) {
      continue;
    }
    for (let index = plan.times.length - 1; index >= 0; index--) {
      const [hour, minute] = plan.times[index];
      const instant = localInstant(localMinuteOf(day, hour, minute));
      if (instant === null || instant > notAfter) {
        continue;
      }
      return instant > after ? instant : null;
    }
  }
  return null;
}

// One line for the list and the tools: `Hourly at :15`, `Daily at 09:00`,
// `Weekdays at 09:00`, `Mondays at 09:00`, `Once on 2026-11-20 at 14:30`,
// `Cron 0 9 * * 1-5`.
export function scheduleText(schedule: TaskSchedule): string {
  switch (schedule.kind) {
    case 'hourly':
      return `Hourly at :${String(schedule.minute).padStart(2, '0')}`;
    case 'daily':
      return `Daily at ${schedule.time}`;
    case 'weekdays':
      return `Weekdays at ${schedule.time}`;
    case 'weekly':
      return `${DAY_NAMES[schedule.day]}s at ${schedule.time}`;
    case 'once': {
      const [date, time] = schedule.at.split('T');
      return `Once on ${date} at ${time}`;
    }
    case 'cron':
      return `Cron ${cronFields(schedule.line).join(' ')}`;
  }
}

// `value`'s fields read as a `kind` schedule; `readSchedule` checked its keys.
function readFields(
  kind: ScheduleKind,
  value: JsonObject,
): TaskSchedule | string {
  switch (kind) {
    case 'hourly': {
      const minute = value.minute;
      if (!isWholeNumberIn(minute, 0, 59)) {
        return `schedule.minute must be a whole number 0-59, got ${shown(minute)}`;
      }
      return { kind, minute };
    }
    case 'daily':
    case 'weekdays': {
      const time = value.time;
      if (!isTimeText(time)) {
        return timeReason(time);
      }
      return { kind, time };
    }
    case 'weekly': {
      const { day, time } = value;
      if (!isWholeNumberIn(day, 0, 6)) {
        return `schedule.day must be a whole number 0-6 (0 is Sunday), got ${shown(day)}`;
      }
      if (!isTimeText(time)) {
        return timeReason(time);
      }
      return { kind, day, time };
    }
    case 'once': {
      const at = value.at;
      const local = typeof at === 'string' ? readAt(at) : null;
      if (typeof at !== 'string' || local === null) {
        return `schedule.at must be a real local date and time YYYY-MM-DDTHH:MM, year 1970 or later, got ${shown(at)}`;
      }
      if (localInstant(local) === null) {
        return `schedule.at ${shown(at)} does not occur: a daylight saving change skips that local time that day`;
      }
      return { kind, at };
    }
    case 'cron': {
      const line = value.line;
      if (typeof line !== 'string') {
        return `schedule.line must be a string of five cron fields, got ${shown(line)}`;
      }
      const spec = readCron(line);
      return typeof spec === 'string' ? spec : { kind, line };
    }
  }
}

function isTimeText(value: unknown): value is string {
  return typeof value === 'string' && readTime(value) !== null;
}

function timeReason(value: unknown): string {
  return `schedule.time must be HH:MM, got ${shown(value)}`;
}

// [hour, minute] of an `HH:MM` text, or null when it is not one.
function readTime(text: string): [number, number] | null {
  const match = TIME.exec(text);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

// The local minute an `at` text names, or null when it names no real calendar
// minute in 1970 or later.
function readAt(text: string): LocalMinute | null {
  const match = AT.exec(text);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const isRealMonth = year >= 1970 && month >= 1 && month <= 12;
  if (!isRealMonth) {
    return null;
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const isRealMinute =
    day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59;
  return isRealMinute ? { year, month, day, hour, minute } : null;
}

// The cron line's five fields read, or the reason naming the bad field.
function readCron(line: string): CronSpec | string {
  const texts = cronFields(line);
  if (texts.length !== CRON_FIELDS.length) {
    return `schedule.line must have five fields (minute hour day-of-month month day-of-week), got ${shown(line)}`;
  }
  const fields: CronFieldValues[] = [];
  for (let index = 0; index < texts.length; index++) {
    const field = readCronField(texts[index], CRON_FIELDS[index]);
    if (typeof field === 'string') {
      return field;
    }
    fields.push(field);
  }
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields;
  const firstDay = Math.min(...daysOfMonth.values);
  const longestMonth = Math.max(
    ...[...months.values].map((month) => MONTH_MAX_DAYS[month - 1]),
  );
  if (!daysOfWeek.restricted && firstDay > longestMonth) {
    return `schedule.line day of month: no listed month has a day ${firstDay}, got ${shown(line)}`;
  }
  return {
    minutes: sorted(minutes.values),
    hours: sorted(hours.values),
    daysOfMonth: daysOfMonth.values,
    months: months.values,
    daysOfWeek: new Set(
      [...daysOfWeek.values].map((day) => (day === 7 ? 0 : day)),
    ),
    dayOfMonthRestricted: daysOfMonth.restricted,
    dayOfWeekRestricted: daysOfWeek.restricted,
  };
}

function readCronField(
  text: string,
  field: CronField,
): CronFieldValues | string {
  const values = new Set<number>();
  for (const item of text.split(',')) {
    const match = CRON_ITEM.exec(item);
    const isStepOnANumber =
      match !== null &&
      match[1] !== undefined &&
      match[2] === undefined &&
      match[3] !== undefined;
    if (match === null || isStepOnANumber) {
      return `schedule.line ${field.name} field: ${shown(item)} is not *, a number, a range a-b, */n or a-b/n`;
    }
    const [from, to] = cronItemBounds(match, field);
    const step = match[3] === undefined ? 1 : Number(match[3]);
    const isInRange =
      from >= field.min && to <= field.max && from <= to && step >= 1;
    if (!isInRange) {
      return `schedule.line ${field.name} field: ${shown(item)} must stay within ${field.min}-${field.max}, low to high, with a step of at least 1`;
    }
    for (let value = from; value <= to; value += step) {
      values.add(value);
    }
  }
  return { values, restricted: !text.startsWith('*') };
}

// The first and last value a matched cron item spans before its step: the
// field's whole range for `*`, else its number or range.
function cronItemBounds(
  match: RegExpExecArray,
  field: CronField,
): [number, number] {
  if (match[1] === undefined) {
    return [field.min, field.max];
  }
  const from = Number(match[1]);
  return [from, match[2] === undefined ? from : Number(match[2])];
}

// A cron line's fields: trimmed and split on runs of spaces or tabs.
function cronFields(line: string): string[] {
  return line.trim().split(/[ \t]+/);
}

function dayPlan(schedule: Exclude<TaskSchedule, { kind: 'once' }>): DayPlan {
  switch (schedule.kind) {
    case 'hourly':
      return {
        firesOn: () => true,
        times: Array.from(
          { length: 24 },
          (_, hour) => [hour, schedule.minute] as const,
        ),
      };
    case 'daily':
      return { firesOn: () => true, times: [requireTime(schedule.time)] };
    case 'weekdays':
      return {
        firesOn: (_month, _day, weekday) => weekday >= 1 && weekday <= 5,
        times: [requireTime(schedule.time)],
      };
    case 'weekly':
      return {
        firesOn: (_month, _day, weekday) => weekday === schedule.day,
        times: [requireTime(schedule.time)],
      };
    case 'cron':
      return cronPlan(requireCron(schedule.line));
  }
}

function cronPlan(spec: CronSpec): DayPlan {
  const times: (readonly [number, number])[] = [];
  for (const hour of spec.hours) {
    for (const minute of spec.minutes) {
      times.push([hour, minute]);
    }
  }
  const areBothDaysRestricted =
    spec.dayOfMonthRestricted && spec.dayOfWeekRestricted;
  return {
    firesOn(month, day, weekday) {
      if (!spec.months.has(month)) {
        return false;
      }
      const dayOfMonthMatches = spec.daysOfMonth.has(day);
      const dayOfWeekMatches = spec.daysOfWeek.has(weekday);
      return areBothDaysRestricted
        ? dayOfMonthMatches || dayOfWeekMatches
        : dayOfMonthMatches && dayOfWeekMatches;
    },
    times,
  };
}

function onceInstant(at: string): number {
  const local = readAt(at);
  const instant = local === null ? null : localInstant(local);
  if (instant === null) {
    throw new Error(`schedule.at ${shown(at)} names no local time`);
  }
  return instant;
}

function requireTime(time: string): [number, number] {
  const read = readTime(time);
  if (read === null) {
    throw new Error(timeReason(time));
  }
  return read;
}

function requireCron(line: string): CronSpec {
  const spec = readCron(line);
  if (typeof spec === 'string') {
    throw new Error(spec);
  }
  return spec;
}

function localMinuteOf(day: Date, hour: number, minute: number): LocalMinute {
  return {
    year: day.getFullYear(),
    month: day.getMonth() + 1,
    day: day.getDate(),
    hour,
    minute,
  };
}

// The instant of a local minute, at its first instance when a daylight saving
// overlap repeats it; null when a daylight saving gap skips it.
function localInstant(local: LocalMinute): number | null {
  const date = new Date(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  const isSkipped =
    date.getHours() !== local.hour || date.getMinutes() !== local.minute;
  return isSkipped ? null : date.getTime();
}

// A local date as one number that sorts by date.
function dateKey(date: Date): number {
  return (
    date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  );
}

function sorted(values: ReadonlySet<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function isWholeNumberIn(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function shown(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}
