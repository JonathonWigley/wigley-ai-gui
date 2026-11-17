import type { Notice, NoticeComment, PageKind } from '../../../contract';
import { formsCommand } from '../../../ids';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import type { NoticeAnswer } from '../../form-state';
import { labelFor, roundInfo } from '../card-parts';
import { entryAt } from '../item-answer';
import type { CardInputs } from '../item-format';

const RAIL_PREFIX = 'N';

const COMMENT_FIELD = 'comment';

function requireCommentField(field: string): void {
  if (field !== COMMENT_FIELD) {
    throw new Error(`a notice has no ${field} box`);
  }
}

// A notice takes no answer, only a comment; its items draw on the notices
// stop.
export const noticePageKind: PageKind<
  Notice,
  NoticeAnswer,
  CardInputs['notice']
> = {
  spec: BUILT_IN_KIND_SPECS.notice,
  restore: {
    decode: (notices, entries) =>
      notices.map((_, i) => ({
        comment: entryAt<NoticeComment>(entries, i + 1)?.comment ?? '',
      })),
    encode: (answers) =>
      answers.map((answer, i): NoticeComment => ({
        index: i + 1,
        comment: answer.comment,
      })),
  },
  reduce: {
    untouched: () => ({ comment: '' }),
    text(answer, field) {
      requireCommentField(field);
      return answer.comment;
    },
    withText(answer, field, value) {
      requireCommentField(field);
      return answer.comment === value ? answer : { comment: value };
    },
  },
  boxes: {
    fields: [
      {
        field: COMMENT_FIELD,
        className: 'field-comment',
        label: 'Comment',
        hint: 'Optional. Say if this needs a second look.',
        keys: formsCommand('editNotes'),
      },
    ],
    shown: () => [COMMENT_FIELD],
  },
  cardInput: {
    railPrefix: RAIL_PREFIX,
    title: (notice) => notice.title,
    layout: (notice) => notice.layout,
    input(notice, index, round) {
      return {
        index,
        label: labelFor(RAIL_PREFIX, index),
        title: notice.title,
        context: notice.context,
        badge: notice.badge,
        round: roundInfo(round),
      };
    },
  },
  railOrder: null,
};
