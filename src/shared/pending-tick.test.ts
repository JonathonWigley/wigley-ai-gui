import { describe, expect, it } from 'vitest';
import { fakeTimers } from './fake-timers.test-support';
import { createPendingTick, type PendingTick } from './pending-tick';

const MS = 1000;

interface Row {
  case: string;
  act: (tick: PendingTick, fireAll: () => void) => void;
  expected: { runs: number; armed: [number, number][]; cleared: number[] };
}

describe('createPendingTick', () => {
  // Breaks if a second need sets a second timer, the delay is dropped, a clear
  // is skipped or repeated, or the handle is kept past `run` so the next tick
  // is never set.
  it.each<Row>([
    {
      case: 'arms one timer however often it is needed',
      act: (tick) => {
        tick.setNeeded(true);
        tick.setNeeded(true);
      },
      expected: { runs: 0, armed: [[1, MS]], cleared: [] },
    },
    {
      case: 'clears a pending timer once not needed',
      act: (tick) => {
        tick.setNeeded(true);
        tick.setNeeded(false);
        tick.setNeeded(false);
      },
      expected: { runs: 0, armed: [], cleared: [1] },
    },
    {
      case: 'a fired tick may ask for the next',
      act: (tick, fireAll) => {
        tick.setNeeded(true);
        fireAll();
      },
      expected: { runs: 1, armed: [[2, MS]], cleared: [] },
    },
    {
      case: 'not needed and not pending does nothing',
      act: (tick) => {
        tick.setNeeded(false);
      },
      expected: { runs: 0, armed: [], cleared: [] },
    },
  ])('$case', ({ act, expected }) => {
    const { timers, armed, cleared, fireAll } = fakeTimers();
    let runs = 0;
    const tick = createPendingTick(timers, MS, () => {
      runs += 1;
      tick.setNeeded(true);
    });

    act(tick, fireAll);

    expect({
      runs,
      armed: [...armed].map(([handle, { ms }]) => [handle, ms]),
      cleared,
    }).toEqual(expected);
  });
});
