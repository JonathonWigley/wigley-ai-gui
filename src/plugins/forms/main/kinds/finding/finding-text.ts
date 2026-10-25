import {
  FINDING_ACTIONS,
  FINDING_ORIGINS,
  type FindingCard,
  type FindingOrigin,
} from '../../../contract';
import { capitalised } from '../../../../../shared/capitalised';
import {
  FINDING_ORIGIN_RULES,
  type OriginRules,
} from '../../../finding-origins';

// Tool and error text built from the origin table, so a change to the table
// reaches every sentence an agent reads.

interface CardGroup {
  card: FindingCard;
  origins: FindingOrigin[];
  // The first origin's rules; the origins sharing a card share its rules.
  rules: OriginRules;
}

// Each card once, in table order, with the origins that draw as it.
function cardGroups(): CardGroup[] {
  const groups = new Map<FindingCard, CardGroup>();
  for (const origin of FINDING_ORIGINS) {
    const rules = FINDING_ORIGIN_RULES[origin];
    const group = groups.get(rules.card);
    if (group === undefined) {
      groups.set(rules.card, { card: rules.card, origins: [origin], rules });
    } else {
      group.origins.push(origin);
    }
  }
  return [...groups.values()];
}

// 'a', 'a or b', 'a, b or c'
export function orList(items: readonly string[]): string {
  if (items.length < 2) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// The card the origin draws as, as the card names itself: 'Defect'.
export function cardName(origin: FindingOrigin): string {
  return capitalised(FINDING_ORIGIN_RULES[origin].card);
}

function offeredLabels(rules: OriginRules): string[] {
  return FINDING_ACTIONS.flatMap((action) => {
    const label = rules.actions[action];
    return label === undefined ? [] : [label];
  });
}

// Each card with its origins and action words: 'a Defect (caused or
// pre_existing; actions Fix now, Follow-up, Leave it), …'.
export function findingCardsText(): string {
  return orList(
    cardGroups().map(
      ({ card, origins, rules }) =>
        `a ${capitalised(card)} (${orList(origins)}; actions ` +
        `${offeredLabels(rules).join(', ')})`,
    ),
  );
}

// Each origin with its card and what it means: "'caused' (Defect): …."
export function originCardsText(
  meanings: Record<FindingOrigin, string>,
): string {
  return FINDING_ORIGINS.map(
    (origin) => `'${origin}' (${cardName(origin)}): ${meanings[origin]}.`,
  ).join(' ');
}

// Each action value with every card's word for it.
export function actionLabelsText(): string {
  const groups = cardGroups();
  return FINDING_ACTIONS.map((action) => {
    const labels = groups.flatMap(({ card, rules }) => {
      const label = rules.actions[action];
      return label === undefined ? [] : [`${label} (${capitalised(card)})`];
    });
    return `${action}: ${labels.join(', ')}`;
  }).join('; ');
}

// A sentence per card that leaves an action out: 'A Nit offers no follow_up.'
export function unofferedActionsText(): string {
  return cardGroups()
    .flatMap(({ card, rules }) => {
      const unoffered = FINDING_ACTIONS.filter(
        (action) => rules.actions[action] === undefined,
      );
      return unoffered.length === 0
        ? []
        : [`A ${capitalised(card)} offers no ${orList(unoffered)}.`];
    })
    .join(' ');
}

// '1 to 9 choices', 'exactly 1 choice'
function choiceRangeText({ minChoices, maxChoices }: OriginRules): string {
  if (minChoices !== maxChoices) {
    return `${minChoices} to ${maxChoices} choices`;
  }
  return `exactly ${minChoices} choice${minChoices === 1 ? '' : 's'}`;
}

// 'takes 1 to 9 choices', 'takes exactly 1 choice: the fix'
export function choiceCountText(origin: FindingOrigin): string {
  const rules = FINDING_ORIGIN_RULES[origin];
  // A finding's lone choice is its fix.
  const isLoneFix = rules.minChoices === 1 && rules.maxChoices === 1;
  return `takes ${choiceRangeText(rules)}${isLoneFix ? ': the fix' : ''}`;
}

// Each card's choice count with what its choices are: 'a Defect takes 1 to 9
// choices, its solutions; …'.
export function cardChoicesText(nouns: Record<FindingCard, string>): string {
  return cardGroups()
    .map(
      ({ card, rules }) =>
        `a ${capitalised(card)} takes ${choiceRangeText(rules)}, ${nouns[card]}`,
    )
    .join('; ');
}
