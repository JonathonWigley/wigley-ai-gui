import type { BlockContribution } from '../../../contracts/markdown';

const DEFAULT_SUMMARY = 'Details';

// `:::details Summary`: a disclosure whose summary is the header, `Details`
// when there is none, and whose body is markdown.
export const detailsBlock: BlockContribution = {
  name: 'details',
  render({ header, body }, helpers) {
    const summary = header === '' ? DEFAULT_SUMMARY : header;
    return (
      `<details class="md-details"><summary>${helpers.inline(summary)}</summary>\n` +
      `${helpers.block(body.join('\n'))}</details>\n`
    );
  },
};
