// @ts-check

// The built-in forms look. Every card appends its card to `parent` first,
// so the text boxes mount into an attached element.

// A notice's badge tone; a badge not listed here is neutral.
/** @type {Record<string, import('../layout').TagTone>} */
const NOTICE_TONES = {
  Applied: 'success',
  Dispatched: 'running',
  Decided: 'neutral',
};

/** @type {import('../layout').CompleteLayout} */
const layout = {
  cards: {
    question(parent, input, kit) {
      const card = kit.card(parent, 'item question');
      kit.itemHead(card, 'Question');
      kit.section(card, 'Question', input.question);
      kit.section(card, 'Context', input.context);
      const answer = kit.choiceList(card, 'recommended');
      kit.answerControls(answer);
      return { element: card };
    },
    finding(parent, input, kit) {
      const card = kit.card(parent, 'item finding');
      kit.itemHead(card, input.words.kind);
      kit.section(card, input.words.finding, input.finding);
      const proof = kit.el(card, 'div', 'finding-proof');
      kit.section(proof, input.words.proof, input.proof);
      kit.verdict(card);
      const answer = kit.choiceList(card, 'all');
      kit.answerControls(answer);
      return { element: card };
    },
    notice(parent, input, kit) {
      const card = kit.card(parent, 'item notice');
      const head = kit.el(card, 'header', 'item-head');
      kit.tag(head, 'Notice');
      kit.tag(head, input.badge, NOTICE_TONES[input.badge] ?? 'neutral');
      kit.section(card, 'Context', input.context);
      kit.textBox(card, 'comment');
      return { element: card };
    },
  },
};

export default layout;
