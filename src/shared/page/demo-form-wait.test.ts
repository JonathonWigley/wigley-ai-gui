import { describe, expect, it } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import { DEMO_FORM_WAIT_MS, showDemoForm } from './demo-form-wait';
import type { SessionForm, SessionFormsState } from './session-forms';

function formOf(sessionId: string): SessionForm {
  return {
    formId: `form-${sessionId}`,
    sessionId,
    label: sessionId,
    sending: null,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
  };
}

function stateWithActive(
  sessionId: string,
): SessionFormsState<SessionForm, string> {
  const form = formOf(sessionId);
  return {
    forms: [form],
    activeFormId: form.formId,
    activeSessionId: sessionId,
    view: 'forms',
    confirmReturnView: 'review',
  };
}

// A store whose state the test sets, counting live subscriptions.
function fakeStore(initial: SessionFormsState<SessionForm, string>) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    set(next: SessionFormsState<SessionForm, string>) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    liveSubscriptions: () => listeners.size,
  };
}

// Timers run by hand as `advance` moves the clock.
function handTimers() {
  const pending = new Map<number, { run: () => void; dueAt: number }>();
  let now = 0;
  let lastHandle = 0;
  const timers: Timers = {
    set(run, ms) {
      lastHandle += 1;
      pending.set(lastHandle, { run, dueAt: now + ms });
      return lastHandle;
    },
    clear(handle) {
      pending.delete(handle);
    },
  };
  return {
    timers,
    live: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [handle, { run, dueAt }] of pending) {
        if (dueAt <= now) {
          pending.delete(handle);
          run();
        }
      }
    },
  };
}

describe('showDemoForm', () => {
  it.each([
    {
      name: 'the form is active already',
      result: true,
      initial: 's1',
      act: () => undefined,
    },
    {
      name: 'the form becomes active',
      result: true,
      initial: 'other',
      act: (
        store: ReturnType<typeof fakeStore>,
        time: ReturnType<typeof handTimers>,
      ) => {
        time.advance(DEMO_FORM_WAIT_MS - 1);
        store.set(stateWithActive('s1'));
      },
    },
    {
      name: 'the form never shows',
      result: false,
      initial: 'other',
      act: (
        store: ReturnType<typeof fakeStore>,
        time: ReturnType<typeof handTimers>,
      ) => {
        store.set(stateWithActive('another'));
        time.advance(DEMO_FORM_WAIT_MS);
      },
    },
  ])('resolves $result when $name', async ({ result, initial, act }) => {
    const store = fakeStore(stateWithActive(initial));
    const time = handTimers();
    const activated: string[] = [];

    const shown = showDemoForm(
      {
        store,
        activate: (sessionId) => activated.push(sessionId),
        timers: time.timers,
      },
      's1',
    );
    act(store, time);

    await expect(shown).resolves.toBe(result);
    expect(activated).toEqual(['s1']);
    expect(store.liveSubscriptions()).toBe(0);
    expect(time.live()).toBe(0);
  });
});
