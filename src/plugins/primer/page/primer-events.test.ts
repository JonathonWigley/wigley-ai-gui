import { describe, expect, it, vi } from 'vitest';
import {
  createPrimerEventLog,
  type PrimerPageEvent,
  primerEventsBetween,
  presentedOf,
  startPrimerEvents,
} from './primer-events';
import {
  apply,
  initialState,
  type PrimerAction,
  type PrimerState,
} from './primer-state';
import { createPrimerStore } from './primer-store';
import { presentedPrimer, primerEntry, primerItem } from './test-primers';

const presented = presentedPrimer('p1', {
  entries: [
    primerEntry('3', 'primer', {
      need: 'no',
      items: [primerItem('Read the store')],
    }),
    primerEntry('s1', 'standing'),
  ],
});

function noPrimers(): PrimerState {
  return initialState([], presented.sessionId);
}

// Primer p1 open and active; tasks column rows: the feature (0), `3` (1),
// `s1` (2).
function openP1(): PrimerState {
  return apply(noPrimers(), { type: 'formShown', form: presented });
}

function applyAll(state: PrimerState, actions: PrimerAction[]): PrimerState {
  return actions.reduce(apply, state);
}

function names(events: PrimerPageEvent[]): string[] {
  return events.map((event) => event.name);
}

describe('primerEventsBetween', () => {
  it('primerEventsBetween_NewPrimer_EmitsPrimerShown', () => {
    const before = noPrimers();
    const after = openP1();

    expect(primerEventsBetween(before, after)).toEqual([
      { name: 'primerShown', data: presentedOf(after.forms[0]) },
    ]);
  });

  it('primerEventsBetween_NeedNoToYes_EmitsNeedChanged', () => {
    const before = apply(openP1(), { type: 'selectTask', row: 1 });
    const after = apply(before, { type: 'setNeed', need: 'yes' });

    expect(primerEventsBetween(before, after)).toEqual([
      {
        name: 'needChanged',
        data: { primerId: 'p1', entryId: '3', need: 'yes' },
      },
    ]);
  });

  it('primerEventsBetween_TextEdit_EmitsNothing', () => {
    const before = openP1();
    const after = apply(before, {
      type: 'setText',
      formId: 'p1',
      target: { field: 'taskComment', entryId: '3' },
      value: 'a comment',
    });

    expect(after).not.toBe(before);
    expect(primerEventsBetween(before, after)).toEqual([]);
  });

  it('primerEventsBetween_ExtraTaskAdded_EmitsNothing', () => {
    const before = openP1();
    const after = apply(before, { type: 'addExtraTask' });

    expect(after.forms[0].entries).toHaveLength(3);
    expect(primerEventsBetween(before, after)).toEqual([]);
  });

  it('primerEventsBetween_DroppedWhileSendingSubmit_EmitsSubmitted', () => {
    const sending = apply(openP1(), {
      type: 'sendStarted',
      formId: 'p1',
      kind: 'submitted',
    });
    const closed = apply(sending, { type: 'formClosed', formId: 'p1' });

    expect(primerEventsBetween(sending, closed)).toEqual([
      {
        name: 'primerFinished',
        data: { primerId: 'p1', outcome: 'submitted' },
      },
    ]);
  });

  it('primerEventsBetween_DroppedWithNoSend_EmitsClosed', () => {
    const before = openP1();
    const after = apply(before, { type: 'formClosed', formId: 'p1' });

    expect(primerEventsBetween(before, after)).toEqual([
      { name: 'primerFinished', data: { primerId: 'p1', outcome: 'closed' } },
    ]);
  });
});

describe('presentedOf', () => {
  it('presentedOf_EditedPrimer_DraftIsTheCurrentBody', () => {
    const edited = applyAll(openP1(), [
      { type: 'selectTask', row: 1 },
      { type: 'setNeed', need: 'yes' },
    ]);

    const shown = presentedOf(edited.forms[0]);

    expect(shown.form).toEqual(presented.form);
    expect(shown.draft?.entries[0].need).toBe('yes');
  });
});

describe('startPrimerEvents', () => {
  it('startPrimerEvents_ListenerDispatches_EmitsItsEventsAfterTheOuterChange', () => {
    const store = createPrimerStore(
      apply(openP1(), { type: 'selectTask', row: 1 }),
    );
    const emitted: PrimerPageEvent[] = [];
    // Records each event once its own dispatch returned, so an event emitted
    // inside that dispatch would land first.
    startPrimerEvents(store, (event) => {
      if (event.name === 'needChanged' && event.data.need === 'unclear') {
        store.dispatch({ type: 'setNeed', need: 'yes' });
      }
      emitted.push(event);
    });

    store.dispatch({ type: 'setNeed', need: 'unclear' });

    expect(names(emitted)).toEqual(['needChanged', 'needChanged']);
    expect(emitted.map((event) => event.data)).toEqual([
      { primerId: 'p1', entryId: '3', need: 'unclear' },
      { primerId: 'p1', entryId: '3', need: 'yes' },
    ]);
  });
});

describe('createPrimerEventLog', () => {
  it('primerEventLog_EachEvent_LogsOneLineNamingItsData', () => {
    const log = vi.fn();
    const logEvent = createPrimerEventLog(log);

    logEvent({ name: 'primerShown', data: presented });
    logEvent({
      name: 'needChanged',
      data: { primerId: 'p1', entryId: '3', need: 'yes' },
    });
    logEvent({
      name: 'primerFinished',
      data: { primerId: 'p1', outcome: 'cancelled' },
    });

    const lines = log.mock.calls.map(([source, line]) => ({
      source,
      words: String(line).split(' '),
    }));
    expect(lines).toEqual([
      {
        source: 'primer',
        words: expect.arrayContaining(['primerShown', 'p1']),
      },
      {
        source: 'primer',
        words: expect.arrayContaining(['needChanged', 'p1', '3', 'yes']),
      },
      {
        source: 'primer',
        words: expect.arrayContaining(['primerFinished', 'p1', 'cancelled']),
      },
    ]);
  });
});
