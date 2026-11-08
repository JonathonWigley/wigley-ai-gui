// @ts-check

// The built-in forms look. Every card and pane appends its element to
// `parent` first, so the text boxes mount into an attached element.
//
// What a user layout may leave out of a card or pane it defines, and what the
// app does then:
// - question and finding cards: `itemHead` (the card still carries
//   `data-status`), `answerControls` and `textBox` (each box left unmounted is
//   appended at the end of the card), and `contributedParts` (other plugins'
//   parts are appended after those boxes)
// - notice card: `textBox` (the comment box is appended at the end) and
//   `contributedParts` (appended after it)
// - rail: `entry` (a rail without entries scrolls nothing into view)
// - review: `roundNote` (appended at the end of the pane), and every other
//   part, which then draws nothing
//
// The question card draws no section labels: the summary is its headline, and
// the context, the choices and the rationale follow with no label.

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
      kit.inlineMarkdown(card, input.summary, 'item-summary');
      kit.markdown(card, input.context, 'context-body md');
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
      const answer = kit.choiceGroups(card, 'all');
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
  rail(parent, input, kit) {
    const nav = kit.el(parent, 'nav', 'rail');
    nav.setAttribute('aria-label', 'Items');
    const list = kit.el(nav, 'ol', 'rail-list');
    for (const item of input.items) {
      kit.entry(list, item.position);
    }
    return { element: nav };
  },
  review(parent, input, kit) {
    const pane = kit.el(parent, 'div', 'review-pane');
    const head = kit.el(pane, 'header', 'round-head');
    kit.el(head, 'h1', 'round-heading', input.round.heading);
    if (input.round.overview.trim() !== '') {
      kit.inlineMarkdown(head, input.round.overview, 'round-overview');
    }
    kit.progress(head);
    const review = kit.el(pane, 'section', 'review');
    kit.el(review, 'h2', 'review-title', 'Review');
    kit.summary(review);
    const rows = kit.el(review, 'ol', 'review-rows');
    for (const row of input.rows) {
      kit.row(rows, row.row);
    }
    kit.roundNote(review);
    const actions = kit.el(review, 'div', 'review-actions');
    kit.sendButton(actions);
    kit.cancelButton(actions);
    return { element: pane };
  },
};

export default layout;
