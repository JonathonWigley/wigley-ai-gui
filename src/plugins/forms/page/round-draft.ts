import type { PluginLog } from '../../../contracts/log';
import type { FormBody, ItemKind, PageKind, PresentedRound } from '../contract';
import type { PageKindTable } from './kinds/page-kinds';
import {
  answerableItems,
  type HeldEntries,
  kindItems,
  NOTICE_KIND,
  type NoticeAnswer,
  type RailItem,
  railItems,
  type RoundState,
  sameRailItem,
} from './round-model';

// The saved-round body: `note`, then each registered kind's `restore.encode`
// at main's bodyKey for it, in reverse registration order, then each held
// kind's entries unchanged, in main's kind order. A registered kind main gave
// no bodyKey for has no items and writes nothing.
export function buildBody(round: RoundState): FormBody {
  const body: Record<string, unknown> = { note: round.note };
  for (const kind of round.kinds.kinds().toReversed()) {
    const { id } = kind.spec;
    const bodyKey = round.round.bodyKeys[id];
    if (bodyKey !== undefined) {
      body[bodyKey] = kind.restore.encode(round.itemAnswers[id]);
    }
  }
  for (const id of Object.keys(round.round.bodyKeys)) {
    const held = round.heldEntries[id];
    if (held !== undefined) {
      body[held.bodyKey] = held.entries;
    }
  }
  return body as FormBody;
}

// The entries a body holds at `bodyKey`; none for a missing or malformed key.
function draftEntries(
  draft: FormBody | null,
  bodyKey: string | undefined,
): readonly unknown[] {
  const entries = bodyKey === undefined ? undefined : draft?.[bodyKey];
  return Array.isArray(entries) ? entries : [];
}

// The kind's answers to round `formId`'s `items` as its `restore.decode` reads
// them from `entries`. A decode that gives a count other than the items' is
// logged, and the kind's empty draft takes its place.
function decodeAnswers(
  kind: PageKind,
  items: readonly unknown[],
  entries: readonly unknown[],
  formId: string,
  log: PluginLog,
): readonly unknown[] {
  const answers = kind.restore.decode(items, entries);
  if (answers.length === items.length) {
    return answers;
  }
  log(
    `round ${formId}: page kind ${kind.spec.id} decoded ${answers.length} answers where its items need ${items.length}; its draft starts empty`,
  );
  const empty = kind.restore.decode(items, []);
  if (empty.length !== items.length) {
    throw new Error(
      `page kind ${kind.spec.id} decodes no entries to ${empty.length} answers where its items need ${items.length}`,
    );
  }
  return empty;
}

// Each registered kind's answers restore from main's bodyKey for it, its own
// spec's when main gave none; each kind main gave a bodyKey and the page no
// registration holds its entries. A kind's decode of the wrong count is
// logged through `log` (`decodeAnswers`).
export function restoreRound(
  presented: PresentedRound,
  kinds: PageKindTable,
  log: PluginLog,
): RoundState {
  const { roundId, sessionId, label, round, draft } = presented;
  const itemAnswers: Record<ItemKind, readonly unknown[]> = {};
  for (const kind of kinds.kinds()) {
    const { id, bodyKey } = kind.spec;
    itemAnswers[id] = decodeAnswers(
      kind,
      kindItems(round, id),
      draftEntries(draft, round.bodyKeys[id] ?? bodyKey),
      roundId,
      log,
    );
  }
  const heldEntries: Record<ItemKind, HeldEntries> = {};
  for (const [id, bodyKey] of Object.entries(round.bodyKeys)) {
    if (kinds.get(id) === undefined) {
      heldEntries[id] = { bodyKey, entries: draftEntries(draft, bodyKey) };
    }
  }
  const notices = (itemAnswers[NOTICE_KIND] ?? []) as readonly NoticeAnswer[];
  const noticeTotal = kindItems(round, NOTICE_KIND).length;
  return {
    formId: roundId,
    sessionId,
    label,
    round,
    kinds,
    itemAnswers,
    heldEntries,
    openNotices: Array.from(
      { length: noticeTotal },
      (_, i) => (notices[i]?.comment ?? '') !== '',
    ),
    noticeLine: noticeTotal > 0 ? 1 : 0,
    note: draft?.note ?? '',
    focus: 0,
    reviewRow: 0,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
    sending: null,
  };
}

// The round with `next` in place of the kinds it was derived with: a kind that
// left encodes its answers into `heldEntries` when main gave a bodyKey for it,
// and drops them otherwise; a kind that arrived decodes its held entries; and
// a kind replaced under its id encodes with the old and decodes with the new,
// each decode checked as `decodeAnswers` checks it. Focus and the review
// cursor stay on their item while it is still there, else clamp to their old
// position held to the last stop or row. Not an edit.
export function rederiveRound(
  round: RoundState,
  next: PageKindTable,
  log: PluginLog,
): RoundState {
  if (round.kinds === next) {
    return round;
  }
  const itemAnswers: Record<ItemKind, readonly unknown[]> = {};
  const heldEntries: Record<ItemKind, HeldEntries> = { ...round.heldEntries };
  for (const old of round.kinds.kinds()) {
    const { id } = old.spec;
    const now = next.get(id);
    const answers = round.itemAnswers[id];
    if (now === old) {
      itemAnswers[id] = answers;
      continue;
    }
    const entries = old.restore.encode(answers);
    const bodyKey = round.round.bodyKeys[id];
    if (now !== undefined) {
      itemAnswers[id] = decodeAnswers(
        now,
        kindItems(round.round, id),
        entries,
        round.formId,
        log,
      );
    } else if (bodyKey !== undefined) {
      heldEntries[id] = { bodyKey, entries };
    }
  }
  for (const kind of next.kinds()) {
    const { id } = kind.spec;
    if (itemAnswers[id] === undefined) {
      itemAnswers[id] = decodeAnswers(
        kind,
        kindItems(round.round, id),
        heldEntries[id]?.entries ?? [],
        round.formId,
        log,
      );
      delete heldEntries[id];
    }
  }
  const derived: RoundState = {
    ...round,
    kinds: next,
    itemAnswers,
    heldEntries,
  };
  return {
    ...derived,
    focus: keptPosition(
      railItems(derived),
      railItems(round)[round.focus],
      round.focus,
    ),
    reviewRow: keptPosition(
      answerableItems(derived),
      answerableItems(round)[round.reviewRow],
      round.reviewRow,
    ),
  };
}

// The position of `item` in `items`; when absent, `position` held to the last
// one.
function keptPosition<Item extends RailItem>(
  items: readonly Item[],
  item: Item | undefined,
  position: number,
): number {
  const kept =
    item === undefined
      ? -1
      : items.findIndex((candidate) => sameRailItem(candidate, item));
  return kept >= 0 ? kept : Math.min(position, Math.max(items.length - 1, 0));
}
