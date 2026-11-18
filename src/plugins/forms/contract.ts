import type { CommandId, CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  AgentFormEnd,
  AgentFormInvoke,
  AgentFormMessages,
  AgentFormService,
  AgentFormSession,
} from '../../contracts/agent-forms';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';
import { NUMBER_KEY_COUNT } from './manifest';

export type NoticeBadge = 'Applied' | 'Dispatched' | 'Decided';

// The kinds forms itself registers.
export type BuiltInItemKind = 'notice' | 'finding' | 'question';
// A registered kind's id (ItemKindSpec.id), a built-in's or a plugin's.
export type ItemKind = string;

// The values Python's json.dumps writes for a fingerprint.
export type PythonJsonValue =
  | string
  | number
  | PythonJsonValue[]
  | { [key: string]: PythonJsonValue };

export interface Question {
  title: string;
  // The card's headline: what the user is asked to decide, and why now.
  summary: string;
  context: string;
  choices: string[];
  // 1-based.
  recommend: number;
  rationale: string;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

export interface Notice {
  title: string;
  context: string;
  badge: NoticeBadge;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

// One of a finding's solutions, drawn under the action it sits under.
export interface FindingChoice {
  text: string;
  reason: string;
  action: FindingAction;
}

// What the user does with a finding. Picking a choice picks the action it
// sits under; an action with no choices is picked alone, as a header.
export type FindingAction = 'fix_now' | 'follow_up' | 'leave_it';

// In the order a finding card draws them.
export const FINDING_ACTIONS: readonly FindingAction[] = [
  'fix_now',
  'follow_up',
  'leave_it',
];

// The most numbered entries a card may show, one per number key: a
// question's choices, or a finding's choices and choiceless action headers.
export const MAX_ENTRIES = NUMBER_KEY_COUNT;

// Picks the numbered choice or action, 1 first.
export const formsChooseCommand: CommandKey<number, 'forms.choose'> = {
  id: 'forms.choose',
};

// The arg of `forms.chooseAt`: the item's 0-based rail position, and the
// 1-based number `forms.choose` takes.
export interface FormsChooseAtArg {
  item: number;
  number: number;
}

// Picks numbered choice `number` on the item at rail position `item`, as a
// card's click does; picking the held number again clears it.
export const formsChooseAtCommand: CommandKey<
  FormsChooseAtArg,
  'forms.chooseAt'
> = { id: 'forms.chooseAt' };

// Each command below takes the item's 0-based rail position and acts on that
// item, as a card's control does, whatever box holds focus.
export const formsClearChoiceAtCommand: CommandKey<
  number,
  'forms.clearChoiceAt'
> = { id: 'forms.clearChoiceAt' };

export const formsAcceptRecommendationAtCommand: CommandKey<
  number,
  'forms.acceptRecommendationAt'
> = { id: 'forms.acceptRecommendationAt' };

export const formsToggleNotApplicableAtCommand: CommandKey<
  number,
  'forms.toggleNotApplicableAt'
> = { id: 'forms.toggleNotApplicableAt' };

export const formsToggleDontAskAtCommand: CommandKey<
  number,
  'forms.toggleDontAskAt'
> = { id: 'forms.toggleDontAskAt' };

// Moves the line cursor onto the 1-based notice, which focuses the notices
// stop, then opens or closes that line, as a click on the line's head does.
export const formsToggleNoticeAtCommand: CommandKey<
  number,
  'forms.toggleNoticeAt'
> = { id: 'forms.toggleNoticeAt' };

// Moves the line cursor onto the 1-based notice, which focuses the notices
// stop, and nothing more.
export const formsFocusNoticeAtCommand: CommandKey<
  number,
  'forms.focusNoticeAt'
> = { id: 'forms.focusNoticeAt' };

// Focuses the item at the rail position, and nothing more.
export const formsFocusItemCommand: CommandKey<number, 'forms.focusItem'> = {
  id: 'forms.focusItem',
};

// What a click on the rail entry at the position does in the view shown:
// focus it in the form, jump to it in the review.
export const formsPickRailItemCommand: CommandKey<
  number,
  'forms.pickRailItem'
> = { id: 'forms.pickRailItem' };

// Jumps to the item of the 0-based review row, as a click on the row does.
export const formsReviewJumpAtCommand: CommandKey<
  number,
  'forms.reviewJumpAt'
> = { id: 'forms.reviewJumpAt' };

// Where a finding comes from: a registered FindingOriginSpec's id. It sets the
// card the finding draws as and the fields it takes. Known: 'caused',
// 'pre_existing', 'design', 'nit'.
export type FindingOrigin = string;

export type Severity = 'critical' | 'important' | 'minor';

export const SEVERITIES: readonly Severity[] = [
  'critical',
  'important',
  'minor',
];

// One finding origin, registered unchanged in main and on the page. Card-level
// fields (card, words, choiceNoun, minChoices, maxChoices, actions) are equal
// across every origin that shares a card. `id` and `card` are plain strings:
// a plugin registers its own origins and cards.
export interface FindingOriginSpec {
  // The wire `origin` value: 'caused'.
  id: string;
  // The card it draws as. Built-in: 'defect', 'decision', 'nit'.
  card: string;
  // The card's kind label and its two section titles.
  words: { kind: string; finding: string; proof: string };
  // What the card's choices are, in the tool text: 'its solutions'.
  choiceNoun: string;
  // What the origin means, in the tool text.
  meaning: string;
  minChoices: number;
  maxChoices: number;
  requiresSeverity: boolean;
  requiresProof: boolean;
  // Each offered action, with the card's word for it.
  actions: Readonly<Partial<Record<FindingAction, string>>>;
  // The verdict's origin chip text.
  chip: string;
  // The qualified theme token of the chip colour: 'forms.origin-caused'.
  themeToken: string;
}

export interface Finding {
  title: string;
  origin: FindingOrigin;
  // Null on an origin that does not require severity.
  severity: Severity | null;
  // One plain sentence: what goes wrong, and for whom.
  impact: string;
  finding: string;
  // '' when the agent sent none, which only an origin not requiring proof
  // allows.
  proof: string;
  // A Defect's solutions, a Decision's options, a Nit's one fix.
  choices: FindingChoice[];
  // The 1-based number of the recommended choice, one of recommend_action;
  // null when recommend_action has no choices, so its header is recommended.
  recommend: number | null;
  recommend_action: FindingAction;
  // Why to take a deferral action, drawn under that action's header; the
  // ask_round key is action_reasons.
  actionReasons: Partial<Record<'follow_up' | 'leave_it', string>>;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

// A validated ask_round call.
export interface Round {
  heading: string;
  overview: string;
  // The layout that draws this round's panes and the cards no item's own
  // layout draws; null for none.
  layout: string | null;
  // Each kind's items by kind id, as main's registered kinds parsed them; a
  // kind with no items may have no key. The built-ins' items are `Question`,
  // `Notice` and `Finding`.
  items: Readonly<Record<ItemKind, readonly unknown[]>>;
  // Each kind's bodyKey as main registered it, so the page writes back the
  // entries of a kind it has no registration for; outside the fingerprint and
  // the body.
  bodyKeys: Readonly<Record<ItemKind, string>>;
}

// One question's or finding's answer as last saved; field names are the
// saved-round file format.
export interface AnswerEntry {
  index: number;
  choice: number;
  not_applicable: boolean;
  notes: string;
  dont_ask: boolean;
  dont_ask_reason: string;
}

// `choice` is the picked choice's 1-based number in `choices`, 0 for an action
// header; `action` is the picked entry's action, '' for no pick.
// `action_label` is the card's word for the picked action, '' for no pick, and
// `recommend_action_label` its word for `recommend_action`; main writes both
// on every body it reads, and retro reads them.
export interface FindingAnswerEntry extends AnswerEntry {
  action: FindingAction | '';
  action_label: string;
  recommend_action_label: string;
}

export interface NoticeComment {
  index: number;
  comment: string;
}

// The saved-round folder under the home, which the marketplace's retro reads.
export const SAVED_ROUNDS_FOLDER = '.agents/wigley-forms/rounds';

export interface FormBody {
  note: string;
  answers: AnswerEntry[];
  finding_answers: FindingAnswerEntry[];
  notice_comments: NoticeComment[];
  // A registered kind's entries sit at its bodyKey.
  readonly [bodyKey: string]: unknown;
}

export type Outcome =
  | 'submitted'
  | 'draft'
  | 'cancelled'
  | 'no_round'
  | 'auto_answered';

export type AnswerStatus = 'answered' | 'not_applicable' | 'untouched';

export interface AnswerResult {
  index: number;
  title: string;
  status: AnswerStatus;
  choice: number;
  choice_text: string;
  took_recommendation: boolean;
  notes?: string;
  dont_ask?: true;
  dont_ask_reason?: string;
}

// `choice` and `choice_text` are the picked choice, 0 and '' for a header
// pick; `took_recommendation` is the recommended entry taken whole,
// `took_action_recommendation` the recommended action.
export interface FindingResult extends AnswerResult {
  action: FindingAction | '';
  took_action_recommendation: boolean;
}

export interface NoticeResult {
  index: number;
  title: string;
  badge: NoticeBadge;
  comment?: string;
}

// The tool result both forms tools return.
export interface AnswersPayload {
  outcome: Outcome;
  summary: string;
  next: string;
  answers: AnswerResult[];
  findings: FindingResult[];
  notices: NoticeResult[];
  note?: string;
  earlier_heading?: string;
  // A registered kind's results sit at its resultKey.
  readonly [resultKey: string]: unknown;
}

// One connected session's round calls: `open` is ask_round, `collect`
// collect_last_round.
export type FormsSession = AgentFormSession<AnswersPayload>;

// The `name` of the error `open` rejects with for a malformed call; the tool
// error text is its `roundErrorText`, not its message.
export const ROUND_ERROR_NAME = 'RoundError';

// Where a malformed round call is wrong.
export type RoundErrorPath =
  | { at: 'call' } // the round call as a whole
  | { at: 'field'; field: string } // one of the round's own fields
  | { at: 'item'; kind: string; number: number }; // one item of the kind with that id, `number` 1-based

export type RoundItemPath = Extract<RoundErrorPath, { at: 'item' }>;

// What a RoundError carries: where the call is wrong, what is wrong, and the
// repair when `problem` alone does not name it.
export interface RoundErrorFields {
  path: RoundErrorPath;
  problem: string;
  detail?: string;
}

// A malformed round call, thrown by every kind's `parse`, built-in or
// registered. It is the calling model's only repair signal, worded by main's
// `roundErrorText`; `message` is for logs. A user-folder plugin has this
// type but not the class, so its kind's `parse` throws the fields with
// `name: 'RoundError'` (ROUND_ERROR_NAME) in its place:
//   throw { name: 'RoundError', path: at, problem: 'each poll needs a title.' };
export class RoundError extends Error {
  readonly path: RoundErrorPath;
  readonly problem: string;
  // '' when there is none.
  readonly detail: string;

  constructor(fields: RoundErrorFields) {
    const detail = fields.detail ?? '';
    super(detail === '' ? fields.problem : `${fields.problem} ${detail}`);
    this.name = ROUND_ERROR_NAME;
    this.path = fields.path;
    this.problem = fields.problem;
    this.detail = detail;
  }
}

// `error` as a RoundError: itself when it is one, a RoundError over its
// fields when it is named ROUND_ERROR_NAME and holds a RoundErrorPath and a
// string problem, else null.
export function roundErrorOf(error: unknown): RoundError | null {
  if (error instanceof RoundError) {
    return error;
  }
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { name, path, problem, detail } = error as Record<string, unknown>;
  const isShaped =
    name === ROUND_ERROR_NAME &&
    isRoundErrorPath(path) &&
    typeof problem === 'string' &&
    (detail === undefined || typeof detail === 'string');
  return isShaped ? new RoundError({ path, problem, detail }) : null;
}

function isRoundErrorPath(path: unknown): path is RoundErrorPath {
  if (typeof path !== 'object' || path === null) {
    return false;
  }
  const { at, field, kind, number } = path as Record<string, unknown>;
  switch (at) {
    case 'call':
      return true;
    case 'field':
      return typeof field === 'string';
    case 'item':
      return typeof kind === 'string' && typeof number === 'number';
    default:
      return false;
  }
}

// One item kind's wire keys: data both processes register under `id`.
export interface ItemKindSpec {
  id: string;
  // The kind's list in an ask_round call.
  argsKey: string;
  // The kind's entries in a saved body.
  bodyKey: string;
  // The kind's results in a tool result.
  resultKey: string;
  // The fingerprint holds the kind's list even when it is empty.
  fingerprintJoinsWhenEmpty: boolean;
  // The user answers the kind's items with a choice.
  answerable: boolean;
}

// One item kind as forms' main registers it: its part of the tool schema, its
// validation, what a re-sent round is matched on, and its body entries and
// results.
export interface MainItemKind<
  Item = unknown,
  Entry = unknown,
  Result = unknown,
> {
  readonly spec: ItemKindSpec;
  // Singular, lower case: the error prefix (`Notice 2: `) and the summary
  // count (`2 notices`).
  readonly noun: string;
  // The JSON Schema of the ask_round field `spec.argsKey`, built on each call.
  describe(): Readonly<Record<string, unknown>>;
  // Throws a RoundError whose `path` is `at` for a malformed item. Any other
  // throw rejects the tool call.
  parse(raw: unknown, at: RoundItemPath): Item;
  // The layout the item names, null for none.
  layout(item: Item): string | null;
  fingerprintContent(item: Item): PythonJsonValue;
  // Never throws; `saved` is the saved entry with that 1-based index, `{}`
  // when the body holds none, and `item` the round's item it answers.
  readEntry(
    index: number,
    saved: Readonly<Record<string, unknown>>,
    item: Item,
  ): Entry;
  // The entry a headless session answers the item with.
  recommendedEntry(item: Item, index: number): Entry;
  // The entry a finished round's saved copy hands a re-sent round's draft;
  // absent keeps the entry whole.
  finishedEntry?(entry: Entry): Entry;
  result(item: Item, entry: Entry): Result;
  // Present exactly when `spec.answerable` is true.
  status?(result: Result): AnswerStatus;
}

// An answerable kind's answer, the part forms itself reads and toggles.
export interface ItemAnswer {
  // 1-based, 0 for none; kept while not applicable.
  choice: number;
  notApplicable: boolean;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
}

// One text box an item's card mounts. `keys` is the command whose keys the
// field's label shows; null for none.
export interface KindBox {
  field: string;
  label: string;
  hint: string;
  className: string;
  keys: CommandId | null;
}

// A kind's answers to and from the saved body's entries at its bodyKey.
export interface KindDraftCodec<Item, Answer> {
  // One answer per item: from the entry whose 1-based `index` names it, else
  // `reduce.untouched(item)`.
  decode(items: readonly Item[], entries: readonly unknown[]): Answer[];
  // One saved entry per answer, `index` 1-based, in the shape `decode` reads.
  encode(answers: readonly Answer[]): unknown[];
}

// Called only while the answer is applicable: forms checks `notApplicable`
// first. Each returns `answer` itself when nothing changes. `number` is
// 1-based down the card.
export interface KindPick<Item, Answer> {
  choose(item: Item, answer: Answer, number: number): Answer;
  clear(item: Item, answer: Answer): Answer;
  recommended(item: Item, answer: Answer): Answer;
  isComplete(item: Item, answer: Answer): boolean;
  number(item: Item, answer: Answer): number;
  // The choice the agent gets for a complete pick; 0 for a pick with no
  // choice.
  choice(item: Item, answer: Answer): number;
  choiceText(item: Item, choice: number): string;
  // The recommended choice, 1-based; 0 when the recommendation has no choice.
  recommend(item: Item): number;
  // Whether a complete pick earns the review's Recommended badge.
  isRecommended(item: Item, answer: Answer): boolean;
}

// How a kind's answers change. Each returns `answer` itself when nothing
// changes.
export interface KindReduce<Item, Answer> {
  untouched(item: Item): Answer;
  text(answer: Answer, field: string): string;
  withText(answer: Answer, field: string, value: string): Answer;
  // Given exactly when `spec.answerable`; then `Answer` extends `ItemAnswer`.
  pick?: KindPick<Item, Answer>;
}

export interface KindBoxes<Answer> {
  // Every box an item's card mounts, in default order.
  fields: readonly KindBox[];
  // The fields of `fields` the user can reach now, in Tab order.
  shown(answer: Answer): readonly string[];
}

export interface KindCardInput<Item, Input> {
  // The item number's prefix on its card head, the rail and the review.
  railPrefix: string;
  title(item: Item): string;
  // The layout the item names; null for none.
  layout(item: Item): string | null;
  // The data a layout builds the item's card from. `index` is 1-based within
  // the kind.
  input(item: Item, index: number, round: Round): Input;
}

// One item kind as forms' page registers it: how its saved entries restore,
// how its answers change, the boxes its cards mount, its card's data, and its
// place on the rail. `Answer` holds primitives only, compared field by field
// for `answerChanged`.
export interface PageKind<Item = unknown, Answer = unknown, Input = unknown> {
  spec: ItemKindSpec;
  restore: KindDraftCodec<Item, Answer>;
  reduce: KindReduce<Item, Answer>;
  boxes: KindBoxes<Answer>;
  cardInput: KindCardInput<Item, Input>;
  // The kind's place among rail stops, ascending, ties in registration order;
  // null only for `notice`, whose items draw on the notices stop.
  railOrder: number | null;
}

// Round sources (MCP now, the wigley harness next) reach round logic only here.
export type FormsService = AgentFormService<AnswersPayload>;

// One round as the forms page holds it: main's presented form, mapped at the
// channel boundary.
export interface PresentedRound {
  roundId: string;
  // The app's id for the session the round belongs to.
  sessionId: string;
  // `project · heading`, or the heading alone without a project.
  label: string;
  round: Round;
  draft: FormBody | null;
}

export type RoundEnd = AgentFormEnd<FormBody>;

// The agent form channel's rounds, plus: the forms page part invokes
// `openPreview` from the preview key.
export interface FormsChannel extends ChannelShape {
  invoke: AgentFormInvoke<Round, FormBody> & {
    openPreview(): void;
  };
  messages: AgentFormMessages<Round, FormBody>;
}

// What a confirm asks the user: `title` heads the round, `detail` says what
// the action does. The round's overview shows the detail's first paragraph,
// the text before its first blank line, so that paragraph is plain prose; the
// question's context shows the whole detail, markdown blocks included.
export interface ConfirmRequest {
  title: string;
  detail: string;
}

// The main part's exports. `registerKind` throws, registering nothing, on a
// kind whose id or wire key another registered kind holds, a wire key a round
// field holds, a `status` that disagrees with `spec.answerable`, or a
// `fingerprintJoinsWhenEmpty` on a kind forms does not build in; its
// `Disposable` removes the kind, and each change re-contributes the tools.
// `registerFindingOrigin` throws, registering nothing, on a blank or taken id,
// choice bounds outside 1 to MAX_ENTRIES, actions without fix_now or with a
// blank word, or card-level fields that differ from another origin's on the
// same card; its `Disposable` retires the origin, so new rounds refuse it and
// rounds already open keep reading it, and each change re-contributes the
// tools. `confirm` asks the user Allow or Deny in a fresh round, Deny
// recommended, in the forms session forms started for the app session
// `sessionId`; it queues behind that session's open round. It resolves true
// only on a submitted Allow of that round, and false on any other answer or
// once `signal` aborts. It rejects with `no forms session for <sessionId>`
// when that session has no live forms tool session.
export interface FormsMainExports {
  registerKind(kind: MainItemKind): Disposable;
  registerFindingOrigin(spec: FindingOriginSpec): Disposable;
  confirm(
    sessionId: string,
    request: ConfirmRequest,
    signal: AbortSignal,
    toolUseId: string | null,
  ): Promise<boolean>;
}

export const formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'> = {
  id: 'forms',
  process: 'main',
};

// The page part's exports and events.

// What the forms page shows: a round's cards, its review, the cancel prompt
// over the review, or no round.
export type FormsScreen = 'forms' | 'review' | 'confirm' | 'idle';

// A round the forms page holds, as main presented it.
export interface OpenRound {
  roundId: string;
  sessionId: string;
  label: string;
  round: Round;
}

// An item of an answerable kind in a round; `index` is 1-based in its kind's
// items.
export interface FormsItemRef {
  kind: ItemKind;
  index: number;
}

// How a round left the page: sent or cancelled by the page's finish, or
// `closed` when main closed it on its own (a disconnect, a host cancel).
export type RoundFinishOutcome = 'submitted' | 'cancelled' | 'closed';

// `roundShown` fires once when a round joins the page, the rounds open at
// page load included; a restored draft emits no `answerChanged`.
// `answerChanged` fires on each change to an answerable kind's answer, its
// notes and reason text included, never for a notice comment, the round note
// or a kind registering or leaving; its `status` is the page's, `answered` once the item is responded
// (`isResponded`), notes alone included. `roundFinished` fires once when a
// round leaves the page, for every reason, with the answers it left with.
// `viewChanged` fires when the view or the active round changes. In one store
// change they fire in that order, and a change a listener makes fires its
// events after the change it interrupted.
export interface FormsPageEvents extends EventShape {
  roundShown: OpenRound;
  answerChanged: { roundId: string; item: FormsItemRef; status: AnswerStatus };
  roundFinished: {
    roundId: string;
    sessionId: string;
    outcome: RoundFinishOutcome;
    body: FormBody;
  };
  viewChanged: { view: FormsScreen; roundId: string | null };
}

// The card a part draws on, of any registered kind; `index` is 1-based in its
// kind's items.
export interface FormsCardPartItem {
  roundId: string;
  kind: ItemKind;
  index: number;
}

// A part another plugin adds to every card of `kinds`. `build` draws into
// `parent`, its own wrapper on the card; `update`, when returned, runs on each
// update of a question or finding card, after the card's own. A part that
// throws is logged and draws nothing; the card still draws.
export interface FormsCardPart {
  id: string;
  kinds: readonly ItemKind[];
  build(parent: HTMLElement, item: FormsCardPartItem): { update?(): void };
}

// A column another plugin adds to every review row: `cell` is the text drawn
// after the row's own cells, read each time the row draws, and `title` shows
// as that cell's tooltip. A column that throws is logged and draws nothing;
// the row still draws.
export interface FormsReviewColumn {
  id: string;
  title: string;
  cell(roundId: string, item: FormsItemRef): string;
}

// `activeRound` is the round the page shows, null with none; `answers` a held
// round's answers as its saved body, null for a round the page does not hold.
// `addCardPart` and `addReviewColumn` throw on an id already added; each
// `Disposable` removes its part or column, and adding or removing one redraws
// every open round, keeping its answers. `registerKind` throws, registering
// nothing, on an id already registered, the id `notices`, a null `railOrder`
// on any id but `notice`, or a `reduce.pick` given when `spec.answerable` is
// false or missing when it is true; its `Disposable` removes the kind, and
// each change re-derives every open round, keeping a departed kind's draft
// entries in its body. `registerFindingOrigin` takes the spec main registers,
// with main's checks; each register or dispose redraws every open round,
// keeping its answers.
export interface FormsPageExports {
  activeRound(): OpenRound | null;
  answers(roundId: string): FormBody | null;
  addCardPart(part: FormsCardPart): Disposable;
  addReviewColumn(column: FormsReviewColumn): Disposable;
  registerKind(kind: PageKind): Disposable;
  registerFindingOrigin(spec: FindingOriginSpec): Disposable;
}

export const formsPageKey: DependencyKey<FormsPageExports, 'page', 'forms'> = {
  id: 'forms',
  process: 'page',
};

// Where an open round's page left it: the focused rail position, the review
// cursor's row, the notices stop's line cursor (1-based, 0 with no notices),
// and the view with the view its Cancel prompt returns to, both kept from the
// round the page last showed as active. `confirm` is the review's Cancel
// prompt, which leaves the session open.
export interface RoundPlace {
  focus: number;
  reviewRow: number;
  noticeLine: number;
  view: 'forms' | 'review' | 'confirm';
  confirmReturnView: 'forms' | 'review';
}

// Each open round's place, by the round id, written on each change while the
// round is open; the round closing deletes its key, and the page's open rounds
// read deletes the keys of rounds that closed while no page ran.
export const formsPlaceSlot: KeyedSlotKey<RoundPlace, 'page', 'forms'> = {
  id: 'forms.place',
  process: 'page',
  kind: 'keyed',
};
