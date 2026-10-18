import { describe, expect, it } from 'vitest';
import type { FormBody } from '../../contracts/forms';
import { startAutosave } from './autosave';
import { activeRound, initialState, saveState } from './form-state';
import { createFormsStore, type FormsStore } from './forms-store';
import { presentedRound } from './test-rounds';
import type { Timers } from './timers';

const DELAY_MS = 400;

function fakeTimers() {
  let nextHandle = 1;
  const scheduled = new Map<number, { run: () => void; ms: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      scheduled.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      scheduled.delete(handle);
    },
  };
  const runDue = () => {
    const due = [...scheduled.values()];
    scheduled.clear();
    for (const timer of due) {
      timer.run();
    }
  };
  return { timers, scheduled, runDue };
}

function setup(save: (roundId: string, body: FormBody) => void) {
  const store = createFormsStore(initialState([presentedRound('r1')]));
  const clock = fakeTimers();
  const logs: string[] = [];
  startAutosave({
    store,
    save,
    delayMs: DELAY_MS,
    timers: clock.timers,
    log: (_source, message) => logs.push(message),
  });
  return { store, logs, ...clock };
}

function typeWhat(store: FormsStore, value: string) {
  store.dispatch({
    type: 'setText',
    roundId: 'r1',
    target: { field: 'what', question: 1 },
    value,
  });
}

function saveStateOf(store: FormsStore) {
  const round = activeRound(store.get());
  return round === null ? null : saveState(round);
}

describe('startAutosave', () => {
  it('saves once after edits pause, with the latest text', () => {
    const saves: { roundId: string; body: FormBody }[] = [];
    const { store, scheduled, runDue } = setup((roundId, body) =>
      saves.push({ roundId, body }),
    );

    typeWhat(store, 'a');
    typeWhat(store, 'ab');

    expect([...scheduled.values()].map((timer) => timer.ms)).toEqual([
      DELAY_MS,
    ]);
    runDue();
    expect(saves).toHaveLength(1);
    expect(saves[0].roundId).toBe('r1');
    expect(saves[0].body.answers[0].what).toBe('ab');
    expect(saveStateOf(store)).toBe('saved');
  });

  it('schedules nothing for navigation', () => {
    const { store, scheduled } = setup(() => {});

    store.dispatch({ type: 'nextItem' });

    expect(scheduled.size).toBe(0);
  });

  it('logs a failed save, stays unsaved, and waits for the next edit', () => {
    const { store, logs, scheduled, runDue } = setup(() => {
      throw new Error('window gone');
    });

    typeWhat(store, 'a');
    runDue();

    expect(logs).toEqual(['draft not saved for r1: window gone']);
    expect(saveStateOf(store)).toBe('unsaved');
    expect(scheduled.size).toBe(0);
    typeWhat(store, 'ab');
    expect(scheduled.size).toBe(1);
  });

  it("drops a closed round's pending save", () => {
    let saves = 0;
    const { store, scheduled, runDue } = setup(() => saves++);

    typeWhat(store, 'a');
    store.dispatch({ type: 'roundClosed', roundId: 'r1' });

    expect(scheduled.size).toBe(0);
    runDue();
    expect(saves).toBe(0);
  });
});
