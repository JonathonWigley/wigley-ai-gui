import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../contracts/active-time';
import {
  activeMsAt,
  NO_ACTIVE_TIME,
  startActiveTime,
  stopActiveTime,
} from './active-time';

const PAUSED_AT_5000: ActiveTime = { totalMs: 5000, since: null };

describe('ActiveTime', () => {
  it.each<{
    name: string;
    from: ActiveTime;
    steps: [typeof startActiveTime, number][];
    readAt: number;
    expectedMs: number;
    expectedTime: ActiveTime;
    lastStepKeepsObject: boolean;
  }>([
    {
      name: 'start then read counts the open span',
      from: PAUSED_AT_5000,
      steps: [[startActiveTime, 10_000]],
      readAt: 12_500,
      expectedMs: 7500,
      expectedTime: { totalMs: 5000, since: 10_000 },
      lastStepKeepsObject: false,
    },
    {
      name: 'a first start counts from no active time',
      from: NO_ACTIVE_TIME,
      steps: [[startActiveTime, 3000]],
      readAt: 3700,
      expectedMs: 700,
      expectedTime: { totalMs: 0, since: 3000 },
      lastStepKeepsObject: false,
    },
    {
      name: 'start, stop, read holds the closed span past the stop',
      from: PAUSED_AT_5000,
      steps: [
        [startActiveTime, 10_000],
        [stopActiveTime, 12_500],
      ],
      readAt: 99_000,
      expectedMs: 7500,
      expectedTime: { totalMs: 7500, since: null },
      lastStepKeepsObject: false,
    },
    {
      name: 'start twice keeps the first start',
      from: PAUSED_AT_5000,
      steps: [
        [startActiveTime, 10_000],
        [startActiveTime, 11_000],
      ],
      readAt: 12_500,
      expectedMs: 7500,
      expectedTime: { totalMs: 5000, since: 10_000 },
      lastStepKeepsObject: true,
    },
    {
      name: 'stop while paused changes nothing',
      from: PAUSED_AT_5000,
      steps: [[stopActiveTime, 12_500]],
      readAt: 20_000,
      expectedMs: 5000,
      expectedTime: { totalMs: 5000, since: null },
      lastStepKeepsObject: true,
    },
    {
      name: 'a stop before since adds 0',
      from: PAUSED_AT_5000,
      steps: [
        [startActiveTime, 10_000],
        [stopActiveTime, 9000],
      ],
      readAt: 99_000,
      expectedMs: 5000,
      expectedTime: { totalMs: 5000, since: null },
      lastStepKeepsObject: false,
    },
    {
      name: 'a read before since adds 0',
      from: PAUSED_AT_5000,
      steps: [[startActiveTime, 10_000]],
      readAt: 9000,
      expectedMs: 5000,
      expectedTime: { totalMs: 5000, since: 10_000 },
      lastStepKeepsObject: false,
    },
  ])(
    '$name',
    ({
      from,
      steps,
      readAt,
      expectedMs,
      expectedTime,
      lastStepKeepsObject,
    }) => {
      let time = from;
      let beforeLastStep = from;
      for (const [step, now] of steps) {
        beforeLastStep = time;
        time = step(time, now);
      }

      expect(activeMsAt(time, readAt)).toBe(expectedMs);
      expect(time).toEqual(expectedTime);
      expect(time === beforeLastStep).toBe(lastStepKeepsObject);
    },
  );
});
