import { describe, expect, it } from 'vitest';
import type { TaskSchedule } from '../contract';
import {
  fieldsOf,
  MINUTE_REASON,
  type ScheduleFields,
  scheduleOf,
} from './schedule-fields';

describe('scheduleOf', () => {
  it.each<{ schedule: TaskSchedule }>([
    { schedule: { kind: 'hourly', minute: 15 } },
    { schedule: { kind: 'daily', time: '09:00' } },
    { schedule: { kind: 'weekdays', time: '07:30' } },
    { schedule: { kind: 'weekly', day: 3, time: '18:45' } },
    { schedule: { kind: 'once', at: '2026-11-20T14:30' } },
    { schedule: { kind: 'cron', line: '0 9 * * 1-5' } },
  ])(
    'scheduleOf_FieldsOfASchedule_ReturnsTheSchedule: $schedule.kind',
    ({ schedule }) => {
      expect(scheduleOf(fieldsOf(schedule))).toEqual(schedule);
    },
  );

  const fields = (changes: Partial<ScheduleFields>): ScheduleFields => ({
    kind: 'daily',
    minute: '',
    time: '',
    day: 0,
    at: '',
    line: '',
    ...changes,
  });

  it.each<{ name: string; fields: ScheduleFields; expected: unknown }>([
    {
      name: 'minute not a number',
      fields: fields({ kind: 'hourly', minute: 'x' }),
      expected: MINUTE_REASON,
    },
    {
      name: 'once with a space',
      fields: fields({ kind: 'once', at: '2026-11-20 14:30' }),
      expected: { kind: 'once', at: '2026-11-20T14:30' },
    },
  ])('scheduleOf_EditorText_ReadsIt: $name', ({ fields: given, expected }) => {
    expect(scheduleOf(given)).toEqual(expected);
  });

  it('scheduleOf_TimeOutOfRange_GivesReadSchedulesReason', () => {
    const reason = scheduleOf(fields({ kind: 'daily', time: '25:00' }));

    expect(typeof reason).toBe('string');
    expect(reason).toContain('time');
  });
});
