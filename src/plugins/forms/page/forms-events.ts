import type { Log } from '../../../contracts/log';
import type { FormsPageEvents, OpenRound } from '../contract';
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
// `roundShown` per round `next` adds, in `next.rounds` order; an
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
  for (const round of next.rounds) {
    if (!previousRounds.has(round.roundId)) {
      events.push({ name: 'roundShown', data: openRoundOf(round) });
    }
  }
  for (const round of next.rounds) {
    const before = previousRounds.get(round.roundId);
    if (before !== undefined && before !== round) {
      events.push(...answerChanges(before, round));
    }
  }
  for (const round of previous.rounds) {
    if (!nextRounds.has(round.roundId)) {
      events.push({ name: 'roundFinished', data: finishOf(round) });
    }
  }
  const isViewChanged =
    previous.view !== next.view ||
    previous.activeRoundId !== next.activeRoundId;
  if (isViewChanged) {
    events.push({
      name: 'viewChanged',
      data: { view: next.view, roundId: next.activeRoundId },
    });
  }
  return events;
}

// Emits the events of each store change, diffed against the state the last
// change left (the store's state at start for the first). A change a
// listener's own dispatch makes is diffed at once but queued, and its events
// go out after the events already queued, in change order, so the last event
// a host hears matches the state.
export function startFormsEvents(
  store: FormsStore,
  emit: (event: FormsPageEvent) => void,
): void {
  let previous = store.get();
  const queued: FormsPageEvent[] = [];
  let isEmitting = false;
  store.subscribe(() => {
    const next = store.get();
    queued.push(...formsEventsBetween(previous, next));
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

// Logs each event's line, source `forms`: `event roundShown <roundId>`,
// `event answerChanged <roundId> <kind> <index> <status>`,
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
        const round = heldRound(getState(), event.data.roundId);
        if (round !== undefined) {
          for (const item of answerableItems(round.round)) {
            shown.set(itemKey(round.roundId, item), statusAndPick(round, item));
          }
        }
        log('forms', `event roundShown ${event.data.roundId}`);
        return;
      }
      case 'answerChanged': {
        const { roundId, item } = event.data;
        const round = heldRound(getState(), roundId);
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
          `event answerChanged ${roundId} ${item.kind} ${item.index} ${event.data.status}`,
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
  return new Map(state.rounds.map((round) => [round.roundId, round]));
}

function heldRound(state: FormsState, roundId: string): RoundState | undefined {
  return state.rounds.find((round) => round.roundId === roundId);
}

// The round as the forms page's exports and events name it.
export function openRoundOf(round: RoundState): OpenRound {
  return {
    roundId: round.roundId,
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
        roundId: after.roundId,
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
    roundId: round.roundId,
    sessionId: round.sessionId,
    outcome: round.sending?.kind ?? 'closed',
    body: buildBody(round),
  };
}

function itemKey(roundId: string, item: AnswerableItem): string {
  return `${roundId} ${item.kind} ${item.index}`;
}

function statusAndPick(round: RoundState, item: AnswerableItem): string {
  return `${answerStatus(round, item)} ${pickNumber(round, item)}`;
}
