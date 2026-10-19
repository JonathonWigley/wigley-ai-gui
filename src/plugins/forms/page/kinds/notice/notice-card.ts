import { element } from '../../../../../shared/page/dom';
import {
  buildField,
  buildItemHead,
  buildSection,
  labelFor,
} from '../card-parts';
import type { ItemFormat } from '../item-format';

export const noticeFormat: ItemFormat = {
  railPrefix: 'N',
  title: (round, index) => round.notices[index - 1].title,
  buildCard(parent, round, index, _position, deps) {
    const notice = round.round.notices[index - 1];
    const article = element('article', 'item notice');
    parent.append(article);
    const badge = buildItemHead(
      article,
      labelFor(noticeFormat.railPrefix, index),
      notice.title,
    );
    badge.className = 'badge badge-notice';
    badge.dataset.badge = notice.badge;
    badge.textContent = notice.badge;
    buildSection(article, 'Context', notice.context, deps.markdown);
    const comment = buildField(
      article,
      'field-comment',
      'Comment',
      'optional - say if this needs a second look',
    );
    deps.mountBox(
      comment.box,
      { field: 'comment', notice: index },
      round.noticeComments[index - 1],
    );
    // A notice's card holds nothing the round's state changes.
    return { element: article, update() {} };
  },
};
