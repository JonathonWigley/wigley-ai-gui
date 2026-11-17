import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { Timers } from '../../../contracts/ambient';
import { saveState } from '../../../shared/page/autosave';
import { createReducerStore } from '../../../shared/page/reducer-store';
import type { FormBody } from '../contract';
import { startRoundAutosave } from './autosave';
import type { FormsStore } from './form-state';
import { apply, initialState, presentedRound } from './test-rounds';

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

function setup(
  save: (roundId: string, body: FormBody) => Promise<void>,
  delayMs: () => number = () => DELAY_MS,
) {
  const store = createReducerStore(
    initialState([presentedRound('r1')], 'r1-session'),
    apply,
  );
  const clock = fakeTimers();
  const logs: string[] = [];
  const pageHide = fakePageHide();
  const autosave = startRoundAutosave({
    store,
    save,
    delayMs,
    onPageHide: pageHide.onPageHide,
    timers: clock.timers,
    log: (message: string) => logs.push(message),
  });
  return { store, logs, autosave, pageHide, ...clock };
}

// A page hide the test fires by hand.
function fakePageHide() {
  const listeners = new Set<() => void>();
  return {
    onPageHide: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    fire: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

// A save whose promise the test settles by hand.
function heldSaves() {
  const calls: {
    body: FormBody;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  const save = (_roundId: string, body: FormBody) =>
    new Promise<void>((resolve, reject) =>
      calls.push({ body, resolve, reject }),
    );
  return { calls, save };
}

// Lets the awaited save settle and autosave's continuation run.
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function typeNotes(store: FormsStore, value: string, formId = 'r1') {
  store.dispatch({
    type: 'setText',
    formId,
    target: { field: 'notes', item: { kind: 'question', index: 1 } },
    value,
  });
}

function saveStateOf(store: FormsStore) {
  const round = activeForm(store.get());
  return round === null ? null : saveState(round);
}

function saveErrorOf(store: FormsStore) {
  return activeForm(store.get())?.saveError;
}

describe('startRoundAutosave', () => {
  it('saves once after edits pause, with the latest text', async () => {
    const saves: { roundId: string; body: FormBody }[] = [];
    const { store, scheduled, runDue } = setup(async (roundId, body) => {
      saves.push({ roundId, body });
    });

    typeNotes(store, 'a');
    typeNotes(store, 'ab');

    expect([...scheduled.values()].map((timer) => timer.ms)).toEqual([
      DELAY_MS,
    ]);
    runDue();
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0].roundId).toBe('r1');
    expect(saves[0].body.answers[0].notes).toBe('ab');
    expect(saveStateOf(store)).toBe('saved');
  });

  it('shows saving until the save resolves', async () => {
    const { calls, save } = heldSaves();
    const { store, runDue } = setup(save);

    typeNotes(store, 'a');
    runDue();
    expect(saveStateOf(store)).toBe('saving');

    calls[0].resolve();
    await settle();
    expect(saveStateOf(store)).toBe('saved');
  });

  it('schedules nothing for navigation', () => {
    const { store, scheduled } = setup(async () => {});

    store.dispatch({ type: 'nextItem' });

    expect(scheduled.size).toBe(0);
  });

  it('cancels every pending save and schedules none once disposed', () => {
    const { store, autosave, scheduled } = setup(async () => {});

    typeNotes(store, 'a');
    expect(scheduled.size).toBe(1);
    autosave.dispose();
    expect(scheduled.size).toBe(0);
    typeNotes(store, 'ab');

    expect(scheduled.size).toBe(0);
  });

  it('dispatches nothing for a save resolved after dispose', async () => {
    const { calls, save } = heldSaves();
    const { store, logs, autosave, runDue } = setup(save);
    typeNotes(store, 'a');
    runDue();

    autosave.dispose();
    calls[0].resolve();
    await settle();

    expect(logs).toEqual([]);
    expect(saveStateOf(store)).toBe('saving');
  });

  it('logs a save rejected after dispose and dispatches nothing', async () => {
    const { calls, save } = heldSaves();
    const { store, logs, autosave, runDue } = setup(save);
    typeNotes(store, 'a');
    runDue();

    autosave.dispose();
    calls[0].reject(new Error('disk full'));
    await settle();

    expect(logs).toEqual([expect.stringMatching(/r1.*disk full/)]);
    expect(saveErrorOf(store)).toBeNull();
  });

  it('keeps a failed save unsaved with its message, until the next edit', async () => {
    const { store, logs, scheduled, runDue } = setup(async () => {
      throw new Error('disk full');
    });

    typeNotes(store, 'a');
    runDue();
    await settle();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/r1.*disk full/);
    expect(saveStateOf(store)).toBe('unsaved');
    expect(saveErrorOf(store)).toBe('disk full');
    expect(scheduled.size).toBe(0);
    typeNotes(store, 'ab');
    expect(scheduled.size).toBe(1);
  });

  it('clears the message when the next save starts', async () => {
    let shouldFail = true;
    const { calls, save } = heldSaves();
    const { store, runDue } = setup((roundId, body) =>
      shouldFail ? Promise.reject(new Error('disk full')) : save(roundId, body),
    );
    typeNotes(store, 'a');
    runDue();
    await settle();
    shouldFail = false;

    typeNotes(store, 'ab');
    runDue();

    expect(saveErrorOf(store)).toBeNull();
    calls[0].resolve();
    await settle();
    expect(saveStateOf(store)).toBe('saved');
  });

  it('saves an edit made during a save once that edit pauses', async () => {
    const { calls, save } = heldSaves();
    const { store, scheduled, runDue } = setup(save);
    typeNotes(store, 'a');
    runDue();

    typeNotes(store, 'ab');
    calls[0].resolve();
    await settle();

    expect(saveStateOf(store)).toBe('unsaved');
    expect(scheduled.size).toBe(1);
    runDue();
    calls[1].resolve();
    await settle();
    expect(calls.map((call) => call.body.answers[0].notes)).toEqual([
      'a',
      'ab',
    ]);
    expect(saveStateOf(store)).toBe('saved');
  });

  it("drops a closed round's pending save", () => {
    let saves = 0;
    const { store, scheduled, runDue } = setup(async () => {
      saves++;
    });

    typeNotes(store, 'a');
    store.dispatch({ type: 'formClosed', formId: 'r1' });

    expect(scheduled.size).toBe(0);
    runDue();
    expect(saves).toBe(0);
  });

  it('reads the delay when it schedules a save', async () => {
    let delayMs = 200;
    const { store, scheduled, runDue } = setup(
      async () => {},
      () => delayMs,
    );
    typeNotes(store, 'a');
    expect([...scheduled.values()].map((timer) => timer.ms)).toEqual([200]);
    runDue();
    await settle();

    delayMs = 50;
    typeNotes(store, 'ab');

    expect([...scheduled.values()].map((timer) => timer.ms)).toEqual([50]);
  });

  it('pagehide_saves_every_unsaved_draft_synchronously', () => {
    const { calls, save } = heldSaves();
    const { store, scheduled, pageHide } = setup(save);
    store.dispatch({ type: 'formShown', form: presentedRound('r2') });
    typeNotes(store, 'a');
    typeNotes(store, 'b', 'r2');

    pageHide.fire();

    expect(calls.map((call) => call.body.answers[0].notes)).toEqual(['a', 'b']);
    expect(scheduled.size).toBe(0);
  });

  it('pagehide_leaves_a_saved_draft_and_a_saving_revision_alone', async () => {
    const { calls, save } = heldSaves();
    const { store, pageHide, runDue } = setup(save);
    store.dispatch({ type: 'formShown', form: presentedRound('r2') });
    typeNotes(store, 'a');
    typeNotes(store, 'b', 'r2');
    runDue();
    calls[1].resolve();
    await settle();

    pageHide.fire();

    expect(calls).toHaveLength(2);
  });

  it('dispose_stops_the_pagehide_listener', () => {
    const { calls, save } = heldSaves();
    const { store, autosave, pageHide } = setup(save);
    typeNotes(store, 'a');

    autosave.dispose();
    pageHide.fire();

    expect(calls).toHaveLength(0);
  });
});
