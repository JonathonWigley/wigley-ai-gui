import {
  type MainItemKind,
  type Notice,
  type NoticeBadge,
  type NoticeComment,
  type NoticeResult,
  RoundError,
  type RoundItemPath,
} from '../../../contract';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import {
  fieldsMissing,
  fieldsOutside,
  ITEM_LAYOUT_SCHEMA,
  parseLayoutField,
  requireText,
  textOrEmpty,
} from '../fields';
import { isJsonObject } from '../../../../../shared/json';

const NOTICE_BADGES: readonly NoticeBadge[] = [
  'Applied',
  'Dispatched',
  'Decided',
];
const DEFAULT_NOTICE_BADGE: NoticeBadge = 'Applied';

const NOTICE_REQUIRED_FIELDS = ['title', 'context'];
const NOTICE_FIELDS = [...NOTICE_REQUIRED_FIELDS, 'badge', 'layout'];

const NOTICE_TITLE_DESCRIPTION =
  'One line saying what changed, in plain words: not a commit ref, not ' +
  '"already done". For a \'Decided\' notice, the decision itself.';

const NOTICE_CONTEXT_DESCRIPTION =
  'What changed, already done; a notice is not a question. Markdown. A ' +
  '`:::tree` block and nothing else: one line per place, then under it ' +
  'indented two spaces one line per change, starting `+` added, `~` changed ' +
  'or `x` removed. Each change line says in plain words what the user now ' +
  'gets, never the markup, symbol or commit behind it. Close the block with ' +
  'a line holding only `:::`. A notice touching one place may use a ' +
  '`:::changes` block instead (the change lines alone). No prose paragraph ' +
  "and no evidence. A 'Decided' notice instead carries one plain line: what " +
  'was decided and why.';

const NOTICE_BADGE_DESCRIPTION =
  "'Applied' (the default) for a fix already landed, 'Dispatched' for one " +
  "still in flight, 'Decided' for a decision you took alone. A comment on a " +
  "'Decided' notice overrides the decision.";

const NOTICES_DESCRIPTION =
  'Fixes already made, dispatched, decisions you took alone, or anything ' +
  'otherwise settled before this form opened — one object per notice. Each ' +
  "draws as one line, its badge and title, on the form's notices page, " +
  'after every other item; the line opens to its context and one ' +
  "comment box. Each is badged 'Applied', 'Dispatched' or 'Decided', and has " +
  'no choices, no recommendation, nothing for the user to decide.';

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

function isNoticeBadge(value: unknown): value is NoticeBadge {
  return (NOTICE_BADGES as readonly unknown[]).includes(value);
}

function parseNotice(item: unknown, at: RoundItemPath): Notice {
  if (!isJsonObject(item)) {
    throw new RoundError({
      path: at,
      problem: 'each notice must be an object.',
    });
  }
  const missing = fieldsMissing(item, NOTICE_REQUIRED_FIELDS);
  if (missing.length > 0) {
    throw new RoundError({
      path: at,
      problem: `missing ${missing.join(', ')}.`,
      detail: 'Both fields are required: title, context.',
    });
  }
  const extra = fieldsOutside(item, NOTICE_FIELDS);
  if (extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `unknown field(s) ${extra.join(', ')}.`,
      detail:
        'A notice takes only title, context, and the optional badge and ' +
        'layout; the form draws its own comment box, and a notice has no ' +
        'choices to describe.',
    });
  }
  const title = requireText(item.title, 'title', at);
  const context = requireText(item.context, 'context', at);
  const badge = Object.hasOwn(item, 'badge')
    ? item.badge
    : DEFAULT_NOTICE_BADGE;
  if (!isNoticeBadge(badge)) {
    throw new RoundError({
      path: at,
      problem:
        `badge must be one of ${NOTICE_BADGES.join(', ')}, not ` +
        `${pythonRepr(badge)}.`,
      detail:
        "Use 'Applied' for a fix already landed, 'Dispatched' for one still " +
        "in flight, and 'Decided' for a decision you took alone.",
    });
  }
  const layout = parseLayoutField(item, at);
  return { title, context, badge, layout };
}

export const noticeKind: MainItemKind<Notice, NoticeComment, NoticeResult> = {
  spec: BUILT_IN_KIND_SPECS.notice,
  noun: 'notice',
  describe: () => ({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: [...NOTICE_REQUIRED_FIELDS],
      properties: {
        title: { type: 'string', description: NOTICE_TITLE_DESCRIPTION },
        context: {
          type: 'string',
          description: NOTICE_CONTEXT_DESCRIPTION,
        },
        badge: {
          type: 'string',
          enum: [...NOTICE_BADGES],
          default: DEFAULT_NOTICE_BADGE,
          description: NOTICE_BADGE_DESCRIPTION,
        },
        layout: ITEM_LAYOUT_SCHEMA,
      },
    },
    description: NOTICES_DESCRIPTION,
  }),
  parse: parseNotice,
  layout: (notice) => notice.layout,
  fingerprintContent: (notice) => ({
    title: notice.title,
    context: notice.context,
    badge: notice.badge,
  }),
  readEntry: (index, saved) => ({ index, comment: textOrEmpty(saved.comment) }),
  recommendedEntry: (_notice, index) => ({ index, comment: '' }),
  // The comment appears only when the user wrote one.
  result: (notice, entry) => {
    const result: NoticeResult = {
      index: entry.index,
      title: notice.title,
      badge: notice.badge,
    };
    if (entry.comment) {
      result.comment = entry.comment;
    }
    return result;
  },
};
