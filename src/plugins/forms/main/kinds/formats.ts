import type { AnswerableKind, ItemKind } from '../../contract';
import { findingFormat } from './finding/finding-format';
import type { FormatTable } from './item-format';
import { noticeFormat } from './notice/notice-format';
import { questionFormat } from './question/question-format';

export const FORMATS: FormatTable = {
  notice: noticeFormat,
  finding: findingFormat,
  question: questionFormat,
};

// The order a round's lists parse and the schema lists them in.
export const ITEM_KINDS: readonly ItemKind[] = [
  'notice',
  'finding',
  'question',
];

// The order the summary counts the answered kinds in.
export const ANSWERABLE_KINDS: readonly AnswerableKind[] = [
  'finding',
  'question',
];
