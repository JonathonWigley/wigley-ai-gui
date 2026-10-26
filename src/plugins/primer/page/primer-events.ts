import type { Log } from '../../../contracts/log';
import type { PresentedPrimer, PrimerPageEvents } from '../contract';
import { buildBody, type OpenPrimer, type PrimerState } from './primer-state';
import type { PrimerStore } from './primer-store';

// One primer page event with its payload, as `api.events.emit` takes them.
export type PrimerPageEvent = {
  [K in keyof PrimerPageEvents]: { name: K; data: PrimerPageEvents[K] };
}[keyof PrimerPageEvents];

const SOURCE = 'primer';

// The events one change makes, in this order: a `primerShown` per primer
// `next` adds, in `next.primers` order; a `needChanged` per task of a primer in
// both whose need differs, in `entries` order (a task new in `next` makes
// none); a `primerFinished` per primer `next` drops.
export function primerEventsBetween(
  previous: PrimerState,
  next: PrimerState,
): PrimerPageEvent[] {
  const events: PrimerPageEvent[] = [];
  const previousPrimers = primersById(previous);
  const nextPrimers = primersById(next);
  for (const primer of next.primers) {
    if (!previousPrimers.has(primer.primerId)) {
      events.push({ name: 'primerShown', data: presentedOf(primer) });
    }
  }
  for (const primer of next.primers) {
    const before = previousPrimers.get(primer.primerId);
    if (before !== undefined && before !== primer) {
      events.push(...needChanges(before, primer));
    }
  }
  for (const primer of previous.primers) {
    if (!nextPrimers.has(primer.primerId)) {
      events.push({
        name: 'primerFinished',
        data: {
          primerId: primer.primerId,
          outcome: primer.sending?.kind ?? 'closed',
        },
      });
    }
  }
  return events;
}

// Emits the events of each store change, diffed against the state the last
// change left (the store's state at start for the first). A change a
// listener's own dispatch makes is diffed at once but queued, and its events
// go out after the events already queued, in change order, so the last event
// a host hears matches the state.
export function startPrimerEvents(
  store: PrimerStore,
  emit: (event: PrimerPageEvent) => void,
): void {
  let previous = store.get();
  const queued: PrimerPageEvent[] = [];
  let isEmitting = false;
  store.subscribe(() => {
    const next = store.get();
    queued.push(...primerEventsBetween(previous, next));
    previous = next;
    if (isEmitting) {
      return;
    }
    isEmitting = true;
    try {
      for (
        let event = queued.shift();
        event !== undefined;
        event = queued.shift()
      ) {
        emit(event);
      }
    } finally {
      queued.length = 0;
      isEmitting = false;
    }
  });
}

// Logs each event's line, source `primer`: `event primerShown <primerId>`,
// `event needChanged <primerId> <entryId> <need>`, `event primerFinished
// <primerId> <outcome>`.
export function createPrimerEventLog(
  log: Log,
): (event: PrimerPageEvent) => void {
  return (event) => {
    switch (event.name) {
      case 'primerShown':
        log(SOURCE, `event primerShown ${event.data.formId}`);
        return;
      case 'needChanged': {
        const { primerId, entryId, need } = event.data;
        log(SOURCE, `event needChanged ${primerId} ${entryId} ${need}`);
        return;
      }
      case 'primerFinished':
        log(
          SOURCE,
          `event primerFinished ${event.data.primerId} ${event.data.outcome}`,
        );
        return;
    }
  };
}

// The primer as the export and `primerShown` name it: `form` as sent, `draft`
// the user's current body.
export function presentedOf(primer: OpenPrimer): PresentedPrimer {
  return {
    formId: primer.primerId,
    sessionId: primer.sessionId,
    label: primer.label,
    form: primer.primer,
    draft: buildBody(primer),
  };
}

function primersById(state: PrimerState): Map<string, OpenPrimer> {
  return new Map(state.primers.map((primer) => [primer.primerId, primer]));
}

// A `needChanged` per task of `after`, in `entries` order, that `before` also
// holds with another need.
function needChanges(before: OpenPrimer, after: OpenPrimer): PrimerPageEvent[] {
  const needsBefore = new Map(
    before.entries.map((entry) => [entry.id, entry.need]),
  );
  return after.entries
    .filter((entry) => {
      const was = needsBefore.get(entry.id);
      return was !== undefined && was !== entry.need;
    })
    .map((entry) => ({
      name: 'needChanged',
      data: { primerId: after.primerId, entryId: entry.id, need: entry.need },
    }));
}
