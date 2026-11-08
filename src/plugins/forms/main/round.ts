import { createHash } from 'node:crypto';
import type {
  AnswerableKind,
  AnswerEntry,
  AnswerResult,
  AnswerStatus,
  AnswersPayload,
  Finding,
  FindingAnswerEntry,
  FindingResult,
  FormBody,
  ItemKind,
  Notice,
  NoticeResult,
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
import { ANSWERABLE_KINDS, FORMATS, ITEM_KINDS } from './kinds/formats';
import type {
  AnswerSubject,
  ItemFormat,
  ItemOf,
  PythonJsonValue,
} from './kinds/item-format';
import { RoundError } from './round-error';
import { capitalised } from '../../../shared/capitalised';
import { isJsonObject, type JsonObject } from '../../../shared/json';

const ITEM_FIELDS = ITEM_KINDS.map((kind) => FORMATS[kind].argsKey);
const ROUND_FIELDS = ['heading', 'overview', 'layout', ...ITEM_FIELDS];

// The `where` prefix of a message about the round's own fields.
const ROUND_WHERE = "ask_round's ";

export type FinishedOutcome = RoundEnd['kind'];

// The outcomes a round that ran can report.
export type RoundOutcome = FinishedOutcome | 'draft';

const NEXT_ON_DRAFT =
  'The user has not submitted yet. Call collect_last_round to keep waiting. ' +
  'Do not re-ask these questions and do not open a second round.';

const NEXT_ON_NO_ROUND =
  'No round is open for this session, and no finished answers are waiting ' +
  'for it. If you sent a round whose answers you never received, send the ' +
  "same round again with ask_round: the user's saved answers fill in. Do not " +
  'move the questions into the reply.';

// a, b or c
function eitherList(names: string[]): string {
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function parseItems<Item>(format: ItemFormat<Item>, raw: unknown): Item[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(
      `ask_round's ${format.argsKey} must be a list of objects.`,
    );
  }
  const noun = capitalised(format.noun);
  return raw.map((item, i) => format.parse(item, `${noun} ${i + 1}: `));
}

// Every error fires here, before anything is shown, so a malformed round
// costs the caller one retry and the user sees nothing.
export function parseRound(args: unknown): Round {
  if (!isJsonObject(args)) {
    throw new RoundError(
      `ask_round takes an object with ${quotedList(ROUND_FIELDS)}. Each list ` +
        `is optional, but the round needs at least one item.`,
    );
  }
  const unknownFields = fieldsOutside(args, ROUND_FIELDS);
  if (unknownFields.length > 0) {
    throw new RoundError(
      `ask_round got unknown field(s): ${unknownFields.join(', ')}. ` +
        `It takes ${quotedList(ROUND_FIELDS)}.`,
    );
  }
  const heading = requireText(args.heading, 'heading', '');
  // Optional here, required in the tool schema: a round saved before the
  // field existed still rebuilds from its stored args.
  const overview = Object.hasOwn(args, 'overview') ? args.overview : '';
  if (typeof overview !== 'string') {
    throw new RoundError("ask_round's overview must be a string.");
  }
  const layout = parseLayoutField(args, ROUND_WHERE);
  const notices = parseItems(
    FORMATS.notice,
    args[FORMATS.notice.argsKey] ?? [],
  );
  const findings = parseItems(
    FORMATS.finding,
    args[FORMATS.finding.argsKey] ?? [],
  );
  const questions = parseItems(
    FORMATS.question,
    args[FORMATS.question.argsKey] ?? [],
  );
  if (notices.length + findings.length + questions.length === 0) {
    const nouns = ITEM_KINDS.map((kind) => FORMATS[kind].noun);
    throw new RoundError(`ask_round needs at least one ${eitherList(nouns)}.`);
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
  where: string,
  layoutNames: readonly string[],
): void {
  if (name !== null && !layoutNames.includes(name)) {
    throw new RoundError(
      `${where}layout '${name}' is not in the layouts folder, which holds ` +
        `${quotedList(layoutNames)}. Write ${name}/layout.js there first, or ` +
        `leave layout out.`,
    );
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
  requireKnownLayout(round.layout, ROUND_WHERE, layoutNames);
  for (const kind of ITEM_KINDS) {
    const noun = capitalised(FORMATS[kind].noun);
    ROUND_ITEM_LISTS[kind](round).forEach((item, i) =>
      requireKnownLayout(item.layout, `${noun} ${i + 1}: `, layoutNames),
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

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? 's' : ''}`;
}

// Counted from the same statuses the answers carry, so the two never disagree.
function summarise(
  results: Record<AnswerableKind, AnswerResult[]>,
  stillOpen: boolean,
): string {
  const counted = ANSWERABLE_KINDS.filter((kind) => results[kind].length > 0);
  const parts = counted.map((kind) =>
    countOf(results[kind].length, FORMATS[kind].noun),
  );
  const items =
    parts.length > 0 ? parts.join(', ') : countOf(0, FORMATS.question.noun);
  const statuses = ANSWERABLE_KINDS.flatMap((kind) =>
    results[kind].map((result) => result.status),
  );
  const count = (status: AnswerStatus) =>
    statuses.filter((each) => each === status).length;
  const line =
    `${items}: ${count('answered')} answered, ` +
    `${count('not_applicable')} not applicable, ${count('untouched')} untouched.`;
  return stillOpen ? `${line} The form is still open.` : line;
}

// The tool result for a round that ran. `answers`, `findings` and `notices`
// are index-parallel with the round's questions, findings and notices; notes
// appear only when the user wrote some; `dont_ask` only on a pressed answer.
export function answersPayload(
  round: Round,
  outcome: RoundOutcome,
  body: FormBody,
): AnswersPayload {
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
  const stillOpen = outcome === 'draft';
  const payload: AnswersPayload = {
    outcome,
    summary: summarise({ finding: findings, question: answers }, stillOpen),
    next: stillOpen ? NEXT_ON_DRAFT : '',
    answers,
    findings,
    notices,
  };
  if (read.note) {
    payload.note = read.note;
  }
  return payload;
}

// An earlier round's finished answers, returned by an ask_round that did not
// open its own round.
export function handedBackPayload(
  round: Round,
  outcome: FinishedOutcome,
  body: FormBody,
): AnswersPayload {
  const payload = answersPayload(round, outcome, body);
  payload.next =
    `These answers are for an earlier round, '${round.heading}', that you ` +
    `never received. Read them as that round's answers. The round you just ` +
    `sent was not opened: send it again with ask_round.`;
  payload.earlier_heading = round.heading;
  return payload;
}

// collect_last_round with nothing to collect: a normal payload, not an error.
export function noRoundPayload(): AnswersPayload {
  return {
    outcome: 'no_round',
    summary: 'No round is open.',
    next: NEXT_ON_NO_ROUND,
    answers: [],
    findings: [],
    notices: [],
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
// layouts, keyed by each kind's ask_round field, never the heading, overview
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
