import { describe, expect, it, vi } from 'vitest';
import {
  apply,
  buildBody,
  type FormsAction,
  type FormsState,
  type FormsStore,
  initialState,
} from './form-state';
import {
  createFormsEventLog,
  type FormsPageEvent,
  formsEventsBetween,
  startFormsEvents,
} from './forms-events';
import { presentedRound } from './test-rounds';

const presented = presentedRound('r1');

function noRounds(): FormsState {
  return initialState([], presented.sessionId);
}

// Round r1 open and active, in the forms view.
function openR1(): FormsState {
  return apply(noRounds(), { type: 'formShown', form: presented });
}

function names(events: FormsPageEvent[]): string[] {
  return events.map((event) => event.name);
}

// A store over `apply` with no other listeners.
function fakeStore(initial: FormsState): FormsStore {
  let state = initial;
  const listeners: (() => void)[] = [];
  return {
    get: () => state,
    dispatch(action: FormsAction) {
      const next = apply(state, action);
      if (next !== state) {
        state = next;
        listeners.forEach((listener) => listener());
      }
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
  };
}

describe('formsEventsBetween', () => {
  it('formsEventsBetween_NewRound_EmitsRoundShownOnly', () => {
    // Another session shows, so the new round does not change the view.
    const before = initialState([], 'other-session');
    const after = apply(before, { type: 'formShown', form: presented });

    const events = formsEventsBetween(before, after);

    expect(events).toEqual([
      {
        name: 'roundShown',
        data: {
          roundId: presented.roundId,
          sessionId: presented.sessionId,
          label: presented.label,
          round: presented.round,
        },
      },
    ]);
  });

  it('formsEventsBetween_SameRoundAgain_EmitsNothing', () => {
    const state = openR1();

    const again = apply(state, { type: 'formShown', form: presented });

    expect(again).toBe(state);
    expect(formsEventsBetween(state, state)).toEqual([]);
  });

  it('formsEventsBetween_Choose_EmitsAnswerChanged', () => {
    const before = openR1();
    const after = apply(before, { type: 'choose', number: 2 });

    expect(formsEventsBetween(before, after)).toEqual([
      {
        name: 'answerChanged',
        data: {
          roundId: 'r1',
          item: { kind: 'question', index: 1 },
          status: 'answered',
        },
      },
    ]);
  });

  it('formsEventsBetween_NotesText_EmitsAnswerChanged', () => {
    const before = openR1();
    const after = apply(before, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 1 } },
      value: '  ',
    });

    const events = formsEventsBetween(before, after);

    expect(events).toEqual([
      {
        name: 'answerChanged',
        data: {
          roundId: 'r1',
          item: { kind: 'question', index: 1 },
          status: 'untouched',
        },
      },
    ]);
  });

  it('formsEventsBetween_RoundNoteText_EmitsNothing', () => {
    const before = openR1();
    const after = apply(before, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'note' },
      value: 'about the round',
    });

    expect(after).not.toBe(before);
    expect(formsEventsBetween(before, after)).toEqual([]);
  });

  it('formsEventsBetween_FinishedRoundCloses_EmitsRoundFinishedBeforeViewChanged', () => {
    const answered = apply(openR1(), { type: 'choose', number: 1 });
    const sending = apply(answered, {
      type: 'sendStarted',
      formId: 'r1',
      kind: 'submitted',
    });
    const closed = apply(sending, { type: 'formClosed', formId: 'r1' });

    const events = formsEventsBetween(sending, closed);

    expect(names(events)).toEqual(['roundFinished', 'viewChanged']);
    expect(events[0]).toEqual({
      name: 'roundFinished',
      data: {
        roundId: 'r1',
        sessionId: presented.sessionId,
        outcome: 'submitted',
        body: buildBody(sending.forms[0]),
      },
    });
  });

  it('formsEventsBetween_MainClosesRound_EmitsClosed', () => {
    const before = openR1();
    const after = apply(before, { type: 'formClosed', formId: 'r1' });

    const finished = formsEventsBetween(before, after).find(
      (event) => event.name === 'roundFinished',
    );

    expect(finished?.data).toMatchObject({ outcome: 'closed' });
  });

  it('formsEventsBetween_OpenReview_EmitsViewChanged', () => {
    const before = openR1();
    const after = apply(before, { type: 'openReview' });

    expect(formsEventsBetween(before, after)).toEqual([
      { name: 'viewChanged', data: { view: 'review', roundId: 'r1' } },
    ]);
  });
});

describe('startFormsEvents', () => {
  it('startFormsEvents_DiffsEachChangeAgainstTheLast', () => {
    const store = fakeStore(noRounds());
    const emitted: FormsPageEvent[] = [];
    startFormsEvents(store, (event) => emitted.push(event));

    store.dispatch({ type: 'formShown', form: presented });
    const afterShown = emitted.length;
    store.dispatch({ type: 'choose', number: 1 });

    expect(names(emitted).filter((name) => name === 'roundShown')).toEqual([
      'roundShown',
    ]);
    expect(names(emitted.slice(afterShown))).toEqual(['answerChanged']);
  });

  it('startFormsEvents_ListenerDispatches_EmitsItsEventsAfterTheOuterChange', () => {
    const store = fakeStore(noRounds());
    const emitted: FormsPageEvent[] = [];
    startFormsEvents(store, (event) => {
      emitted.push(event);
      if (event.name === 'roundShown') {
        store.dispatch({ type: 'openReview' });
      }
    });

    store.dispatch({ type: 'formShown', form: presented });

    expect(emitted).toEqual([
      expect.objectContaining({ name: 'roundShown' }),
      { name: 'viewChanged', data: { view: 'forms', roundId: 'r1' } },
      { name: 'viewChanged', data: { view: 'review', roundId: 'r1' } },
    ]);
  });
});

describe('createFormsEventLog', () => {
  it('formsEventLog_NotesEditKeepingStatusAndPick_LogsNoAnswerLine', () => {
    const store = fakeStore(noRounds());
    const log = vi.fn();
    const logEvent = createFormsEventLog(store.get, log);
    startFormsEvents(store, logEvent);

    store.dispatch({ type: 'formShown', form: presented });
    store.dispatch({
      type: 'setText',
      formId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 2 } },
      value: ' ',
    });
    store.dispatch({ type: 'choose', number: 2 });

    expect(log.mock.calls.map(([, line]) => line)).toEqual([
      'event roundShown r1',
      'event viewChanged forms r1',
      'event answerChanged r1 question 1 responded',
    ]);
  });
});
