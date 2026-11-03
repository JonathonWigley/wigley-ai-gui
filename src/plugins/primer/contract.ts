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

export type PrimerOutcome =
  | 'submitted'
  | 'draft'
  | 'cancelled'
  | 'needs_manual_open'
  | 'no_primer';

// `no_primer` and `needs_manual_open` carry no `feature` and no `entries`.
export interface PrimerPayload {
  outcome: PrimerOutcome;
  summary: string;
  next: string;
  feature?: PrimerFeature;
  entries?: PrimerEntry[];
  earlier_heading?: string;
}

export const PRIMER_ERROR_NAME = 'PrimerError';
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

export interface PrimerPageExports {
  activePrimer(): PresentedPrimer | null;
}

export const primerPageKey: DependencyKey<PrimerPageExports, 'page', 'primer'> =
  { id: 'primer', process: 'page' };
