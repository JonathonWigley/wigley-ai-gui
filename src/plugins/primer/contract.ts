import type { CommandKey } from '../../contracts/commands';
import type {
  AgentFormInvoke,
  AgentFormMessages,
  PresentedAgentForm,
} from '../../contracts/agent-forms';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';

// The feature primer's shapes: the open_primer call, the body the page sends
// back, the payload both tools return, and the page part's events and exports.

export type PrimerNeed = 'yes' | 'no' | 'unclear';

// The needs in tally order of the old primer: yes, no, unclear.
export const PRIMER_NEEDS: readonly PrimerNeed[] = ['yes', 'no', 'unclear'];

// `extra` is a task the user added; the agent sends only `primer` and `standing`.
export type PrimerGroup = 'primer' | 'standing' | 'extra';

export interface PrimerItem {
  text: string;
  include: boolean;
  comment: string;
  // True for an item the user added.
  added: boolean;
}

export interface PrimerEntry {
  id: string;
  group: PrimerGroup;
  number: number | null;
  area: string;
  question: string;
  task: string;
  need: PrimerNeed;
  evidence: string;
  probes: string;
  pointer: string;
  comment: string;
  items: PrimerItem[];
}

export interface PrimerFeature {
  name: string;
  slug: string;
  spec: string;
  summary: string;
  // The user's notes on the whole feature.
  notes: string;
}

// The parsed open_primer call: the form the service shows.
export interface Primer {
  feature: PrimerFeature;
  entries: PrimerEntry[];
}

// What the page sends back and the file's `body` holds.
export interface PrimerBody {
  feature: PrimerFeature;
  entries: PrimerEntry[];
}

export type PrimerOutcome = 'submitted' | 'draft' | 'cancelled' | 'no_primer';

// `no_primer` carries no `feature` and no `entries`.
export interface PrimerPayload {
  outcome: PrimerOutcome;
  summary: string;
  next: string;
  feature?: PrimerFeature;
  entries?: PrimerEntry[];
  earlier_heading?: string;
}

export const PRIMER_ERROR_NAME = 'PrimerError';
// The saved-primer folder under the home.
export const SAVED_PRIMERS_FOLDER = '.agents/wigley-primer/primers';
export const PRIMER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PRIMER_ENTRIES = 60;
export const MAX_PRIMER_ITEMS = 20;

export type PresentedPrimer = PresentedAgentForm<Primer, PrimerBody>;
// The agent form channel, and `openPreview` from the preview key.
export interface PrimerChannel extends ChannelShape {
  invoke: AgentFormInvoke<Primer, PrimerBody> & {
    openPreview(): void;
  };
  messages: AgentFormMessages<Primer, PrimerBody>;
}

// The page part's views and events, and the exports other plugins read.
export type PrimerView = 'primer' | 'review' | 'confirm' | 'idle';
export type PrimerFinishOutcome = 'submitted' | 'cancelled' | 'closed';

export interface PrimerPageEvents extends EventShape {
  primerShown: PresentedPrimer;
  needChanged: { primerId: string; entryId: string; need: PrimerNeed };
  primerFinished: { primerId: string; outcome: PrimerFinishOutcome };
}

// Selects the tasks column row at the 0-based position in the task rows, as a
// click on the row does.
export const primerSelectTaskCommand: CommandKey<number, 'primer.selectTask'> =
  { id: 'primer.selectTask' };

// Selects the selected task's item of the 1-based number and flips its
// include, as a click on its row's mark does.
export const primerToggleIncludeAtCommand: CommandKey<
  number,
  'primer.toggleIncludeAt'
> = { id: 'primer.toggleIncludeAt' };

export interface PrimerPageExports {
  activePrimer(): PresentedPrimer | null;
}

export const primerPageKey: DependencyKey<PrimerPageExports, 'page', 'primer'> =
  { id: 'primer', process: 'page' };

// The pane the keys act on; a column is a pane that lists rows.
export type PrimerPane = 'tasks' | 'items' | 'card';

export type PrimerColumn = Exclude<PrimerPane, 'card'>;

// A row of the tasks column.
export type TaskRow = { kind: 'feature' } | { kind: 'task'; entryId: string };

// Where an open primer's page left it: the selected task row and item, the
// focused pane, the column whose selection the card shows, and the view with
// the view its Cancel prompt returns to, both kept from the primer the page
// last showed as active. `confirm` is the review's Cancel prompt, which leaves
// the session open.
export interface PrimerPlace {
  selectedTask: TaskRow;
  selectedItem: number | null;
  pane: PrimerPane;
  cardColumn: PrimerColumn;
  view: 'primer' | 'review' | 'confirm';
  confirmReturnView: 'primer' | 'review';
}

// Each open primer's place, by the primer's form id, written on each change
// while the primer is open; the primer closing deletes its key, and the page's
// open primers read deletes the keys of primers that closed while no page ran.
export const primerPlaceSlot: KeyedSlotKey<PrimerPlace, 'page', 'primer'> = {
  id: 'primer.place',
  process: 'page',
  kind: 'keyed',
};
