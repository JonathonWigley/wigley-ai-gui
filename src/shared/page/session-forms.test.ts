import { describe, expect, it } from 'vitest';
import { createReducerStore } from './reducer-store';
import {
  finishActiveForm,
  type SessionForm,
  type SessionFormsAction,
  type SessionFormsState,
  sessionPaneView,
  startFormEvents,
} from './session-forms';

function form(formId: string): SessionForm {
  return {
    formId,
    sessionId: `${formId}-session`,
    label: formId,
    sending: null,
    revision: 0,
    savedRevision: 0,
    savingRevision: null,
    saveError: null,
  };
}

// Forms a and b open, a active in `view`; a cancel prompt returns to the
// review.
function state(
  view: SessionFormsState<SessionForm, 'edit'>['view'],
  activeSessionId: string | null = 'a-session',
): SessionFormsState<SessionForm, 'edit'> {
  return {
    forms: [form('a'), form('b')],
    activeFormId: activeSessionId === 'a-session' ? 'a' : null,
    activeSessionId,
    view,
    confirmReturnView: 'review',
  };
}

describe('sessionPaneView', () => {
  it.each<{
    name: string;
    given: SessionFormsState<SessionForm, 'edit'>;
    sessionId: string;
    drawn: 'edit' | 'review' | 'idle';
  }>([
    {
      name: 'the active session in its view',
      given: state('review'),
      sessionId: 'a-session',
      drawn: 'review',
    },
    {
      name: 'the active session under the cancel prompt',
      given: state('confirm'),
      sessionId: 'a-session',
      drawn: 'review',
    },
    {
      name: 'an unfocused session in the form view',
      given: state('review'),
      sessionId: 'b-session',
      drawn: 'edit',
    },
    {
      name: 'a session open with an empty pane focused',
      given: state('idle', null),
      sessionId: 'b-session',
      drawn: 'edit',
    },
    {
      name: 'a session with no form',
      given: state('review'),
      sessionId: 'c-session',
      drawn: 'idle',
    },
  ])('draws $name', ({ given, sessionId, drawn }) => {
    expect(sessionPaneView(given, sessionId, 'edit')).toBe(drawn);
  });
});

describe('startFormEvents', () => {
  it('emits nothing for a store change once disposed', () => {
    const store = createReducerStore(0, (_count, next: number) => next);
    const emitted: number[] = [];
    const events = startFormEvents(
      store,
      (previous, next) => [next - previous],
      (event) => emitted.push(event),
    );
    store.dispatch(2);

    events.dispose();
    store.dispatch(5);

    expect(emitted).toEqual([2]);
  });
});

describe('finishActiveForm', () => {
  it('dispatches, logs and toasts nothing when the finish rejects after the part stopped', async () => {
    let rejectFinish = (_error: Error) => undefined as void;
    const dispatched: SessionFormsAction<never>['type'][] = [];
    const lines: string[] = [];
    let isStopped = false;

    finishActiveForm(
      {
        store: {
          get: () => state('review'),
          dispatch: (action) => dispatched.push(action.type),
        },
        words: { noun: 'round', sent: 'Answers sent' },
        toast: (text) => lines.push(text),
        log: (line) => lines.push(line),
        finish: () =>
          new Promise<void>((_resolve, reject) => {
            rejectFinish = reject;
          }),
        bodyOf: () => ({}),
        isStopped: () => isStopped,
      },
      'review',
      'submitted',
    );
    isStopped = true;
    rejectFinish(new Error('main kept the round'));
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toEqual(['sendStarted']);
    expect(lines).toEqual([]);
  });
});
