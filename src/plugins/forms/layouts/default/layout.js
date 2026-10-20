// @ts-check

// The built-in forms look. Every card appends its article to `parent` first,
// so the text boxes mount into an attached element.

/** @type {import('../layout').Layout} */
const layout = {
  cards: {
    question(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item question');
      kit.itemHead(article, 'Question');
      kit.section(article, 'Question', input.question);
      kit.section(article, 'Context', input.context);
      const answer = kit.choiceList(article, 'recommended');
      kit.answerControls(answer);
      return { element: article };
    },
    finding(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item finding');
      kit.itemHead(article, input.words.kind);
      kit.section(article, input.words.finding, input.finding);
      const proof = kit.el(article, 'div', 'finding-proof');
      kit.section(proof, input.words.proof, input.proof);
      kit.verdict(article);
      const answer = kit.choiceList(article, 'all');
      kit.actionRow(answer);
      kit.answerControls(answer);
      return { element: article };
    },
    notice(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item notice');
      const head = kit.el(article, 'header', 'item-head');
      kit.el(head, 'span', 'item-kind', 'Notice');
      const badge = kit.el(head, 'span', 'badge badge-notice', input.badge);
      badge.dataset.badge = input.badge;
      kit.section(article, 'Context', input.context);
      kit.textBox(article, 'comment');
      return { element: article };
    },
  },
};

export default layout;
