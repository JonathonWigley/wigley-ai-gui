import { createHash } from 'node:crypto';
import {
  type FormBody,
  type MainItemKind,
  type Outcome,
  type PythonJsonValue,
  type Round,
  RoundError,
  type RoundEnd,
  type RoundErrorPath,
} from '../contract';
import {
  fieldsOutside,
  parseLayoutField,
  quotedList,
  requireText,
  textOrEmpty,
} from './kinds/fields';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import { APPROVAL_LINE_PREFIX } from './mcp-wording';

const LAYOUT_PATH: RoundErrorPath = { at: 'field', field: 'layout' };

// The round's own fields, before the kinds' lists.
const ROUND_OWN_FIELDS = ['heading', 'overview', 'layout'];

export type FinishedOutcome = RoundEnd['kind'];

// The outcomes a round that ran can report.
export type RoundOutcome = FinishedOutcome | 'draft' | 'auto_answered';

// Why a round result holds what it holds.
export type RoundReason =
  | { kind: 'finished' } // submitted or cancelled, returned plainly
  | { kind: 'stillOpen' } // a draft of the round the call waits on
  | { kind: 'autoAnswered' }
  | { kind: 'handedBack'; heading: string } // an earlier round's answers
  | { kind: 'notShown'; heading: string; blockingHeading: string | null }
  | { kind: 'noRound' };

// A round call's result as records. `results` holds each registered kind's
// results by kind id, index-parallel with that kind's items; a kind with no
// items holds [].
export interface RoundResult {
  outcome: Outcome;
  reason: RoundReason;
  results: Readonly<Record<string, readonly unknown[]>>;
  // '' when the user wrote none.
  note: string;
}

const REASON_OF_OUTCOME: Record<RoundOutcome, RoundReason> = {
  submitted: { kind: 'finished' },
  cancelled: { kind: 'finished' },
  draft: { kind: 'stillOpen' },
  auto_answered: { kind: 'autoAnswered' },
};

// a, b or c
function eitherList(names: string[]): string {
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function roundFields(kinds: readonly MainItemKind[]): string[] {
  return [...ROUND_OWN_FIELDS, ...kinds.map((kind) => kind.spec.argsKey)];
}

function parseItems(kind: MainItemKind, raw: unknown): unknown[] {
  const { id, argsKey } = kind.spec;
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: { at: 'field', field: argsKey },
      problem: `${argsKey} must be a list of objects.`,
    });
  }
  return raw.map((item, i) =>
    kind.parse(item, { at: 'item', kind: id, number: i + 1 }),
  );
}

// The kind's items in the round; a kind registered after the round parsed has
// none.
function itemsOf(round: Round, kind: MainItemKind): readonly unknown[] {
  return round.items[kind.spec.id] ?? [];
}

// The kind's entries in a body: the one place main narrows body entries.
export function bodyEntries(
  body: FormBody,
  kind: MainItemKind,
): readonly unknown[] {
  const entries = body[kind.spec.bodyKey];
  return Array.isArray(entries) ? entries : [];
}

// Every error fires here, before anything is shown, so a malformed round
// costs the caller one retry and the user sees nothing.
export function parseRound(
  kinds: readonly MainItemKind[],
  args: unknown,
): Round {
  const fields = roundFields(kinds);
  if (!isJsonObject(args)) {
    throw new RoundError({
      path: { at: 'call' },
      problem: `takes an object with ${quotedList(fields)}.`,
      detail: 'Each list is optional, but the round needs at least one item.',
    });
  }
  const unknownFields = fieldsOutside(args, fields);
  if (unknownFields.length > 0) {
    throw new RoundError({
      path: { at: 'call' },
      problem: `got unknown field(s): ${unknownFields.join(', ')}.`,
      detail: `It takes ${quotedList(fields)}.`,
    });
  }
  const heading = requireText(args.heading, 'heading', {
    at: 'field',
    field: 'heading',
  });
  // Optional here, required in the tool schema: a round saved before the
  // field existed still rebuilds from its stored args.
  const overview = Object.hasOwn(args, 'overview') ? args.overview : '';
  if (typeof overview !== 'string') {
    throw new RoundError({
      path: { at: 'field', field: 'overview' },
      problem: 'overview must be a string.',
    });
  }
  const layout = parseLayoutField(args, LAYOUT_PATH);
  const items: Record<string, unknown[]> = {};
  const bodyKeys: Record<string, string> = {};
  let itemCount = 0;
  for (const kind of kinds) {
    const parsed = parseItems(kind, args[kind.spec.argsKey] ?? []);
    items[kind.spec.id] = parsed;
    bodyKeys[kind.spec.id] = kind.spec.bodyKey;
    itemCount += parsed.length;
  }
  if (itemCount === 0) {
    const nouns = kinds.map((kind) => kind.noun);
    throw new RoundError({
      path: { at: 'call' },
      problem: `needs at least one ${eitherList(nouns)}.`,
    });
  }
  return {
    heading,
    overview: overview.trim(),
    layout,
    items,
    bodyKeys,
  };
}

function requireKnownLayout(
  name: string | null,
  at: RoundErrorPath,
  layoutNames: readonly string[],
): void {
  if (name !== null && !layoutNames.includes(name)) {
    throw new RoundError({
      path: at,
      problem:
        `layout '${name}' is not in the layouts folder, which holds ` +
        `${quotedList(layoutNames)}.`,
      detail: `Write ${name}/layout.js there first, or leave layout out.`,
    });
  }
}

// Throws a RoundError for the first layout the round names that is not in
// `layoutNames`: the round's own, then each item's in the kinds' order. Kept
// apart from parseRound, so a saved round still parses once its layout has
// left the folder.
export function requireKnownLayouts(
  kinds: readonly MainItemKind[],
  round: Round,
  layoutNames: readonly string[],
): void {
  requireKnownLayout(round.layout, LAYOUT_PATH, layoutNames);
  for (const kind of kinds) {
    itemsOf(round, kind).forEach((item, i) =>
      requireKnownLayout(
        kind.layout(item),
        { at: 'item', kind: kind.spec.id, number: i + 1 },
        layoutNames,
      ),
    );
  }
}

function entriesByIndex(list: unknown): Map<number, JsonObject> {
  const byIndex = new Map<number, JsonObject>();
  if (!Array.isArray(list)) {
    return byIndex;
  }
  for (const item of list) {
    if (isJsonObject(item) && Number.isInteger(item.index)) {
      byIndex.set(item.index as number, item);
    }
  }
  return byIndex;
}

// A body of `note` and each kind's entries at its bodyKey, in reverse
// registration order, so a body the built-ins alone wrote keeps its saved key
// order. The one place main builds a FormBody.
function bodyOf(
  kinds: readonly MainItemKind[],
  note: string,
  entriesOf: (kind: MainItemKind) => unknown[],
): FormBody {
  const body: Record<string, unknown> = { note };
  for (const kind of kinds.toReversed()) {
    body[kind.spec.bodyKey] = entriesOf(kind);
  }
  return body as FormBody;
}

// Any body — from the window or from a file another version wrote — as one
// entry per item of each registered kind, in order, each read against its
// item (a finding entry's action labels come from the pick, never the saved
// body). Never throws: a field of the wrong type reads as its empty value.
export function readFormBody(
  kinds: readonly MainItemKind[],
  round: Round,
  raw: unknown,
): FormBody {
  const body = isJsonObject(raw) ? raw : {};
  return bodyOf(kinds, textOrEmpty(body.note), (kind) => {
    const saved = entriesByIndex(body[kind.spec.bodyKey]);
    return itemsOf(round, kind).map((item, i) =>
      kind.readEntry(i + 1, saved.get(i + 1) ?? {}, item),
    );
  });
}

// The result for a round that ran, its reason read from `outcome`.
export function answersResult(
  kinds: readonly MainItemKind[],
  round: Round,
  outcome: RoundOutcome,
  body: FormBody,
): RoundResult {
  const read = readFormBody(kinds, round, body);
  const results: Record<string, unknown[]> = {};
  for (const kind of kinds) {
    const entries = bodyEntries(read, kind);
    results[kind.spec.id] = itemsOf(round, kind).map((item, i) =>
      kind.result(item, entries[i]),
    );
  }
  return {
    outcome,
    reason: REASON_OF_OUTCOME[outcome],
    results,
    note: read.note,
  };
}

// An earlier round's finished answers, returned by an open call that did not
// open its own round.
export function handedBackResult(
  kinds: readonly MainItemKind[],
  round: Round,
  outcome: FinishedOutcome,
  body: FormBody,
): RoundResult {
  return {
    ...answersResult(kinds, round, outcome, body),
    reason: { kind: 'handedBack', heading: round.heading },
  };
}

// A round never shown, so its answers are blank; `blockingHeading` names the
// open round it waited behind, when one is open.
export function notShownResult(
  kinds: readonly MainItemKind[],
  round: Round,
  blockingHeading: string | null,
): RoundResult {
  return {
    ...answersResult(kinds, round, 'draft', readFormBody(kinds, round, {})),
    reason: { kind: 'notShown', heading: round.heading, blockingHeading },
  };
}

// A collect call with nothing to collect: a normal result, not an error.
export function noRoundResult(kinds: readonly MainItemKind[]): RoundResult {
  return {
    outcome: 'no_round',
    reason: { kind: 'noRound' },
    results: Object.fromEntries(kinds.map((kind) => [kind.spec.id, []])),
    note: '',
  };
}

// The message a submit of `body` posts as the user's own: one
// `Approved in form:` line per action an answered item's pick approves, in the
// kinds' and items' order; null when no pick approves one.
export function approvalMessage(
  kinds: readonly MainItemKind[],
  round: Round,
  body: FormBody,
): string | null {
  const read = readFormBody(kinds, round, body);
  const actions: string[] = [];
  for (const kind of kinds) {
    const { approvedActions } = kind;
    if (approvedActions === undefined) {
      continue;
    }
    const entries = bodyEntries(read, kind);
    itemsOf(round, kind).forEach((item, i) =>
      actions.push(...approvedActions(item, entries[i])),
    );
  }
  return actions.length === 0
    ? null
    : actions.map((action) => `${APPROVAL_LINE_PREFIX}${action}`).join('\n');
}

// Every item on its kind's recommended entry, the note empty: the body a
// headless session's round is answered with.
export function recommendedBody(
  kinds: readonly MainItemKind[],
  round: Round,
): FormBody {
  return bodyOf(kinds, '', (kind) =>
    itemsOf(round, kind).map((item, i) => kind.recommendedEntry(item, i + 1)),
  );
}

// Python's json.dumps(value, sort_keys=True, ensure_ascii=False) for the
// strings, integers, lists and objects a fingerprint holds.
function pythonJsonDumps(value: PythonJsonValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonJsonDumps(item)).join(', ')}]`;
  }
  const members = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}: ${pythonJsonDumps(value[key])}`);
  return `{${members.join(', ')}}`;
}

// What a re-sent round is matched on: every field of its items but their
// layouts, keyed by each kind's round field, never the heading, overview
// or round layout, which a re-send may change and still match the open round.
// An empty list joins only for a kind whose spec says so (the kinds the
// Python server's fingerprint held), so a round it could send with no
// questions hashes the same and its saved rounds match.
export function fingerprint(
  kinds: readonly MainItemKind[],
  round: Round,
): string {
  const content: Record<string, PythonJsonValue> = {};
  for (const kind of kinds) {
    const items = itemsOf(round, kind).map((item) =>
      kind.fingerprintContent(item),
    );
    if (kind.spec.fingerprintJoinsWhenEmpty || items.length > 0) {
      content[kind.spec.argsKey] = items;
    }
  }
  const text = pythonJsonDumps(content);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
