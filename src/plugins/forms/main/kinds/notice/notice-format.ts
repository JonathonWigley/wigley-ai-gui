import type { Notice, NoticeBadge } from '../../../contract';
import { RoundError } from '../../round-error';
import { fieldsMissing, fieldsOutside, requireText } from '../fields';
import type { ItemFormat } from '../item-format';
import { isJsonObject } from '../../../../../shared/json';

const MAX_NOTICES = 50;

const NOTICE_BADGES: readonly NoticeBadge[] = [
  'Applied',
  'Dispatched',
  'Decided',
];
const DEFAULT_NOTICE_BADGE: NoticeBadge = 'Applied';

const NOTICE_REQUIRED_FIELDS = ['title', 'context'];
const NOTICE_FIELDS = [...NOTICE_REQUIRED_FIELDS, 'badge'];

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
  'otherwise settled before this round opened — one object per notice. Each ' +
  'draws as its own card before the findings and questions, badged ' +
  "'Applied', 'Dispatched' or 'Decided', with only a comment box: no " +
  'choices, no recommendation, nothing for the user to decide.';

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

function parseNotice(item: unknown, where: string): Notice {
  if (!isJsonObject(item)) {
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

export const noticeFormat: ItemFormat<Notice> = {
  argsKey: 'notices',
  noun: 'notice',
  maxItems: MAX_NOTICES,
  arraySchema: {
    type: 'array',
    maxItems: MAX_NOTICES,
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
      },
    },
    description: NOTICES_DESCRIPTION,
  },
  parse: parseNotice,
  fingerprintContent: (notice) => ({
    title: notice.title,
    context: notice.context,
    badge: notice.badge,
  }),
};
