import type { Disposable } from '../../contracts/disposable';
import { isSameJson } from '../../shared/json';
import { createListeners } from '../../shared/listeners';
import {
  type FindingAction,
  type FindingOriginSpec,
  MAX_ENTRIES,
} from './contract';

const DEFECT_CARD = {
  card: 'defect',
  words: { kind: 'Defect', finding: 'Finding', proof: 'Proof' },
  choiceNoun: 'its solutions',
  minChoices: 1,
  maxChoices: MAX_ENTRIES,
  requiresSeverity: true,
  requiresProof: false,
  actions: { fix_now: 'Fix now', follow_up: 'Follow-up', leave_it: 'Leave it' },
};

// The origins forms itself registers, in registration order.
export const FINDING_ORIGIN_SPECS: readonly FindingOriginSpec[] = [
  {
    id: 'caused',
    ...DEFECT_CARD,
    meaning: 'a defect the change under review introduced',
    chip: 'Caused by this change',
    themeToken: 'forms.origin-caused',
  },
  {
    id: 'pre_existing',
    ...DEFECT_CARD,
    meaning: 'a real defect in code the change read but did not cause',
    chip: 'Pre-existing',
    themeToken: 'forms.origin-pre-existing',
  },
  {
    id: 'design',
    card: 'decision',
    words: { kind: 'Decision', finding: 'Decision', proof: 'Context' },
    choiceNoun: 'the options a plan would weigh',
    meaning: 'a design call, options to weigh now or in a feature plan',
    minChoices: 2,
    maxChoices: MAX_ENTRIES,
    requiresSeverity: false,
    requiresProof: false,
    actions: {
      fix_now: 'Decide now',
      follow_up: 'Plan it',
      leave_it: 'Drop it',
    },
    chip: 'Design decision',
    themeToken: 'forms.origin-design',
  },
  {
    id: 'nit',
    card: 'nit',
    words: { kind: 'Nit', finding: 'Finding', proof: "Why it's safe" },
    choiceNoun: 'the fix',
    meaning: 'nothing builds on it, and it cannot be shown happening',
    minChoices: 1,
    maxChoices: 1,
    requiresSeverity: false,
    requiresProof: true,
    actions: { fix_now: 'Fix anyway', leave_it: 'Leave it' },
    chip: 'Nit',
    themeToken: 'forms.origin-nit',
  },
];

export interface FindingOriginRegistry {
  // Throws, registering nothing, on a spec that breaks a registration rule
  // or when an `onChanged` listener throws; the handle's first `dispose`
  // retires the spec, and a second does nothing.
  register(spec: FindingOriginSpec): Disposable;
  // The registered spec, else the retired one, else undefined: a round
  // parsed before its origin left keeps reading it.
  spec(origin: string): FindingOriginSpec | undefined;
  // The registered specs in registration order.
  list(): readonly FindingOriginSpec[];
  // Fires once per register and once per first dispose.
  onChanged(listener: () => void): Disposable;
}

// The fields every origin drawing as one card shares.
const CARD_FIELDS = [
  'words',
  'choiceNoun',
  'minChoices',
  'maxChoices',
  'actions',
] as const;

// What is wrong with registering `spec` beside `registered`, or null.
function registrationProblem(
  spec: FindingOriginSpec,
  registered: readonly FindingOriginSpec[],
): string | null {
  const { id } = spec;
  if (id.trim() === '') {
    return 'finding origin id is blank';
  }
  if (registered.some((other) => other.id === id)) {
    return `finding origin ${id} is already registered`;
  }
  const boundsFit =
    spec.minChoices >= 1 &&
    spec.maxChoices <= MAX_ENTRIES &&
    spec.minChoices <= spec.maxChoices;
  if (!boundsFit) {
    return (
      `finding origin ${id} takes ${spec.minChoices} to ${spec.maxChoices} ` +
      `choices; a finding takes 1 to ${MAX_ENTRIES}, the fewest first`
    );
  }
  if (spec.actions.fix_now === undefined) {
    return (
      `finding origin ${id} offers no fix_now action; every finding needs a ` +
      'fix_now choice'
    );
  }
  const blankAction = Object.entries(spec.actions).find(
    ([, word]) => word === undefined || word.trim() === '',
  );
  if (blankAction !== undefined) {
    return `finding origin ${id} has a blank word for ${blankAction[0]}`;
  }
  for (const other of registered) {
    if (other.card !== spec.card) {
      continue;
    }
    const field = CARD_FIELDS.find(
      (each) => !isSameJson(spec[each], other[each]),
    );
    if (field !== undefined) {
      return (
        `finding origin ${id} draws as card ${spec.card}, whose ${field} ` +
        `differs from ${other.id}'s`
      );
    }
  }
  return null;
}

// The finding origins one process reads, in registration order, with the
// specs disposed since kept for the rounds parsed while they were registered.
export function createFindingOriginRegistry(): FindingOriginRegistry {
  let specs: readonly FindingOriginSpec[] = [];
  const retired = new Map<string, FindingOriginSpec>();
  const listeners = createListeners<void>();
  return {
    register(spec) {
      const problem = registrationProblem(spec, specs);
      if (problem !== null) {
        throw new Error(problem);
      }
      const before = { specs, retiredSpec: retired.get(spec.id) };
      retired.delete(spec.id);
      specs = [...specs, spec];
      try {
        listeners.tell();
      } catch (error) {
        specs = before.specs;
        if (before.retiredSpec !== undefined) {
          retired.set(spec.id, before.retiredSpec);
        }
        throw error;
      }
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          specs = specs.filter((each) => each !== spec);
          retired.set(spec.id, spec);
          listeners.tell();
        },
      };
    },
    spec: (origin) =>
      specs.find((each) => each.id === origin) ?? retired.get(origin),
    list: () => specs,
    onChanged: (listener) => listeners.add(listener),
  };
}

// This process's registry: main and the page each load their own copy of
// this module.
export const findingOrigins: FindingOriginRegistry =
  createFindingOriginRegistry();

// The card's word for the action, or null when the origin does not offer it
// or no spec, registered or retired, holds the origin.
export function actionLabel(
  origin: string,
  action: FindingAction,
): string | null {
  return findingOrigins.spec(origin)?.actions[action] ?? null;
}

// Every distinct action word of the registered origins, in list order.
export function actionWords(): readonly string[] {
  return [
    ...new Set(
      findingOrigins
        .list()
        .flatMap((spec) =>
          Object.values(spec.actions).filter(
            (word): word is string => word !== undefined,
          ),
        ),
    ),
  ];
}
