import type { RoundItem } from '../form-state';
import { labelFor } from './card-parts';
import { findingFormat } from './finding/finding-card';
import type { PageFormats } from './item-format';
import { noticeFormat } from './notice/notice-card';
import { questionFormat } from './question/question-card';

// The only page file naming every kind.
export const FORMATS: PageFormats = {
  notice: noticeFormat,
  finding: findingFormat,
  question: questionFormat,
};

// The item's number as its card head shows it; the rail and the review show a
// question's or finding's too.
export function itemLabel(item: RoundItem): string {
  return labelFor(FORMATS[item.kind].railPrefix, item.index);
}
