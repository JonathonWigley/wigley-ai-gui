// @ts-check

// The built-in primer look. Every card and pane appends its element to
// `parent` first, so the text boxes mount into an attached element.
//
// What a user layout may leave out of a part it defines, and what the app
// does then:
// - feature, task and item cards: `textBox` (each box left out is appended at
//   the end of the card, in its field) and, on the item card, `includeMark`
//   (`x` still toggles the item)
// - tasks: `taskRow` (a row drawn otherwise selects nothing on a click; the
//   selected row's prompt is appended at the end of the part) and `addPrompt`
// - items: `itemRow` (the same as `taskRow`)
// - review: every part, which then draws nothing

/** @typedef {import('../layout').PrimerKit} PrimerKit */

// The task card's markdown sections, by label, in card order.
/** @type {[string, 'question' | 'evidence' | 'probes' | 'pointer'][]} */
const TASK_SECTIONS = [
  ['Question', 'question'],
  ['Evidence', 'evidence'],
  ['Probes', 'probes'],
  ['Pointer', 'pointer'],
];

/** @type {('name' | 'slug' | 'spec' | 'summary' | 'notes')[]} */
const FEATURE_BOXES = ['name', 'slug', 'spec', 'summary', 'notes'];

/**
 * An item's place among its task's items: `<n> of <m>`.
 * @param {import('../layout').ItemCardInput} input
 */
function placeText(input) {
  return `${input.number} of ${input.count}`;
}

/**
 * `3 needed, 1 not needed, 0 unclear. 9 of 12 items included.`
 * @param {import('../layout').ReviewInput['tallies']} tallies
 */
function talliesText(tallies) {
  const { yes, no, unclear, included, items } = tallies;
  return `${yes} needed, ${no} not needed, ${unclear} unclear. ${included} of ${items} items included.`;
}

/**
 * The task's name and need, its included items, then its left-out items each
 * tagged, every item with its comment, and the task's comment when not blank.
 * @param {HTMLElement} parent
 * @param {import('../layout').ReviewTaskInput} task
 * @param {PrimerKit} kit
 */
function reviewTask(parent, task, kit) {
  const block = kit.el(parent, 'section', 'primer-review-block');
  block.classList.toggle('is-cursor', task.isCursor);
  const head = kit.el(block, 'div', 'primer-review-task-head');
  kit.el(head, 'span', 'primer-review-task-name', task.name);
  kit.needTag(head, task.need);
  if (task.items.length > 0) {
    const list = kit.el(block, 'ul', 'primer-review-items');
    const included = task.items.filter((item) => item.include);
    const leftOut = task.items.filter((item) => !item.include);
    for (const item of [...included, ...leftOut]) {
      const node = kit.el(list, 'li', 'primer-review-item');
      const line = kit.el(node, 'div', 'primer-review-item-line');
      kit.el(line, 'span', 'primer-review-item-text', item.text);
      if (!item.include) {
        kit.tag(line, 'Left out');
      }
      if (item.comment.trim() !== '') {
        kit.el(node, 'p', 'primer-review-comment', item.comment);
      }
    }
  }
  if (task.comment.trim() !== '') {
    kit.el(block, 'p', 'primer-review-comment', task.comment);
  }
}

/** @type {import('../layout').CompletePrimerLayout} */
const layout = {
  cards: {
    feature(parent, _input, kit) {
      const card = kit.el(parent, 'div', 'primer-card-body');
      kit.el(card, 'h2', 'primer-card-heading', 'Feature');
      for (const field of FEATURE_BOXES) {
        kit.textBox(card, field);
      }
      return { element: card };
    },
    task(parent, input, kit) {
      const card = kit.el(parent, 'div', 'primer-card-body');
      const heading = kit.el(card, 'h2', 'primer-card-heading', input.name);
      const tags = kit.el(card, 'div', 'primer-card-tags');
      if (input.area.trim() !== '') {
        kit.tag(tags, input.area);
      }
      if (input.number !== null) {
        kit.tag(tags, `#${input.number}`);
      }
      let shownNeed = input.need;
      let need = kit.needTag(tags, shownNeed);
      if (input.group === 'extra') {
        kit.textBox(card, 'name');
      }
      for (const [label, field] of TASK_SECTIONS) {
        const text = input[field];
        if (text.trim() !== '') {
          const section = kit.el(card, 'section', 'primer-card-section');
          kit.sectionHeader(section, label);
          kit.markdown(section, text, 'primer-card-section-body md');
        }
      }
      if (input.canAddItem) {
        kit.textBox(card, 'newItem');
      }
      kit.textBox(card, 'comment');
      return {
        element: card,
        update(current) {
          heading.textContent = current.name;
          if (current.need !== shownNeed) {
            shownNeed = current.need;
            const next = kit.needTag(tags, shownNeed);
            need.replaceWith(next);
            need = next;
          }
        },
      };
    },
    item(parent, input, kit) {
      const card = kit.el(parent, 'div', 'primer-card-body');
      const step = kit.el(card, 'div', 'primer-item-step');
      kit.stepKey(step, 'prevRow');
      kit.chevron(step, '‹');
      const place = kit.el(step, 'span', 'primer-item-place', placeText(input));
      kit.chevron(step, '›');
      kit.stepKey(step, 'nextRow');
      if (input.added) {
        kit.textBox(card, 'text');
      } else {
        kit.el(card, 'h2', 'primer-card-heading', input.text);
      }
      const include = kit.el(card, 'div', 'primer-item-include');
      kit.includeMark(include);
      kit.el(include, 'span', '', 'Include');
      kit.keyHint(include, 'toggleInclude', { className: 'primer-field-hint' });
      if (input.added) {
        const tags = kit.el(card, 'div', 'primer-card-tags');
        kit.tag(tags, 'Added');
      }
      kit.textBox(card, 'comment');
      return {
        element: card,
        update(current) {
          place.textContent = placeText(current);
        },
      };
    },
  },
  tasks(parent, input, kit) {
    const list = kit.el(parent, 'div', 'primer-tasks-list');
    kit.taskRow(list, input.feature.position);
    for (const group of input.groups) {
      const header = kit.sectionHeader(list, group.header);
      const isExtra = group.group === 'extra';
      if (isExtra) {
        kit.addPrompt(header);
      }
      for (const row of group.rows) {
        kit.taskRow(list, row.position);
      }
      if (isExtra && group.rows.length === 0) {
        kit.emptyState(list, 'No extra tasks.');
      }
    }
    return { element: list };
  },
  items(parent, input, kit) {
    const list = kit.el(parent, 'div', 'primer-items-list');
    if (input.empty !== null) {
      kit.emptyState(list, input.empty);
    }
    for (const row of input.rows) {
      kit.itemRow(list, row.position);
    }
    return { element: list };
  },
  review(parent, input, kit) {
    const review = kit.el(parent, 'div', 'primer-review');
    kit.el(review, 'p', 'primer-review-tallies', talliesText(input.tallies));
    if (input.problems.length > 0) {
      const block = kit.el(review, 'section', 'primer-review-problems');
      kit.sectionHeader(block, 'Before sending');
      const list = kit.el(block, 'ul', 'primer-review-problem-list');
      for (const problem of input.problems) {
        kit.el(list, 'li', 'primer-review-problem', problem);
      }
    }
    const feature = kit.el(review, 'section', 'primer-review-block');
    kit.sectionHeader(feature, 'Feature');
    const fields = kit.el(feature, 'dl', 'primer-review-fields');
    for (const { label, value } of input.feature) {
      kit.el(fields, 'dt', 'primer-review-field-label', label);
      kit.el(fields, 'dd', 'primer-review-field-value', value);
    }
    for (const task of input.tasks) {
      reviewTask(review, task, kit);
    }
    return { element: review };
  },
};

export default layout;
