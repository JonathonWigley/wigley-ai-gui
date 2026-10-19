import { createHash } from 'node:crypto';
import type {
  AnswerEntry,
  AnswerResult,
  AnswerStatus,
  AnswersPayload,
  FormBody,
  Notice,
  NoticeBadge,
  NoticeResult,
  Question,
  Round,
  RoundEnd,
} from '../contract';
import { RoundError } from './round-error';

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 10;
export const MAX_QUESTIONS = 20;
export const MAX_NOTICES = 50;

export const NOTICE_BADGES: readonly NoticeBadge[] = [
  'Applied',
  'Dispatched',
  'Decided',
];
export const DEFAULT_NOTICE_BADGE: NoticeBadge = 'Applied';

const ROUND_FIELDS = ['heading', 'overview', 'questions', 'notices'];
const QUESTION_FIELDS = [
  'title',
  'context',
  'question',
  'choices',
  'recommend',
  'rationale',
];
const NOTICE_REQUIRED_FIELDS = ['title', 'context'];
const NOTICE_FIELDS = [...NOTICE_REQUIRED_FIELDS, 'badge'];

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

type JsonObject = Record<string, unknown>;

type PythonJsonValue =
  | string
  | number
  | PythonJsonValue[]
  | { [key: string]: PythonJsonValue };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Python's type names, so messages read as they did from the Python server.
function pythonTypeName(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NoneType';
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return 'str';
  }
  return Array.isArray(value) ? 'list' : 'dict';
}

// Python's repr for the values a badge can hold.
function pythonRepr(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (value === null || value === undefined) {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  return JSON.stringify(value);
}

function requireText(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RoundError(
      `${where}${field} must be a non-empty string. Give it the text you ` +
        `would have written in the reply.`,
    );
  }
  return value;
}

function fieldsMissing(item: JsonObject, required: string[]): string[] {
  return required.filter((field) => !Object.hasOwn(item, field)).sort();
}

function fieldsOutside(item: JsonObject, allowed: string[]): string[] {
  return Object.keys(item)
    .filter((field) => !allowed.includes(field))
    .sort();
}

function isNoticeBadge(value: unknown): value is NoticeBadge {
  return (NOTICE_BADGES as readonly unknown[]).includes(value);
}

function parseNotice(item: unknown, where: string): Notice {
  if (!isObject(item)) {
    throw new RoundError(`${where}each notice must be an object.`);
  }
  const missing = fieldsMissing(item, NOTICE_REQUIRED_FIELDS);
  if (missing.length > 0) {
    throw new RoundError(
      `${where}missing ${missing.join(', ')}. Both fields are ` +
        `required: title, context.`,
    );
  }
  const extra = fieldsOutside(item, NOTICE_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}unknown field(s) ${extra.join(', ')}. A notice takes ` +
        `only title, context, and the optional badge; the form draws its own ` +
        `comment box, and a notice has no choices to describe.`,
    );
  }
  const title = requireText(item.title, 'title', where);
  const context = requireText(item.context, 'context', where);
  const badge = Object.hasOwn(item, 'badge')
    ? item.badge
    : DEFAULT_NOTICE_BADGE;
  if (!isNoticeBadge(badge)) {
    throw new RoundError(
      `${where}badge must be one of ${NOTICE_BADGES.join(', ')}, not ` +
        `${pythonRepr(badge)}. Use 'Applied' for a fix already landed, ` +
        `'Dispatched' for one still in flight, and 'Decided' for a ` +
        `decision you took alone.`,
    );
  }
  return { title, context, badge };
}

function parseNotices(raw: unknown): Notice[] {
  if (!Array.isArray(raw)) {
    throw new RoundError("ask_round's notices must be a list of objects.");
  }
  if (raw.length > MAX_NOTICES) {
    throw new RoundError(
      `ask_round got ${raw.length} notices; the maximum is ${MAX_NOTICES}. ` +
        `Split the round.`,
    );
  }
  return raw.map((item, i) => parseNotice(item, `Notice ${i + 1}: `));
}

function parseChoices(raw: unknown, where: string): string[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(`${where}choices must be a list of strings.`);
  }
  if (raw.length < MIN_CHOICES) {
    throw new RoundError(
      `${where}has ${raw.length} choice(s). A question with fewer than ` +
        `${MIN_CHOICES} is not a question — give at least ${MIN_CHOICES}.`,
    );
  }
  if (raw.length > MAX_CHOICES) {
    throw new RoundError(
      `${where}has ${raw.length} choices; the maximum is ${MAX_CHOICES}. ` +
        `Split it into two questions.`,
    );
  }
  return raw.map((choice, i) =>
    requireText(choice, `choices[${i + 1}]`, where),
  );
}

function parseRecommend(
  raw: unknown,
  title: string,
  choiceCount: number,
  where: string,
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RoundError(
      `${where}recommend must be the 1-based number of the recommended ` +
        `choice, not ${pythonTypeName(raw)}.`,
    );
  }
  if (raw < 1 || raw > choiceCount) {
    throw new RoundError(
      `${where}'${title}' has ${choiceCount} choices; recommend was ` +
        `${raw}. Use a number from 1 to ${choiceCount}.`,
    );
  }
  return raw;
}

function parseQuestion(item: unknown, where: string): Question {
  if (!isObject(item)) {
    throw new RoundError(`${where}each question must be an object.`);
  }
  const missing = fieldsMissing(item, QUESTION_FIELDS);
  if (missing.length > 0) {
    throw new RoundError(
      `${where}missing ${missing.join(', ')}. All six fields are ` +
        `required: title, context, question, choices, recommend, rationale.`,
    );
  }
  const extra = fieldsOutside(item, QUESTION_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}unknown field(s) ${extra.join(', ')}. The form draws ` +
        `the not-applicable control and the 'what' and 'why' boxes itself; ` +
        `do not describe them.`,
    );
  }
  const title = requireText(item.title, 'title', where);
  const context = requireText(item.context, 'context', where);
  const question = requireText(item.question, 'question', where);
  const rationale = requireText(item.rationale, 'rationale', where);
  const choices = parseChoices(item.choices, where);
  const recommend = parseRecommend(
    item.recommend,
    title,
    choices.length,
    where,
  );
  return { title, context, question, choices, recommend, rationale };
}

function parseQuestions(raw: unknown, noticeCount: number): Question[] {
  if (!Array.isArray(raw)) {
    throw new RoundError("ask_round's questions must be a list.");
  }
  if (raw.length === 0 && noticeCount === 0) {
    throw new RoundError('ask_round needs at least one question or notice.');
  }
  if (raw.length > MAX_QUESTIONS) {
    throw new RoundError(
      `ask_round got ${raw.length} questions; the maximum is ${MAX_QUESTIONS}. ` +
        `Split the round.`,
    );
  }
  return raw.map((item, i) => parseQuestion(item, `Question ${i + 1}: `));
}

// Every error fires here, before anything is shown, so a malformed round
// costs the caller one retry and the user sees nothing.
export function parseRound(args: unknown): Round {
  if (!isObject(args)) {
    throw new RoundError(
      "ask_round takes an object with 'heading', 'overview', 'questions', " +
        "and 'notices'. 'questions' is optional when 'notices' is given.",
    );
  }
  const unknownFields = fieldsOutside(args, ROUND_FIELDS);
  if (unknownFields.length > 0) {
    throw new RoundError(
      `ask_round got unknown field(s): ${unknownFields.join(', ')}. ` +
        `It takes 'heading', 'overview', 'questions', and 'notices'.`,
    );
  }
  const heading = requireText(args.heading, 'heading', '');
  // Optional here, required in the tool schema: a round saved before the
  // field existed still rebuilds from its stored args.
  const overview = Object.hasOwn(args, 'overview') ? args.overview : '';
  if (typeof overview !== 'string') {
    throw new RoundError("ask_round's overview must be a string.");
  }
  const notices = parseNotices(args.notices ?? []);
  const questions = parseQuestions(args.questions ?? [], notices.length);
  return { heading, overview: overview.trim(), questions, notices };
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

function readAnswerEntry(index: number, entry: JsonObject): AnswerEntry {
  return {
    index,
    choice: Number.isInteger(entry.choice) ? (entry.choice as number) : 0,
    not_applicable: entry.not_applicable === true,
    what: textOrEmpty(entry.what),
    why: textOrEmpty(entry.why),
    dont_ask: entry.dont_ask === true,
    dont_ask_reason: textOrEmpty(entry.dont_ask_reason),
  };
}

// Any body — from the window or from a file another version wrote — as one
// answer per question and one comment per notice, in order. Never throws: a
// field of the wrong type reads as its empty value.
export function readFormBody(round: Round, raw: unknown): FormBody {
  const body = isObject(raw) ? raw : {};
  const answers = entriesByIndex(body.answers);
  const comments = entriesByIndex(body.notice_comments);
  return {
    note: textOrEmpty(body.note),
    answers: round.questions.map((_, i) =>
      readAnswerEntry(i + 1, answers.get(i + 1) ?? {}),
    ),
    notice_comments: round.notices.map((_, i) => ({
      index: i + 1,
      comment: textOrEmpty(comments.get(i + 1)?.comment),
    })),
  };
}

function answerResult(question: Question, entry: AnswerEntry): AnswerResult {
  const choiceIsInRange =
    entry.choice >= 1 && entry.choice <= question.choices.length;
  const answered = !entry.not_applicable && choiceIsInRange;
  let status: AnswerStatus = 'untouched';
  if (entry.not_applicable) {
    status = 'not_applicable';
  } else if (answered) {
    status = 'answered';
  }
  const result: AnswerResult = {
    index: entry.index,
    title: question.title,
    status,
    choice: answered ? entry.choice : 0,
    choice_text: answered ? question.choices[entry.choice - 1] : '',
    took_recommendation: answered && entry.choice === question.recommend,
  };
  if (entry.what) {
    result.what = entry.what;
  }
  if (entry.why) {
    result.why = entry.why;
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

// Counted from the same statuses the answers carry, so the two never disagree.
function summarise(statuses: AnswerStatus[], stillOpen: boolean): string {
  const count = (status: AnswerStatus) =>
    statuses.filter((each) => each === status).length;
  const n = statuses.length;
  const line =
    `${n} question${n !== 1 ? 's' : ''}: ${count('answered')} answered, ` +
    `${count('not_applicable')} not applicable, ${count('untouched')} untouched.`;
  return stillOpen ? `${line} The form is still open.` : line;
}

// The tool result for a round that ran. `answers` and `notices` are
// index-parallel with the round's questions and notices; free text appears
// only when the user wrote some; `dont_ask` only on a pressed answer.
export function answersPayload(
  round: Round,
  outcome: RoundOutcome,
  body: FormBody,
): AnswersPayload {
  const read = readFormBody(round, body);
  const answers = round.questions.map((question, i) =>
    answerResult(question, read.answers[i]),
  );
  const notices = round.notices.map((notice, i) =>
    noticeResult(notice, i + 1, read.notice_comments[i].comment),
  );
  const stillOpen = outcome === 'draft';
  const payload: AnswersPayload = {
    outcome,
    summary: summarise(
      answers.map((answer) => answer.status),
      stillOpen,
    ),
    next: stillOpen ? NEXT_ON_DRAFT : '',
    answers,
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

function questionContent(question: Question): PythonJsonValue {
  return {
    title: question.title,
    context: question.context,
    question: question.question,
    choices: question.choices,
    recommend: question.recommend,
    rationale: question.rationale,
  };
}

function noticeContent(notice: Notice): PythonJsonValue {
  return { title: notice.title, context: notice.context, badge: notice.badge };
}

// What a re-sent round is matched on: every field of its questions and
// notices, never the heading or overview, which a re-send may reword. Equal to
// the Python server's fingerprint, so its saved rounds still match.
export function fingerprint(round: Round): string {
  const text = pythonJsonDumps({
    questions: round.questions.map(questionContent),
    notices: round.notices.map(noticeContent),
  });
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
