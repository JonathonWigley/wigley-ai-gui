import { labelFor, roundInfo } from '../card-parts';
import type { CardInputs, ItemFormat } from '../item-format';

const RAIL_PREFIX = 'N';

export const noticeFormat: ItemFormat<CardInputs['notice']> = {
  railPrefix: RAIL_PREFIX,
  title: (round, index) => round.notices[index - 1].title,
  cardInput(round, index) {
    const notice = round.notices[index - 1];
    return {
      index,
      label: labelFor(RAIL_PREFIX, index),
      title: notice.title,
      context: notice.context,
      badge: notice.badge,
      round: roundInfo(round),
    };
  },
};
