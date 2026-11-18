import type { TaskSchedule } from '../contract';
import { readSchedule } from '../schedule';

export type ScheduleKind = TaskSchedule['kind'];

// The editor's schedule rows as text, each '' when its kind does not use it.
// `day` is 0 (Sunday) … 6, 0 for a kind that has no day.
export interface ScheduleFields {
  kind: ScheduleKind;
  minute: string;
  time: string;
  day: number;
  at: string;
  line: string;
}

export const MINUTE_REASON = 'Minute must be a whole number from 0 to 59.';

// `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`.
const AT_TEXT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;
const WHOLE_NUMBER = /^\d+$/;

const NO_FIELDS: Omit<ScheduleFields, 'kind'> = {
  minute: '',
  time: '',
  day: 0,
  at: '',
  line: '',
};

export function fieldsOf(schedule: TaskSchedule): ScheduleFields {
  switch (schedule.kind) {
    case 'hourly':
      return {
        ...NO_FIELDS,
        kind: schedule.kind,
        minute: String(schedule.minute),
      };
    case 'daily':
    case 'weekdays':
      return { ...NO_FIELDS, kind: schedule.kind, time: schedule.time };
    case 'weekly':
      return {
        ...NO_FIELDS,
        kind: schedule.kind,
        day: schedule.day,
        time: schedule.time,
      };
    case 'once':
      return {
        ...NO_FIELDS,
        kind: schedule.kind,
        at: schedule.at.replace('T', ' '),
      };
    case 'cron':
      return { ...NO_FIELDS, kind: schedule.kind, line: schedule.line };
  }
}

// The schedule the fields hold, or the reason they do not hold one (readSchedule's reason, or the page's own).
export function scheduleOf(fields: ScheduleFields): TaskSchedule | string {
  const built = scheduleValue(fields);
  return typeof built === 'string' ? built : readSchedule(built);
}

// The fields as the task file's schedule object, for `readSchedule` to check; a minute that is no whole number gives
// the page's own reason.
function scheduleValue(fields: ScheduleFields): object | string {
  switch (fields.kind) {
    case 'hourly': {
      const minute = fields.minute.trim();
      return WHOLE_NUMBER.test(minute)
        ? { kind: fields.kind, minute: Number(minute) }
        : MINUTE_REASON;
    }
    case 'daily':
    case 'weekdays':
      return { kind: fields.kind, time: fields.time.trim() };
    case 'weekly':
      return { kind: fields.kind, day: fields.day, time: fields.time.trim() };
    case 'once': {
      const at = fields.at.trim();
      return { kind: fields.kind, at: at.replace(AT_TEXT, '$1T$2') };
    }
    case 'cron':
      return { kind: fields.kind, line: fields.line.trim() };
  }
}
