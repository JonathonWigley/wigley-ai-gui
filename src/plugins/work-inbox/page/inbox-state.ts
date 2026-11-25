import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import { qualify } from '../../../shared/plugin-manifests';
import {
  ageText,
  type DetailMessage,
  isDigest,
  isUnseen,
  type ThreadDetail,
  WORK_SECTIONS,
  type WorkItem,
  type WorkSection,
  type WorkState,
} from '../../work/contract';
import type { InboxSectionId, WorkInboxPlace } from '../contract';
import type {
  CardInput,
  DetailInput,
  DetailMessageInput,
  InboxCardAction,
  InboxEmptyReason,
} from '../layouts/layout';

export type { InboxCardAction, InboxEmptyReason, InboxSectionId };

const PLUGIN_ID = 'work-inbox';

// The nav's rows, in order.
export const INBOX_SECTIONS: readonly InboxSectionId[] = [
  ...WORK_SECTIONS,
  'all',
];

export const SECTION_TITLES: Record<InboxSectionId, string> = {
  needs_you: 'Needs you',
  promised: 'You promised',
  waiting: 'Waiting on others',
  my_threads: 'My threads',
  around: 'Around Slack',
  worth_knowing: 'Worth knowing',
  all: 'All',
};

// The two kinds of item: threads the user is part of, and the digest's summaries of channel posts.
export type InboxGroupId = 'threads' | 'digest';

export const GROUP_TITLES: Record<InboxGroupId, string> = {
  threads: 'Threads',
  digest: 'Digest',
};

export const groupOf = (section: WorkSection): InboxGroupId =>
  isDigest(section) ? 'digest' : 'threads';

// The nav group section `id` opens: its kind's group on the first section of each, `all` on All, null on the rest.
export function navGroupStart(id: InboxSectionId): InboxGroupId | 'all' | null {
  if (id === 'all') {
    return 'all';
  }
  const first = WORK_SECTIONS.find(
    (section) => groupOf(section) === groupOf(id),
  );
  return first === id ? groupOf(id) : null;
}

// Where the keys act: the side bar's sections, the card list, or the detail pane's reply box.
export type InboxFocus = 'sections' | 'list' | 'box';

export type Move = 'down' | 'up' | 'top' | 'bottom';

// The view's own draw state; the work it draws stays in `work.state`. `section` is the section shown, or the one
// shown before the filter while `ticketFilter` is set; `cursorId` the cursor card's item id, null for none;
// `sectionCursor` the side bar's cursor row; `drafts` the user's edits by item id; `paneOpen` whether the detail pane
// is open.
export interface InboxViewState {
  section: InboxSectionId;
  ticketFilter: string | null;
  cursorId: string | null;
  focus: InboxFocus;
  sectionCursor: InboxSectionId;
  drafts: Record<string, string>;
  paneOpen: boolean;
}

export function initialInboxState(): InboxViewState {
  return {
    section: 'needs_you',
    ticketFilter: null,
    cursorId: null,
    focus: 'list',
    sectionCursor: 'needs_you',
    drafts: {},
    paneOpen: false,
  };
}

// `work` is the work state the change applies to, read for the list it shows. `workChanged` takes the work drawn
// before and the work now; `placed` puts back a saved place; `reset` replaces the whole state, as a demo sample's end
// does.
export type InboxAction =
  | { type: 'workChanged'; before: WorkState; after: WorkState }
  | { type: 'showSection'; section: InboxSectionId; work: WorkState }
  | { type: 'filter'; ticketKey: string; work: WorkState }
  | { type: 'clearFilter'; work: WorkState }
  | { type: 'move'; to: Move; work: WorkState }
  | { type: 'sectionMove'; to: Move }
  | { type: 'select'; id: string; work: WorkState }
  | { type: 'focus'; focus: InboxFocus }
  | { type: 'draftEdited'; id: string; text: string }
  | { type: 'draftDropped'; id: string }
  | { type: 'pane'; open: boolean }
  | { type: 'placed'; place: WorkInboxPlace; work: WorkState }
  | { type: 'reset'; state: InboxViewState };

export function inboxReducer(
  state: InboxViewState,
  action: InboxAction,
): InboxViewState {
  switch (action.type) {
    case 'workChanged':
      return workChanged(state, action.before, action.after);
    case 'showSection':
      return onFirstCard(
        {
          ...state,
          section: action.section,
          sectionCursor: action.section,
          ticketFilter: null,
        },
        action.work,
      );
    case 'filter':
      return onFirstCard(
        { ...state, ticketFilter: action.ticketKey },
        action.work,
      );
    case 'clearFilter':
      return state.ticketFilter === null
        ? state
        : onFirstCard({ ...state, ticketFilter: null }, action.work);
    case 'move': {
      const ids = shownItems(action.work, state).map((item) => item.id);
      const index = movedIndex(
        ids.indexOf(state.cursorId ?? ''),
        ids.length,
        action.to,
      );
      return withCursor(state, ids[index] ?? null);
    }
    case 'sectionMove': {
      const index = movedIndex(
        INBOX_SECTIONS.indexOf(state.sectionCursor),
        INBOX_SECTIONS.length,
        action.to,
      );
      const sectionCursor = INBOX_SECTIONS[index];
      return sectionCursor === state.sectionCursor
        ? state
        : { ...state, sectionCursor };
    }
    case 'select': {
      const isShown = shownItems(action.work, state).some(
        (item) => item.id === action.id,
      );
      const shown = isShown
        ? state
        : {
            ...state,
            section: 'all' as const,
            sectionCursor: 'all' as const,
            ticketFilter: null,
          };
      return withCursor(shown, action.id);
    }
    case 'focus':
      return state.focus === action.focus
        ? state
        : { ...state, focus: action.focus };
    case 'draftEdited':
      return state.drafts[action.id] === action.text
        ? state
        : { ...state, drafts: { ...state.drafts, [action.id]: action.text } };
    case 'draftDropped': {
      if (!Object.hasOwn(state.drafts, action.id)) {
        return state;
      }
      const drafts = { ...state.drafts };
      delete drafts[action.id];
      return { ...state, drafts };
    }
    case 'pane':
      return state.paneOpen === action.open
        ? state
        : { ...state, paneOpen: action.open };
    case 'placed': {
      const { place, work } = action;
      // A place saved before the pane existed has no `paneOpen`, and reads as closed.
      const placed: InboxViewState = {
        ...state,
        section: place.section,
        sectionCursor: place.section,
        ticketFilter: place.ticketFilter,
        drafts: prunedDrafts(place.drafts, work),
        paneOpen: place.paneOpen === true,
      };
      const ids = shownItems(work, placed).map((item) => item.id);
      const cursorId =
        place.cursorId !== null && ids.includes(place.cursorId)
          ? place.cursorId
          : (ids[0] ?? null);
      return { ...placed, cursorId };
    }
    case 'reset':
      return action.state;
  }
}

// The index `to` moves `index` to in a list of `length`, clamped at the ends; from no index (-1), down and up land on
// the first.
function movedIndex(index: number, length: number, to: Move): number {
  if (length === 0) {
    return -1;
  }
  switch (to) {
    case 'top':
      return 0;
    case 'bottom':
      return length - 1;
    case 'down':
      return index < 0 ? 0 : Math.min(index + 1, length - 1);
    case 'up':
      return index < 0 ? 0 : Math.max(index - 1, 0);
  }
}

function withCursor(
  state: InboxViewState,
  cursorId: string | null,
): InboxViewState {
  return state.cursorId === cursorId ? state : { ...state, cursorId };
}

// `state` with the cursor on the first card it shows of `work`, none when it shows none.
function onFirstCard(state: InboxViewState, work: WorkState): InboxViewState {
  return withCursor(state, shownItems(work, state)[0]?.id ?? null);
}

// Drops the edits of items `after` no longer holds, and keeps the cursor: on its card while that still shows, else on
// the next card `before` showed that still shows, else the previous one, else none; with no cursor, on the first card.
function workChanged(
  state: InboxViewState,
  before: WorkState,
  after: WorkState,
): InboxViewState {
  const drafts = prunedDrafts(state.drafts, after);
  const pruned = drafts === state.drafts ? state : { ...state, drafts };
  const shownAfter = new Set(shownItems(after, pruned).map((item) => item.id));
  if (pruned.cursorId === null) {
    return onFirstCard(pruned, after);
  }
  if (shownAfter.has(pruned.cursorId)) {
    return pruned;
  }
  const shownBefore = shownItems(before, pruned).map((item) => item.id);
  const at = shownBefore.indexOf(pruned.cursorId);
  const next = shownBefore.slice(at + 1).find((id) => shownAfter.has(id));
  const previous =
    at < 0
      ? undefined
      : shownBefore
          .slice(0, at)
          .reverse()
          .find((id) => shownAfter.has(id));
  return withCursor(pruned, next ?? previous ?? null);
}

const GROUP_ORDER: Record<InboxGroupId, number> = { threads: 0, digest: 1 };

// Threads before the digest, each newest first.
const listOrder = (a: WorkItem, b: WorkItem) =>
  GROUP_ORDER[groupOf(a.section)] - GROUP_ORDER[groupOf(b.section)] ||
  Date.parse(b.at) - Date.parse(a.at);

// The unseen open items of each section, and every item under `all`.
export function sectionCounts(work: WorkState): Record<InboxSectionId, number> {
  const counts = Object.fromEntries(
    INBOX_SECTIONS.map((section) => [section, 0]),
  ) as Record<InboxSectionId, number>;
  for (const item of work.items) {
    if (item.state === 'open' && isUnseen(item)) {
      counts[item.section] += 1;
    }
  }
  counts.all = work.items.length;
  return counts;
}

// The cards the list shows, threads before the digest and each newest `at` first: the open items holding the filter key across sections while a filter
// is set, else every item under `all`, else the section's open items.
export function shownItems(work: WorkState, view: InboxViewState): WorkItem[] {
  const { ticketFilter, section } = view;
  const isShown = (item: WorkItem) => {
    if (ticketFilter !== null) {
      return item.state === 'open' && item.ticketKeys.includes(ticketFilter);
    }
    return (
      section === 'all' || (item.state === 'open' && item.section === section)
    );
  };
  return work.items.filter(isShown).sort(listOrder);
}

// Whether the list mixes sections: All, or a ticket filter.
export function isMixedList(view: InboxViewState): boolean {
  return view.ticketFilter !== null || view.section === 'all';
}

// The group heading a mixed list draws before each shown item: the item's group where it differs from the item
// before, else null; all null while the list shows one section.
export function groupStarts(
  items: readonly WorkItem[],
  view: InboxViewState,
): (InboxGroupId | null)[] {
  if (!isMixedList(view)) {
    return items.map(() => null);
  }
  return items.map((item, index) => {
    const group = groupOf(item.section);
    const before = items[index - 1];
    return before !== undefined && groupOf(before.section) === group
      ? null
      : group;
  });
}

// The detail pane's buttons in draw order. Every open thread sends its reply (a Waiting on others reply is the nudge),
// a digest item takes none, a Waiting item also snoozes, every open item dismisses and spins up a session or a Board
// task, and an item that is not open only restores.
export function cardActions(
  item: WorkItem,
  _view: InboxViewState,
): readonly InboxCardAction[] {
  if (item.state !== 'open') {
    return ['restore'];
  }
  return [
    ...(isDigest(item.section) ? [] : (['send'] as const)),
    ...(item.section === 'waiting' ? (['snooze'] as const) : []),
    'dismiss',
    'startSession',
    'addToBoard',
  ];
}

// Why the list shows no card: nothing ever gathered, an empty section, or no open item holding the filter key. Read
// only while `shownItems` is empty.
export function emptyReason(
  work: WorkState,
  view: InboxViewState,
): InboxEmptyReason {
  const hasNeverRun =
    work.job.running === null &&
    work.job.last === null &&
    work.items.length === 0;
  if (hasNeverRun) {
    return 'never';
  }
  return view.ticketFilter === null ? 'section' : 'filter';
}

// `drafts` without the edits of items `work` no longer holds; an item in any state keeps its edit. `drafts` itself
// when it drops none.
export function prunedDrafts(
  drafts: Record<string, string>,
  work: WorkState,
): Record<string, string> {
  const ids = new Set(work.items.map((item) => item.id));
  const kept = Object.entries(drafts).filter(([id]) => ids.has(id));
  return kept.length === Object.keys(drafts).length
    ? drafts
    : Object.fromEntries(kept);
}

// The text Send sends for `item`: the user's edit, else empty.
export function draftText(item: WorkItem, view: InboxViewState): string {
  return view.drafts[item.id] ?? '';
}

// Whether `item` takes a reply: an open thread; a digest item never does.
export function takesReply(item: WorkItem): boolean {
  return item.state === 'open' && !isDigest(item.section);
}

// The item the cursor is on, among the shown cards; null for none.
export function cursorItem(
  work: WorkState,
  view: InboxViewState,
): WorkItem | null {
  return (
    shownItems(work, view).find((item) => item.id === view.cursorId) ?? null
  );
}

// The shown list's title: the filter key while a filter is set, else the section's name.
export function listTitle(view: InboxViewState): string {
  return view.ticketFilter ?? SECTION_TITLES[view.section];
}

// A card's age against `now` (epoch ms): work's `ageText`, `now` under a minute.
export function cardAge(at: string, now: number): string {
  return ageText(now - Date.parse(at)) ?? 'now';
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// The state Tag of an item that is not open; null for an open one.
function stateTag(item: WorkItem): string | null {
  switch (item.state) {
    case 'open':
      return null;
    case 'cleared':
    case 'dismissed':
      return item.state;
    case 'snoozed': {
      if (item.snoozedUntil === null) {
        return 'snoozed';
      }
      const until = new Date(item.snoozedUntil);
      return `snoozed until ${MONTHS[until.getMonth()]} ${until.getDate()}`;
    }
  }
}

// The cursor prompt's label of each card action a key runs; Send's key is its button's control hint instead.
const PROMPT_LABELS: Partial<Record<InboxCardAction, string>> = {
  snooze: 'snooze',
  dismiss: 'dismiss',
  restore: 'restore',
  startSession: 'session',
  addToBoard: 'board',
};

// The cursor card's key prompts: one per action its keys run, then `t` while it holds a ticket key.
function cardPrompt(
  item: WorkItem,
  actions: readonly InboxCardAction[],
): PromptActionInput[] {
  const prompt: PromptActionInput[] = [];
  for (const action of actions) {
    const label = PROMPT_LABELS[action];
    if (label !== undefined) {
      prompt.push({ command: qualify(PLUGIN_ID, action), label });
    }
  }
  if (item.ticketKeys.length > 0) {
    prompt.push({
      command: qualify(PLUGIN_ID, 'ticketOnBoard'),
      label: 'ticket',
    });
  }
  return prompt;
}

// Its section's name while the list mixes sections (All, or a ticket filter), else null.
function sectionTitleOf(item: WorkItem, view: InboxViewState): string | null {
  return isMixedList(view) ? SECTION_TITLES[item.section] : null;
}

// What the `card` part draws for `item`, aged against `now`.
export function cardInput(
  item: WorkItem,
  view: InboxViewState,
  now: number,
): CardInput {
  const isCursor = item.id === view.cursorId;
  return {
    id: item.id,
    section: item.section,
    sectionTitle: sectionTitleOf(item, view),
    channel: item.channel,
    author: item.author,
    age: cardAge(item.at, now),
    title: item.title,
    latest: item.latest,
    why: item.why,
    state: item.state,
    stateTag: stateTag(item),
    isSending: item.sending !== null,
    isDirect: item.section === 'needs_you',
    isDigest: isDigest(item.section),
    isUnseen: isUnseen(item),
    isCursor,
    note: item.note,
    prompt: isCursor ? cardPrompt(item, cardActions(item, view)) : [],
  };
}

// `Fetched just now` under a minute, else `Fetched <age> ago`.
function fetchedText(fetchedAt: string, now: number): string {
  const age = cardAge(fetchedAt, now);
  return age === 'now' ? 'Fetched just now' : `Fetched ${age} ago`;
}

function messageInput(message: DetailMessage, now: number): DetailMessageInput {
  return {
    author: message.author,
    age: cardAge(message.at, now),
    text: message.text,
  };
}

// What the `detail` part draws for `item` with its stored thread `detail` (null for none), aged against `now`.
export function detailInput(
  item: WorkItem,
  view: InboxViewState,
  detail: ThreadDetail | null,
  now: number,
): DetailInput {
  const replies =
    detail === null
      ? []
      : detail.replies.map((reply) => messageInput(reply, now));
  const hasHiddenReplies =
    detail !== null && detail.replyCount > replies.length;
  return {
    id: item.id,
    channel: item.channel,
    author: item.author,
    age: cardAge(item.at, now),
    title: item.title,
    sectionTitle: sectionTitleOf(item, view),
    stateTag: stateTag(item),
    fetched: detail === null ? null : fetchedText(detail.fetchedAt, now),
    participants: item.participants,
    tickets: item.ticketKeys.map((key) => ({ key, reason: item.linkReason })),
    summary: item.summary,
    why: item.why,
    root: detail === null ? null : messageInput(detail.root, now),
    replies,
    replyCountText: hasHiddenReplies
      ? `${replies.length} of ${detail.replyCount} replies`
      : null,
    draft: takesReply(item) ? (item.sending ?? draftText(item, view)) : null,
    isSending: item.sending !== null,
    isDigest: isDigest(item.section),
    note: item.note,
    url: item.url,
    actions: [...cardActions(item, view)],
  };
}
