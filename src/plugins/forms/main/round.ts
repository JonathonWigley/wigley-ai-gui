import { createHash } from 'node:crypto';
import type {
  AnswerEntry,
  AnswerResult,
  AnswerStatus,
  Finding,
  FindingAnswerEntry,
  FindingResult,
  FormBody,
  ItemKind,
  Notice,
  NoticeResult,
  Outcome,
  Round,
  RoundEnd,
} from '../contract';
import { completeFindingPick, isFindingAction } from '../finding-pick';
import { isAnswered } from '../item-response';
import {
  fieldsOutside,
  parseLayoutField,
  quotedList,
  requireText,
} from './kinds/fields';
import { FORMATS, ITEM_KINDS } from './kinds/formats';
import type {
  AnswerSubject,
  ItemFormat,
  ItemOf,
  PythonJsonValue,
} from './kinds/item-format';
import { RoundError, type RoundErrorPath } from './round-error';
import { isJsonObject, type JsonObject } from '../../../shared/json';

const ITEM_FIELDS = ITEM_KINDS.map((kind) => FORMATS[kind].argsKey);
const ROUND_FIELDS = ['heading', 'overview', 'layout', ...ITEM_FIELDS];

const LAYOUT_PATH: RoundErrorPath = { at: 'field', field: 'layout' };

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

// A round call's result as records. `answers`, `findings` and `notices` are
// index-parallel with the round's questions, findings and notices; notes
// appear only when the user wrote some; `dont_ask` only on a pressed answer.
export interface RoundResult {
  outcome: Outcome;
  reason: RoundReason;
  answers: AnswerResult[];
  findings: FindingResult[];
  notices: NoticeResult[];
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

function parseItems<Item>(
  kind: ItemKind,
  format: ItemFormat<Item>,
  raw: unknown,
): Item[] {
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: { at: 'field', field: format.argsKey },
      problem: `${format.argsKey} must be a list of objects.`,
    });
  }
  return raw.map((item, i) =>
    format.parse(item, { at: 'item', kind, number: i + 1 }),
  );
}

// Every error fires here, before anything is shown, so a malformed round
// costs the caller one retry and the user sees nothing.
export function parseRound(args: unknown): Round {
  if (!isJsonObject(args)) {
    throw new RoundError({
      path: { at: 'call' },
      problem: `takes an object with ${quotedList(ROUND_FIELDS)}.`,
      detail: 'Each list is optional, but the round needs at least one item.',
    });
  }
  const unknownFields = fieldsOutside(args, ROUND_FIELDS);
  if (unknownFields.length > 0) {
    throw new RoundError({
      path: { at: 'call' },
      problem: `got unknown field(s): ${unknownFields.join(', ')}.`,
      detail: `It takes ${quotedList(ROUND_FIELDS)}.`,
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
  const notices = parseItems(
    'notice',
    FORMATS.notice,
    args[FORMATS.notice.argsKey] ?? [],
  );
  const findings = parseItems(
    'finding',
    FORMATS.finding,
    args[FORMATS.finding.argsKey] ?? [],
  );
  const questions = parseItems(
    'question',
    FORMATS.question,
    args[FORMATS.question.argsKey] ?? [],
  );
  if (notices.length + findings.length + questions.length === 0) {
    const nouns = ITEM_KINDS.map((kind) => FORMATS[kind].noun);
    throw new RoundError({
      path: { at: 'call' },
      problem: `needs at least one ${eitherList(nouns)}.`,
    });
  }
  return {
    heading,
    overview: overview.trim(),
    layout,
    questions,
    notices,
    findings,
  };
}

// Each kind's items in a round.
const ROUND_ITEM_LISTS: {
  readonly [Kind in ItemKind]: (round: Round) => ItemOf[Kind][];
} = {
  notice: (round) => round.notices,
  finding: (round) => round.findings,
  question: (round) => round.questions,
};

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
// `layoutNames`: the round's own, then each item's in ITEM_KINDS order. Kept
// apart from parseRound, so a saved round still parses once its layout has
// left the folder.
export function requireKnownLayouts(
  round: Round,
  layoutNames: readonly string[],
): void {
  requireKnownLayout(round.layout, LAYOUT_PATH, layoutNames);
  for (const kind of ITEM_KINDS) {
    ROUND_ITEM_LISTS[kind](round).forEach((item, i) =>
      requireKnownLayout(
        item.layout,
        { at: 'item', kind, number: i + 1 },
        layoutNames,
      ),
    );
  }
}

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

// A file written before the Notes box held its text in 'what' and 'why'.
function oldFileNotes(entry: JsonObject): string {
  return [textOrEmpty(entry.what), textOrEmpty(entry.why)]
    .filter((text) => text !== '')
    .join('\n\n');
}

function readAnswerEntry(index: number, entry: JsonObject): AnswerEntry {
  return {
    index,
    choice: Number.isInteger(entry.choice) ? (entry.choice as number) : 0,
    not_applicable: entry.not_applicable === true,
    notes: Object.hasOwn(entry, 'notes')
      ? textOrEmpty(entry.notes)
      : oldFileNotes(entry),
    dont_ask: entry.dont_ask === true,
    dont_ask_reason: textOrEmpty(entry.dont_ask_reason),
  };
}

// A saved action outside the three, or none, reads as no action.
function readFindingAnswerEntry(
  index: number,
  entry: JsonObject,
): FindingAnswerEntry {
  return {
    ...readAnswerEntry(index, entry),
    action: isFindingAction(entry.action) ? entry.action : '',
  };
}

function readAnswerEntries<Entry>(
  items: readonly unknown[],
  saved: unknown,
  readEntry: (index: number, entry: JsonObject) => Entry,
): Entry[] {
  const entries = entriesByIndex(saved);
  return items.map((_, i) => readEntry(i + 1, entries.get(i + 1) ?? {}));
}

// Any body — from the window or from a file another version wrote — as one
// answer per question and per finding and one comment per notice, in order.
// Never throws: a field of the wrong type reads as its empty value.
export function readFormBody(round: Round, raw: unknown): FormBody {
  const body = isJsonObject(raw) ? raw : {};
  const comments = entriesByIndex(body.notice_comments);
  return {
    note: textOrEmpty(body.note),
    answers: readAnswerEntries(round.questions, body.answers, readAnswerEntry),
    finding_answers: readAnswerEntries(
      round.findings,
      body.finding_answers,
      readFindingAnswerEntry,
    ),
    notice_comments: round.notices.map((_, i) => ({
      index: i + 1,
      comment: textOrEmpty(comments.get(i + 1)?.comment),
    })),
  };
}

function answerResult(
  subject: AnswerSubject,
  entry: AnswerEntry,
): AnswerResult {
  const choiceIsInRange =
    entry.choice >= 1 && entry.choice <= subject.choiceTexts.length;
  const answered = isAnswered({
    notApplicable: entry.not_applicable,
    pickIsComplete: choiceIsInRange,
  });
  let status: AnswerStatus = 'untouched';
  if (entry.not_applicable) {
    status = 'not_applicable';
  } else if (answered) {
    status = 'answered';
  }
  const result: AnswerResult = {
    index: entry.index,
    title: subject.title,
    status,
    choice: answered ? entry.choice : 0,
    choice_text: answered ? subject.choiceTexts[entry.choice - 1] : '',
    took_recommendation: answered && entry.choice === subject.recommend,
  };
  addNotesAndDontAsk(result, entry);
  return result;
}

// A finding is answered (`isAnswered`) once its entry holds one of the card's
// numbered picks (`findingEntries`): a choice with the action it sits under,
// or the header of an action with no choices, whose `choice` is 0; notes alone
// leave it untouched. The recommendation is taken whole when the pick is the
// recommended choice, or the recommended header, under recommend_action.
function findingResult(
  finding: Finding,
  entry: FindingAnswerEntry,
): FindingResult {
  const subject = FORMATS.finding.answerSubject(finding);
  const completePick = completeFindingPick(finding, entry.choice, entry.action);
  const answered = isAnswered({
    notApplicable: entry.not_applicable,
    pickIsComplete: completePick !== null,
  });
  const pick = answered ? completePick : null;
  let status: AnswerStatus = 'untouched';
  if (entry.not_applicable) {
    status = 'not_applicable';
  } else if (answered) {
    status = 'answered';
  }
  const choice = pick?.choice ?? 0;
  const tookActionRecommendation =
    pick !== null && pick.action === finding.recommend_action;
  const result: FindingResult = {
    index: entry.index,
    title: subject.title,
    status,
    choice,
    choice_text: choice > 0 ? subject.choiceTexts[choice - 1] : '',
    took_recommendation:
      tookActionRecommendation && pick.choice === subject.recommend,
    action: pick?.action ?? '',
    took_action_recommendation: tookActionRecommendation,
  };
  addNotesAndDontAsk(result, entry);
  return result;
}

// Notes appear only when the user wrote some; `dont_ask` only on a pressed
// answer, with its reason when the box held text.
function addNotesAndDontAsk(result: AnswerResult, entry: AnswerEntry): void {
  if (entry.notes) {
    result.notes = entry.notes;
  }
  if (entry.dont_ask) {
    result.dont_ask = true;
    if (entry.dont_ask_reason) {
      result.dont_ask_reason = entry.dont_ask_reason;
    }
  }
}

function noticeResult(
  notice: Notice,
  index: number,
  comment: string,
): NoticeResult {
  const result: NoticeResult = {
    index,
    title: notice.title,
    badge: notice.badge,
  };
  if (comment) {
    result.comment = comment;
  }
  return result;
}

// The result for a round that ran, its reason read from `outcome`.
export function answersResult(
  round: Round,
  outcome: RoundOutcome,
  body: FormBody,
): RoundResult {
  const read = readFormBody(round, body);
  const answers = round.questions.map((question, i) =>
    answerResult(FORMATS.question.answerSubject(question), read.answers[i]),
  );
  const findings = round.findings.map((finding, i) =>
    findingResult(finding, read.finding_answers[i]),
  );
  const notices = round.notices.map((notice, i) =>
    noticeResult(notice, i + 1, read.notice_comments[i].comment),
  );
  return {
    outcome,
    reason: REASON_OF_OUTCOME[outcome],
    answers,
    findings,
    notices,
    note: read.note,
  };
}

// An earlier round's finished answers, returned by an open call that did not
// open its own round.
export function handedBackResult(
  round: Round,
  outcome: FinishedOutcome,
  body: FormBody,
): RoundResult {
  return {
    ...answersResult(round, outcome, body),
    reason: { kind: 'handedBack', heading: round.heading },
  };
}

// A round never shown, so its answers are blank; `blockingHeading` names the
// open round it waited behind, when one is open.
export function notShownResult(
  round: Round,
  blockingHeading: string | null,
): RoundResult {
  return {
    ...answersResult(round, 'draft', readFormBody(round, {})),
    reason: { kind: 'notShown', heading: round.heading, blockingHeading },
  };
}

// A collect call with nothing to collect: a normal result, not an error.
export function noRoundResult(): RoundResult {
  return {
    outcome: 'no_round',
    reason: { kind: 'noRound' },
    answers: [],
    findings: [],
    notices: [],
    note: '',
  };
}

// Every question and finding on its recommendation, every note and comment
// empty: the body a headless session's round is answered with.
export function recommendedBody(round: Round): FormBody {
  const recommended = (index: number, choice: number): AnswerEntry => ({
    index,
    choice,
    not_applicable: false,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
  });
  return {
    note: '',
    answers: round.questions.map((question, i) =>
      recommended(i + 1, question.recommend),
    ),
    finding_answers: round.findings.map((finding, i) => ({
      ...recommended(i + 1, finding.recommend ?? 0),
      action: finding.recommend_action,
    })),
    notice_comments: round.notices.map((_, i) => ({
      index: i + 1,
      comment: '',
    })),
  };
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

interface FingerprintList {
  // The Python server's fingerprint holds this list even when it is empty.
  joinsWhenEmpty: boolean;
  content(round: Round): PythonJsonValue[];
}

const FINGERPRINT_LISTS = {
  notice: {
    joinsWhenEmpty: true,
    content: (round) =>
      round.notices.map((notice) => FORMATS.notice.fingerprintContent(notice)),
  },
  finding: {
    joinsWhenEmpty: false,
    content: (round) =>
      round.findings.map((finding) =>
        FORMATS.finding.fingerprintContent(finding),
      ),
  },
  question: {
    joinsWhenEmpty: true,
    content: (round) =>
      round.questions.map((question) =>
        FORMATS.question.fingerprintContent(question),
      ),
  },
} satisfies Record<ItemKind, FingerprintList>;

// What a re-sent round is matched on: every field of its items but their
// layouts, keyed by each kind's round field, never the heading, overview
// or round layout, which a re-send may change and still match the open round.
// An empty list joins only for a kind the Python server's fingerprint holds,
// so a round it could send with no questions hashes the same and its saved
// rounds match.
export function fingerprint(round: Round): string {
  const content: Record<string, PythonJsonValue> = {};
  for (const kind of ITEM_KINDS) {
    const list = FINGERPRINT_LISTS[kind];
    const items = list.content(round);
    if (list.joinsWhenEmpty || items.length > 0) {
      content[FORMATS[kind].argsKey] = items;
    }
  }
  const text = pythonJsonDumps(content);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
