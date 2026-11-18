import { FINDING_ACTIONS, type FindingOriginSpec } from '../../../contract';
import { findingOrigins } from '../../../finding-origins';

// Tool and error text built from the registered origins, so a registration
// reaches every sentence an agent reads.

interface CardGroup {
  card: string;
  origins: string[];
  // The first origin's spec; the origins sharing a card share its card-level
  // fields.
  spec: FindingOriginSpec;
}

// Each card once, in registration order, with the origins that draw as it.
function cardGroups(): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const spec of findingOrigins.list()) {
    const group = groups.get(spec.card);
    if (group === undefined) {
      groups.set(spec.card, { card: spec.card, origins: [spec.id], spec });
    } else {
      group.origins.push(spec.id);
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

// The registered origin's spec; the parser has refused any other origin.
function specOf(origin: string): FindingOriginSpec {
  const spec = findingOrigins.spec(origin);
  if (spec === undefined) {
    throw new Error(`finding origin ${origin} is not registered`);
  }
  return spec;
}

// The card the origin draws as, as the card names itself: 'Defect'.
export function cardName(origin: string): string {
  return specOf(origin).words.kind;
}

function offeredLabels(spec: FindingOriginSpec): string[] {
  return FINDING_ACTIONS.flatMap((action) => {
    const label = spec.actions[action];
    return label === undefined ? [] : [label];
  });
}

// Each card with its origins and action words: 'a Defect (caused or
// pre_existing; actions Fix now, Follow-up, Leave it), …'.
export function findingCardsText(): string {
  return orList(
    cardGroups().map(
      ({ origins, spec }) =>
        `a ${spec.words.kind} (${orList(origins)}; actions ` +
        `${offeredLabels(spec).join(', ')})`,
    ),
  );
}

// Each origin with its card and what it means: "'caused' (Defect): …."
export function originCardsText(): string {
  return findingOrigins
    .list()
    .map((spec) => `'${spec.id}' (${spec.words.kind}): ${spec.meaning}.`)
    .join(' ');
}

// Each action value with every card's word for it.
export function actionLabelsText(): string {
  const groups = cardGroups();
  return FINDING_ACTIONS.map((action) => {
    const labels = groups.flatMap(({ spec }) => {
      const label = spec.actions[action];
      return label === undefined ? [] : [`${label} (${spec.words.kind})`];
    });
    return `${action}: ${labels.join(', ')}`;
  }).join('; ');
}

// A sentence per card that leaves an action out: 'A Nit offers no follow_up.'
export function unofferedActionsText(): string {
  return cardGroups()
    .flatMap(({ spec }) => {
      const unoffered = FINDING_ACTIONS.filter(
        (action) => spec.actions[action] === undefined,
      );
      return unoffered.length === 0
        ? []
        : [`A ${spec.words.kind} offers no ${orList(unoffered)}.`];
    })
    .join(' ');
}

// '1 to 9 choices', 'exactly 1 choice'
function choiceRangeText({
  minChoices,
  maxChoices,
}: FindingOriginSpec): string {
  if (minChoices !== maxChoices) {
    return `${minChoices} to ${maxChoices} choices`;
  }
  return `exactly ${minChoices} choice${minChoices === 1 ? '' : 's'}`;
}

// 'takes 1 to 9 choices', 'takes exactly 1 choice: the fix'
export function choiceCountText(origin: string): string {
  const spec = specOf(origin);
  // A finding's lone choice is its fix.
  const isLoneFix = spec.minChoices === 1 && spec.maxChoices === 1;
  return `takes ${choiceRangeText(spec)}${isLoneFix ? ': the fix' : ''}`;
}

// Each card's choice count with what its choices are: 'a Defect takes 1 to 9
// choices, its solutions; …'.
export function cardChoicesText(): string {
  return cardGroups()
    .map(
      ({ spec }) =>
        `a ${spec.words.kind} takes ${choiceRangeText(spec)}, ${spec.choiceNoun}`,
    )
    .join('; ');
}

// The distinct `a <card kind>` of the specs, or-joined: 'a Defect'.
export function cardKindsText(specs: readonly FindingOriginSpec[]): string {
  return orList([...new Set(specs.map((spec) => `a ${spec.words.kind}`))]);
}
