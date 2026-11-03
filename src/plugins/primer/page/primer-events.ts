import type { PluginLog } from '../../../contracts/log';
import { startFormEvents } from '../../../shared/page/session-forms';
import type { PresentedPrimer, PrimerPageEvents } from '../contract';
import { buildBody, type OpenPrimer, type PrimerState } from './primer-state';
import type { PrimerStore } from './primer-store';

// One primer page event with its payload, as `api.events.emit` takes them.
export type PrimerPageEvent = {
  [K in keyof PrimerPageEvents]: { name: K; data: PrimerPageEvents[K] };
}[keyof PrimerPageEvents];

// The events one change makes, in this order: a `primerShown` per primer
// `next` adds, in `next.forms` order; a `needChanged` per task of a primer in
// both whose need differs, in `entries` order (a task new in `next` makes
// none); a `primerFinished` per primer `next` drops.
export function primerEventsBetween(
  previous: PrimerState,
  next: PrimerState,
): PrimerPageEvent[] {
  const events: PrimerPageEvent[] = [];
  const previousPrimers = primersById(previous);
  const nextPrimers = primersById(next);
  for (const primer of next.forms) {
    if (!previousPrimers.has(primer.formId)) {
      events.push({ name: 'primerShown', data: presentedOf(primer) });
    }
  }
  for (const primer of next.forms) {
    const before = previousPrimers.get(primer.formId);
    if (before !== undefined && before !== primer) {
      events.push(...needChanges(before, primer));
    }
  }
  for (const primer of previous.forms) {
    if (!nextPrimers.has(primer.formId)) {
      events.push({
        name: 'primerFinished',
        data: {
          primerId: primer.formId,
          outcome: primer.sending?.kind ?? 'closed',
        },
      });
    }
  }
  return events;
}

// Emits the events of each store change, queued as startFormEvents queues
// them.
export function startPrimerEvents(
  store: PrimerStore,
  emit: (event: PrimerPageEvent) => void,
): void {
  startFormEvents(store, primerEventsBetween, emit);
}

// Logs each event's line, source `primer`: `event primerShown <primerId>`,
// `event needChanged <primerId> <entryId> <need>`, `event primerFinished
// <primerId> <outcome>`.
export function createPrimerEventLog(
  log: PluginLog,
): (event: PrimerPageEvent) => void {
  return (event) => {
    switch (event.name) {
      case 'primerShown':
        log(`event primerShown ${event.data.formId}`);
        return;
      case 'needChanged': {
        const { primerId, entryId, need } = event.data;
        log(`event needChanged ${primerId} ${entryId} ${need}`);
        return;
      }
      case 'primerFinished':
        log(
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
    formId: primer.formId,
    sessionId: primer.sessionId,
    label: primer.label,
    form: primer.primer,
    draft: buildBody(primer),
  };
}

function primersById(state: PrimerState): Map<string, OpenPrimer> {
  return new Map(state.forms.map((primer) => [primer.formId, primer]));
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
      data: { primerId: after.formId, entryId: entry.id, need: entry.need },
    }));
}
