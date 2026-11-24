import type {
  BaseKit,
  DotStatus,
  KitRowOptions,
  PromptActionInput,
} from '../../../shared/page/layout-host/kit';

// The contract of an Inbox layout. Each part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="work-inbox"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="work-inbox"][data-layout="<name>"]`.
//
// Slots. A slot member places an element the app owns or fills:
// - `sections` → `ol.work-inbox-sections`; the app replaces its children on each render that changes them: one
//   `sectionRow` per section, in the nav's order (Needs you … Worth knowing, then All).
// - `status` → `div.work-inbox-status-slot`; the app draws the `status` part into it, then the `problem` part while
//   `work.json` was not read at start.
// - `filter` → `div.work-inbox-filter-slot`; the app draws the `filter` part into it while a ticket filter is set,
//   and empties it otherwise.
// - `cards` → `ol.work-inbox-cards`; the app draws one `card` per shown item into it, newest first, or the `empty`
//   part when none shows.
// - `draftBox` (the detail kit) appends the cursor item's reply box to `parent` and returns it: the vim box holding
//   the draft, or the sending text read-only while `isSending`, with the box's key hints. It throws `no draft box`
//   while the detail's `draft` is null.
// Each slot places once per draw: a slot called twice throws `<slot> placed twice`, which fails the part, so it draws
// with `default`. A slot the part leaves out the app appends at the end of the part's root.
// The detail pane: the sheet splits into the cards and the app-owned `div.work-inbox-detail` beside them, which
// scrolls. While the pane is open the app draws into it the `detail` part for the cursor item, or `detailEmpty` while
// the list has no cursor item; while it is closed the app draws neither and hides the pane.
// The app sets the click on each `sectionRow` root (it shows the section) and each `card` root (it puts the cursor
// there), and toggles there `is-selected` (the shown section; the cursor card) and `is-cursor` (the same while its
// pane has the keys); a `card` root also carries `is-direct` while it is a Needs you card. A row gives `kit.row` no
// `onClick`.

// A pane's root, appended to `parent`. The `sideBar` root fills the side bar's `div.work-inbox-side`, the `main` root
// the sheet's `div.work-inbox-main`; each lays out its own children.
export interface InboxPane {
  element: HTMLElement;
}

// One nav row: `count` is the section's open items, every item for `all`; `isHot` is true for Needs you while its
// count is over 0.
export interface SectionRowInput {
  id: string;
  title: string;
  count: number;
  isHot: boolean;
}

// The worker job line: `text` reads as `Sweep running · started 3m ago`; `hasRow` is true while the last finished
// job has a transcript to show, and the line then draws a Show transcript button running `work-inbox.showJobRow`.
export interface InboxStatusInput {
  text: string;
  tone: DotStatus;
  hasRow: boolean;
}

// Why `work.json` was not read at start, so nothing saves this run.
export interface InboxProblemInput {
  text: string;
}

// The ticket filter's chip, reading `<ticketKey> ✕`; a click runs `work-inbox.clearFilter`.
export interface InboxFilterInput {
  ticketKey: string;
}

// What the detail pane's buttons do, in the order the pane draws them.
export type InboxCardAction =
  | 'send'
  | 'snooze'
  | 'dismiss'
  | 'restore'
  | 'startSession'
  | 'addToBoard';

// One of the card's ticket keys; `reason` is why the worker linked a key the thread does not name, null when it does.
export interface CardTicket {
  key: string;
  reason: string | null;
}

// One Slack thread's card in the list. `sectionTitle` is its section's name under All and under a ticket filter, else
// null; `age` reads `now`, `5m`, `3h` or `2d`; `summary` is null while the detail pane is open, which shows it;
// `latest` is empty for none; `stateTag` is `cleared`, `dismissed` or `snoozed until <MMM d>` when the item is not
// open, else null; `isSending` is true while a reply is being sent; `isDirect` is true on a Needs you card; `note` is
// the last failed Send's, null for none. `prompt` is the cursor card's key prompts, empty off the cursor card.
export interface CardInput {
  id: string;
  section: string;
  sectionTitle: string | null;
  channel: string;
  author: string;
  age: string;
  title: string;
  summary: string | null;
  latest: string;
  state: 'open' | 'cleared' | 'dismissed' | 'snoozed';
  stateTag: string | null;
  isSending: boolean;
  isDirect: boolean;
  isCursor: boolean;
  note: string | null;
  prompt: PromptActionInput[];
}

// One message of a thread: `age` reads as a card's does; `text` is markdown.
export interface DetailMessageInput {
  author: string;
  age: string;
  text: string;
}

// The cursor item's detail pane. `channel`, `author`, `age`, `title`, `sectionTitle`, `stateTag` and `note` read as
// the card's do; `fetched` reads `Fetched just now` or `Fetched 5m ago`, null while the thread has no stored detail;
// `participants` are the thread's people; `why` is null for none. `root` is the thread's first message, null while it
// has no stored detail; `replies` are the shown replies, oldest first; `replyCountText` reads `2 of 4 replies` while
// the thread holds more replies than it shows, else null. `draft` is the text the reply box shows (the user's edit,
// else the worker's draft, else empty; the sending text while `isSending`), null when the item is not open. `url`
// opens the thread in Slack (`core.openLink`). `actions` are the buttons in order, each running its `work-inbox`
// command with the item's id: `send` `sendItem`, `snooze` `snoozeItem`, `dismiss` `dismissItem`, `restore`
// `restoreItem`, `startSession` `startItemSession`, `addToBoard` `addItemToBoard`. A ticket chip runs
// `work-inbox.openTicket` with its key.
export interface DetailInput {
  id: string;
  channel: string;
  author: string;
  age: string;
  title: string;
  sectionTitle: string | null;
  stateTag: string | null;
  fetched: string | null;
  participants: string[];
  tickets: CardTicket[];
  summary: string;
  why: string | null;
  root: DetailMessageInput | null;
  replies: DetailMessageInput[];
  replyCountText: string | null;
  draft: string | null;
  isSending: boolean;
  note: string | null;
  url: string;
  actions: InboxCardAction[];
}

// Why no card shows: `never` (no job ever ran and no item exists; hint `work-inbox.sweep`), `section` (the section
// has no open item) or `filter` (no open item holds the filter key).
export type InboxEmptyReason = 'never' | 'section' | 'filter';

// `section` is the shown section's name; `ticketKey` the filter key, null with no filter.
export interface InboxEmptyInput {
  reason: InboxEmptyReason;
  section: string;
  ticketKey: string | null;
}

// The kit every Inbox part draws with: the base kit, its keys in the part's scope.
export interface InboxKit extends BaseKit {}
export interface SideBarKit extends InboxKit {
  sections(parent: HTMLElement): HTMLElement;
}
export interface MainKit extends InboxKit {
  status(parent: HTMLElement): HTMLElement;
  filter(parent: HTMLElement): HTMLElement;
  cards(parent: HTMLElement): HTMLElement;
}
export interface DetailKit extends InboxKit {
  // The cursor item's reply box; throws `no draft box` while `draft` is null and `draftBox placed twice` on a second
  // call, so the part draws with `default`.
  draftBox(parent: HTMLElement): HTMLElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `sideBar` and `main` panes are drawn
// into app-owned containers once per layout set; the rows, `status`, `problem`, `filter`, `card`, `empty`, `detail`
// and `detailEmpty` on every render that changes what they show, one call per item. Kit scopes: `sideBar` and
// `sectionRow` `work-inbox.sections`; every other part, `detail` and `detailEmpty` included, `work-inbox.list`. Of the
// `draftBox`'s own hints, `edit` anchors in `work-inbox.list`, where it opens the box, and `send` fires in
// `work-inbox.box`.
export interface InboxLayout {
  sideBar?(parent: HTMLElement, kit: SideBarKit): InboxPane;
  sectionRow?(
    parent: HTMLElement,
    input: SectionRowInput,
    kit: InboxKit,
  ): HTMLElement;
  main?(parent: HTMLElement, kit: MainKit): InboxPane;
  status?(
    parent: HTMLElement,
    input: InboxStatusInput,
    kit: InboxKit,
  ): HTMLElement;
  problem?(
    parent: HTMLElement,
    input: InboxProblemInput,
    kit: InboxKit,
  ): HTMLElement;
  filter?(
    parent: HTMLElement,
    input: InboxFilterInput,
    kit: InboxKit,
  ): HTMLElement;
  card?(parent: HTMLElement, input: CardInput, kit: InboxKit): HTMLElement;
  empty?(
    parent: HTMLElement,
    input: InboxEmptyInput,
    kit: InboxKit,
  ): HTMLElement;
  detail?(parent: HTMLElement, input: DetailInput, kit: DetailKit): HTMLElement;
  detailEmpty?(parent: HTMLElement, kit: InboxKit): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompleteInboxLayout extends Required<InboxLayout> {}

export type { KitRowOptions };
