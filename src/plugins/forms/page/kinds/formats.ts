import type { PageKind } from '../../contract';
import { requireKind, type RoundItem } from '../round-model';
import { labelFor } from './card-parts';
import { findingPageKind } from './finding/finding-card';
import { noticePageKind } from './notice/notice-card';
import type { PageKindTable } from './page-kinds';
import { questionPageKind } from './question/question-card';

// The only page file naming every built-in kind, in the order forms' page
// registers them.
export const BUILT_IN_PAGE_KINDS: readonly PageKind[] = [
  noticePageKind,
  findingPageKind,
  questionPageKind,
];

// The item's number as its card head, the rail and the review show it: its
// kind's rail prefix and its index. Throws for a kind `kinds` lacks.
export function itemLabel(kinds: PageKindTable, item: RoundItem): string {
  return labelFor(requireKind(kinds, item).cardInput.railPrefix, item.index);
}
