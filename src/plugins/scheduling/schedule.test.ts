import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskSchedule } from './contract';
import {
  latestOccurrence,
  nextOccurrence,
  readSchedule,
  scheduleText,
} from './schedule';

// Every expected instant is a UTC ISO string, so it does not come from the
// local `Date` code under test; the comments give the America/New_York time.
let savedZone: string | undefined;

beforeAll(() => {
  savedZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
});

afterAll(() => {
  if (savedZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedZone;
  }
});

function instant(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

describe('readSchedule', () => {
  it.each<{ schedule: TaskSchedule }>([
    { schedule: { kind: 'hourly', minute: 15 } },
    { schedule: { kind: 'daily', time: '09:00' } },
    { schedule: { kind: 'weekdays', time: '07:45' } },
    { schedule: { kind: 'weekly', day: 1, time: '09:00' } },
    { schedule: { kind: 'once', at: '2026-11-20T14:30' } },
    { schedule: { kind: 'cron', line: '*/15 9-17 * * 1-5' } },
  ])('readSchedule_ValidSchedule_ReturnsIt: $schedule.kind', ({ schedule }) => {
    expect(readSchedule(schedule)).toEqual(schedule);
  });

  it.each<{ case: string; value: unknown; names: string }>([
    {
      case: 'minute 60',
      value: { kind: 'hourly', minute: 60 },
      names: 'schedule.minute',
    },
    {
      case: 'time 9:00',
      value: { kind: 'daily', time: '9:00' },
      names: 'schedule.time',
    },
    {
      case: 'time 24:00',
      value: { kind: 'weekdays', time: '24:00' },
      names: 'schedule.time',
    },
    {
      case: 'weekly day 7',
      value: { kind: 'weekly', day: 7, time: '09:00' },
      names: 'schedule.day',
    },
    {
      case: 'once on 30 February',
      value: { kind: 'once', at: '2026-02-30T10:00' },
      names: 'schedule.at',
    },
    {
      case: 'unknown kind',
      value: { kind: 'yearly', time: '09:00' },
      names: 'schedule.kind',
    },
    {
      case: 'extra key',
      value: { kind: 'daily', time: '09:00', minute: 5 },
      names: 'minute',
    },
    {
      case: 'cron with four fields',
      value: { kind: 'cron', line: '0 9 * *' },
      names: 'schedule.line',
    },
    {
      case: 'cron minute 60',
      value: { kind: 'cron', line: '60 * * * *' },
      names: 'minute field',
    },
    {
      case: 'cron step 0',
      value: { kind: 'cron', line: '*/0 * * * *' },
      names: 'minute field',
    },
    {
      case: 'cron day name',
      value: { kind: 'cron', line: '0 9 * * MON' },
      names: 'day of week field',
    },
    {
      case: 'cron 30 February',
      value: { kind: 'cron', line: '0 0 30 2 *' },
      names: 'day of month',
    },
    {
      case: 'cron signed number',
      value: { kind: 'cron', line: '+5 * * * *' },
      names: 'minute field',
    },
    {
      case: 'cron decimal',
      value: { kind: 'cron', line: '1.5 * * * *' },
      names: 'minute field',
    },
    {
      case: 'once in year 50',
      value: { kind: 'once', at: '0050-01-01T00:00' },
      names: 'schedule.at',
    },
    {
      case: 'once in a DST gap',
      value: { kind: 'once', at: '2026-03-08T02:30' },
      names: 'schedule.at',
    },
    { case: 'null', value: null, names: 'schedule' },
  ])('readSchedule_BadSchedule_NamesTheField: $case', ({ value, names }) => {
    const read = readSchedule(value);

    expect(typeof read).toBe('string');
    expect(read).toContain(names);
  });
});

describe('nextOccurrence', () => {
  it.each<{
    case: string;
    schedule: TaskSchedule;
    after: string;
    expected: string | null;
  }>([
    {
      case: 'hourly :15 after 10:20',
      schedule: { kind: 'hourly', minute: 15 },
      after: '2026-11-09T15:20:00Z', // Mon 10:20
      expected: '2026-11-09T16:15:00Z',
    },
    {
      case: 'daily, strictly after',
      schedule: { kind: 'daily', time: '09:00' },
      after: '2026-11-09T14:00:00Z', // Mon 09:00
      expected: '2026-11-10T14:00:00Z',
    },
    {
      case: 'weekdays skip the weekend',
      schedule: { kind: 'weekdays', time: '09:00' },
      after: '2026-11-13T14:00:00Z', // Fri 09:00
      expected: '2026-11-16T14:00:00Z',
    },
    {
      case: 'weekly later the same day',
      schedule: { kind: 'weekly', day: 1, time: '09:00' },
      after: '2026-11-09T13:59:00Z', // Mon 08:59
      expected: '2026-11-09T14:00:00Z',
    },
    {
      case: 'once ahead',
      schedule: { kind: 'once', at: '2026-11-20T00:00' },
      after: '2026-11-09T17:00:00Z', // Mon 12:00
      expected: '2026-11-20T05:00:00Z',
    },
    {
      case: 'once spent',
      schedule: { kind: 'once', at: '2026-11-20T00:00' },
      after: '2026-11-20T05:00:00Z',
      expected: null,
    },
    {
      case: 'cron day of week or day of month, the Monday',
      schedule: { kind: 'cron', line: '0 0 20 * 1' },
      after: '2026-11-09T17:00:00Z', // Mon 12:00
      expected: '2026-11-16T05:00:00Z',
    },
    {
      case: 'cron day of week or day of month, the 20th',
      schedule: { kind: 'cron', line: '0 0 20 * 1' },
      after: '2026-11-16T05:00:00Z',
      expected: '2026-11-20T05:00:00Z',
    },
    {
      case: 'cron 7 is Sunday',
      schedule: { kind: 'cron', line: '0 0 * * 7' },
      after: '2026-11-09T17:00:00Z', // Mon 12:00
      expected: '2026-11-15T05:00:00Z',
    },
    {
      case: 'cron 29 February',
      schedule: { kind: 'cron', line: '0 0 29 2 *' },
      after: '2026-03-01T05:00:00Z', // 1 March 00:00
      expected: '2028-02-29T05:00:00Z',
    },
    {
      case: 'DST gap skips the day',
      schedule: { kind: 'daily', time: '02:30' },
      after: '2026-03-07T08:00:00Z', // Sat 03:00
      expected: '2026-03-09T06:30:00Z',
    },
    {
      case: 'DST overlap, the first 01:30',
      schedule: { kind: 'daily', time: '01:30' },
      after: '2026-10-31T16:00:00Z', // Sat 12:00
      expected: '2026-11-01T05:30:00Z',
    },
    {
      case: 'DST overlap, no second 01:30',
      schedule: { kind: 'daily', time: '01:30' },
      after: '2026-11-01T05:30:00Z',
      expected: '2026-11-02T06:30:00Z',
    },
    {
      case: 'DST overlap, hourly skips the repeated 01:15',
      schedule: { kind: 'hourly', minute: 15 },
      after: '2026-11-01T05:15:00Z',
      expected: '2026-11-01T07:15:00Z',
    },
  ])(
    'nextOccurrence_Schedule_ReturnsTheFirstAfter: $case',
    ({ schedule, after, expected }) => {
      expect(nextOccurrence(schedule, Date.parse(after))).toBe(
        instant(expected),
      );
    },
  );
});

describe('latestOccurrence', () => {
  it.each<{
    case: string;
    schedule: TaskSchedule;
    after: string;
    notAfter: string;
    expected: string | null;
  }>([
    {
      case: 'three missed, the latest only',
      schedule: { kind: 'daily', time: '09:00' },
      after: '2026-11-06T17:00:00Z', // Fri 12:00
      notAfter: '2026-11-09T17:00:00Z', // Mon 12:00
      expected: '2026-11-09T14:00:00Z',
    },
    {
      case: 'one at notAfter is inside',
      schedule: { kind: 'daily', time: '09:00' },
      after: '2026-11-08T17:00:00Z',
      notAfter: '2026-11-09T14:00:00Z',
      expected: '2026-11-09T14:00:00Z',
    },
    {
      case: 'one at after is outside',
      schedule: { kind: 'daily', time: '09:00' },
      after: '2026-11-09T14:00:00Z',
      notAfter: '2026-11-10T13:00:00Z',
      expected: null,
    },
    {
      case: 'none in the window',
      schedule: { kind: 'weekly', day: 1, time: '09:00' },
      after: '2026-11-10T17:00:00Z', // Tue 12:00
      notAfter: '2026-11-14T17:00:00Z', // Sat 12:00
      expected: null,
    },
    {
      case: 'once before the window',
      schedule: { kind: 'once', at: '2026-11-20T00:00' },
      after: '2026-11-21T05:00:00Z',
      notAfter: '2026-11-25T05:00:00Z',
      expected: null,
    },
    {
      case: 'cron over two years, the last first of the month',
      schedule: { kind: 'cron', line: '0 9 1 * *' },
      after: '2026-11-09T17:00:00Z',
      notAfter: '2028-11-09T17:00:00Z',
      expected: '2028-11-01T13:00:00Z',
    },
    {
      case: 'after later than notAfter',
      schedule: { kind: 'daily', time: '09:00' },
      after: '2026-11-10T17:00:00Z',
      notAfter: '2026-11-09T17:00:00Z',
      expected: null,
    },
  ])(
    'latestOccurrence_Window_ReturnsTheLatestInside: $case',
    ({ schedule, after, notAfter, expected }) => {
      expect(
        latestOccurrence(schedule, Date.parse(after), Date.parse(notAfter)),
      ).toBe(instant(expected));
    },
  );
});

describe('scheduleText', () => {
  it.each<{ schedule: TaskSchedule; text: string }>([
    { schedule: { kind: 'hourly', minute: 5 }, text: 'Hourly at :05' },
    { schedule: { kind: 'daily', time: '09:00' }, text: 'Daily at 09:00' },
    {
      schedule: { kind: 'weekdays', time: '07:45' },
      text: 'Weekdays at 07:45',
    },
    {
      schedule: { kind: 'weekly', day: 1, time: '09:00' },
      text: 'Mondays at 09:00',
    },
    {
      schedule: { kind: 'once', at: '2026-11-20T14:30' },
      text: 'Once on 2026-11-20 at 14:30',
    },
    {
      schedule: { kind: 'cron', line: ' 0  9 *\t* 1-5 ' },
      text: 'Cron 0 9 * * 1-5',
    },
  ])('scheduleText_Schedule_ReadsAsPinned: $text', ({ schedule, text }) => {
    expect(scheduleText(schedule)).toBe(text);
  });
});
