import type { Log } from '../../../contracts/log';
import { formById, startFormEvents } from '../../../shared/page/session-forms';
import type { AnswerStatus, FormsPageEvents, OpenRound } from '../contract';
import {
  type AnswerableItem,
  answerableItems,
  answerStatus,
  buildBody,
  type FormsState,
  type FormsStore,
  itemAnswer,
  pickNumber,
  type RoundState,
} from './form-state';

// One forms page event with its payload, as `api.events.emit` takes them.
export type FormsPageEvent = {
  [K in keyof FormsPageEvents]: { name: K; data: FormsPageEvents[K] };
}[keyof FormsPageEvents];

// The events one change from `previous` to `next` makes, in this order: a
// `roundShown` per round `next` adds, in `next.forms` order; an
// `answerChanged` per question or finding, in rail order, of a round in both
// whose answer differs in any field; a `roundFinished` per round `next`
// drops, with the answers it left with; and one `viewChanged` when the view
// or the active round differs.
export function formsEventsBetween(
  previous: FormsState,
  next: FormsState,
): FormsPageEvent[] {
  const events: FormsPageEvent[] = [];
  const previousRounds = roundsById(previous);
  const nextRounds = roundsById(next);
  for (const round of next.forms) {
    if (!previousRounds.has(round.formId)) {
      events.push({ name: 'roundShown', data: openRoundOf(round) });
    }
  }
  for (const round of next.forms) {
    const before = previousRounds.get(round.formId);
    if (before !== undefined && before !== round) {
      events.push(...answerChanges(before, round));
    }
  }
  for (const round of previous.forms) {
    if (!nextRounds.has(round.formId)) {
      events.push({ name: 'roundFinished', data: finishOf(round) });
    }
  }
  const isViewChanged =
    previous.view !== next.view || previous.activeFormId !== next.activeFormId;
  if (isViewChanged) {
    events.push({
      name: 'viewChanged',
      data: { view: next.view, roundId: next.activeFormId },
    });
  }
  return events;
}

// Emits the events of each store change, queued as startFormEvents queues
// them.
export function startFormsEvents(
  store: FormsStore,
  emit: (event: FormsPageEvent) => void,
): void {
  startFormEvents(store, formsEventsBetween, emit);
}

// Logs each event's line, source `forms`: `event roundShown <roundId>`,
// `event answerChanged <roundId> <kind> <index> <status>` with `answered`
// written `responded` (`answerStatus`),
// `event roundFinished <roundId> <outcome>`, `event viewChanged <view>
// <roundId or none>`. An `answerChanged` logs only when the item's status or
// pick, read from `getState` as the event fires, differs from what its round
// showed with or last logged, so a notes edit that changes neither logs
// nothing.
export function createFormsEventLog(
  getState: () => FormsState,
  log: Log,
): (event: FormsPageEvent) => void {
  // Each item's last status and pick, keyed `<roundId> <kind> <index>`.
  const shown = new Map<string, string>();
  return (event) => {
    switch (event.name) {
      case 'roundShown': {
        const round = formById(getState(), event.data.roundId);
        if (round !== undefined) {
          for (const item of answerableItems(round.round)) {
            shown.set(itemKey(round.formId, item), statusAndPick(round, item));
          }
        }
        log('forms', `event roundShown ${event.data.roundId}`);
        return;
      }
      case 'answerChanged': {
        const { roundId, item } = event.data;
        const round = formById(getState(), roundId);
        const key = itemKey(roundId, item);
        // Undefined only when a listener's own dispatch already closed it.
        const now =
          round === undefined ? undefined : statusAndPick(round, item);
        if (now === undefined || shown.get(key) === now) {
          return;
        }
        shown.set(key, now);
        log(
          'forms',
          `event answerChanged ${roundId} ${item.kind} ${item.index} ${loggedStatus(event.data.status)}`,
        );
        return;
      }
      case 'roundFinished': {
        const prefix = `${event.data.roundId} `;
        for (const key of shown.keys()) {
          if (key.startsWith(prefix)) {
            shown.delete(key);
          }
        }
        log(
          'forms',
          `event roundFinished ${event.data.roundId} ${event.data.outcome}`,
        );
        return;
      }
      case 'viewChanged':
        log(
          'forms',
          `event viewChanged ${event.data.view} ${event.data.roundId ?? 'none'}`,
        );
        return;
    }
  };
}

function roundsById(state: FormsState): Map<string, RoundState> {
  return new Map(state.forms.map((round) => [round.formId, round]));
}

// The round as the forms page's exports and events name it.
export function openRoundOf(round: RoundState): OpenRound {
  return {
    roundId: round.formId,
    sessionId: round.sessionId,
    label: round.label,
    round: round.round,
  };
}

// An `answerChanged` per item, in rail order, whose answer differs between
// the two states of one round.
function answerChanges(
  before: RoundState,
  after: RoundState,
): FormsPageEvent[] {
  return answerableItems(after.round)
    .filter((item) => answersDiffer(before, after, item))
    .map((item) => ({
      name: 'answerChanged',
      data: {
        roundId: after.formId,
        item: { kind: item.kind, index: item.index },
        status: answerStatus(after, item),
      },
    }));
}

// Whether any field of the item's answer differs; answers hold only
// primitives.
function answersDiffer(
  before: RoundState,
  after: RoundState,
  item: AnswerableItem,
): boolean {
  const was: Record<string, unknown> = { ...itemAnswer(before, item) };
  const is: Record<string, unknown> = { ...itemAnswer(after, item) };
  return Object.keys(is).some((field) => was[field] !== is[field]);
}

// The round's `roundFinished`: the kind of the page's own send when its
// finish closed the round, else `closed` (a round main closes on its own has
// its send failed first).
function finishOf(round: RoundState): FormsPageEvents['roundFinished'] {
  return {
    roundId: round.formId,
    sessionId: round.sessionId,
    outcome: round.sending?.kind ?? 'closed',
    body: buildBody(round),
  };
}

// The page's `answered` counts notes alone, which the payload sends as
// untouched, so the log names it `responded`.
function loggedStatus(status: AnswerStatus): string {
  return status === 'answered' ? 'responded' : status;
}

function itemKey(roundId: string, item: AnswerableItem): string {
  return `${roundId} ${item.kind} ${item.index}`;
}

function statusAndPick(round: RoundState, item: AnswerableItem): string {
  return `${answerStatus(round, item)} ${pickNumber(round, item)}`;
}
