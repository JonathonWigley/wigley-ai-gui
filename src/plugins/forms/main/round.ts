import { createHash } from 'node:crypto';
import type {
  AnswerableKind,
  AnswerEntry,
  AnswerResult,
  AnswerStatus,
  AnswersPayload,
  FormBody,
  Notice,
  NoticeResult,
  Round,
  RoundEnd,
} from '../contract';
import {
  fieldsOutside,
  isObject,
  type JsonObject,
  requireText,
} from './kinds/fields';
import { ANSWERABLE_KINDS, FORMATS, ITEM_KINDS } from './kinds/formats';
import type {
  AnswerSubject,
  ItemFormat,
  PythonJsonValue,
} from './kinds/item-format';
import { RoundError } from './round-error';

const ITEM_FIELDS = ITEM_KINDS.map((kind) => FORMATS[kind].argsKey);
const ROUND_FIELDS = ['heading', 'overview', ...ITEM_FIELDS];

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

// 'a', 'b', and 'c'
function quotedList(names: string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted.at(-1)}`;
}

// a, b or c
function eitherList(names: string[]): string {
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseItems<Item>(format: ItemFormat<Item>, raw: unknown): Item[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(
      `ask_round's ${format.argsKey} must be a list of objects.`,
    );
  }
  if (raw.length > format.maxItems) {
    throw new RoundError(
      `ask_round got ${raw.length} ${format.argsKey}; the maximum is ` +
        `${format.maxItems}. Split the round.`,
    );
  }
  const noun = capitalised(format.noun);
  return raw.map((item, i) => format.parse(item, `${noun} ${i + 1}: `));
}

// Every error fires here, before anything is shown, so a malformed round
// costs the caller one retry and the user sees nothing.
export function parseRound(args: unknown): Round {
  if (!isObject(args)) {
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
    questions,
    notices,
    findings,
  };
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
    if (isObject(item) && Number.isInteger(item.index)) {
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

function readAnswerEntries(
  items: readonly unknown[],
  saved: unknown,
): AnswerEntry[] {
  const entries = entriesByIndex(saved);
  return items.map((_, i) => readAnswerEntry(i + 1, entries.get(i + 1) ?? {}));
}

// Any body — from the window or from a file another version wrote — as one
// answer per question and per finding and one comment per notice, in order.
// Never throws: a field of the wrong type reads as its empty value.
export function readFormBody(round: Round, raw: unknown): FormBody {
  const body = isObject(raw) ? raw : {};
  const comments = entriesByIndex(body.notice_comments);
  return {
    note: textOrEmpty(body.note),
    answers: readAnswerEntries(round.questions, body.answers),
    finding_answers: readAnswerEntries(round.findings, body.finding_answers),
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
  const answered = !entry.not_applicable && choiceIsInRange;
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
  if (entry.notes) {
    result.notes = entry.notes;
  }
  if (entry.dont_ask) {
    result.dont_ask = true;
    if (entry.dont_ask_reason) {
      result.dont_ask_reason = entry.dont_ask_reason;
    }
  }
  return result;
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
    answerResult(
      FORMATS.finding.answerSubject(finding),
      read.finding_answers[i],
    ),
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

// What a re-sent round is matched on: every field of its questions, notices
// and findings, never the heading or overview, which a re-send may reword.
// Findings join the text only when the round has some, so a round without
// them equals the Python server's fingerprint and its saved rounds still match.
export function fingerprint(round: Round): string {
  const content: Record<string, PythonJsonValue> = {
    questions: round.questions.map((question) =>
      FORMATS.question.fingerprintContent(question),
    ),
    notices: round.notices.map((notice) =>
      FORMATS.notice.fingerprintContent(notice),
    ),
  };
  if (round.findings.length > 0) {
    content.findings = round.findings.map((finding) =>
      FORMATS.finding.fingerprintContent(finding),
    );
  }
  const text = pythonJsonDumps(content);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
