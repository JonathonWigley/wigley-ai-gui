import type { MainItemKind } from '../../contract';
import { findingKind } from './finding/finding-format';
import { noticeKind } from './notice/notice-format';
import { questionKind } from './question/question-format';

// The kinds forms' main start registers, in the order they register: the
// order a round's lists parse and the schema lists them in.
export const BUILT_IN_KINDS: readonly MainItemKind[] = [
  noticeKind,
  findingKind,
  questionKind,
];
