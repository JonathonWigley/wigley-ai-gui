import { describe, expect, it } from 'vitest';
import type {
  ActionDecl,
  StageDecl,
  TriggerDecl,
  WorkflowDecl,
} from '../../../contracts/contributions';
import { SAMPLE_LARGE, SAMPLE_SMALL } from './sample-fixtures.test-support';
import { usesPlan } from './uses-plan';

const START: StageDecl = {
  id: 'start',
  label: 'Start',
  status: 'busy',
  enter: [{ skill: 'x:start' }],
};

// A declaration holding one stage, `start`, with `stage` fields over it, and
// the given workflow fields.
function minimal(
  fields: Partial<WorkflowDecl> = {},
  stage: Partial<StageDecl> = {},
): WorkflowDecl {
  return {
    id: 'w',
    label: 'W',
    badge: 'W',
    order: 1,
    claims: ['x:start'],
    sidePane: { kind: 'checklist', title: 'Checklist' },
    stages: [{ ...START, ...stage }],
    ...fields,
  };
}

// A declaration whose one action is `action`.
function withAction(action: ActionDecl): WorkflowDecl {
  return minimal({ actions: { go: action } });
}

// A declaration whose `start` stage also enters on `trigger`.
function withTrigger(trigger: TriggerDecl): WorkflowDecl {
  return minimal({}, { enter: [{ skill: 'x:start' }, trigger] });
}

const SEND: ActionDecl = { kind: 'send', label: 'Go', text: '/go' };

describe('usesPlan', () => {
  it.each([
    {
      name: 'a plan side pane',
      decl: minimal({ sidePane: { kind: 'plan', title: 'Plan' } }),
    },
    {
      name: 'a planCounter fix cycle',
      decl: minimal({ fixCycles: { planCounter: 'rounds' } }),
    },
    {
      name: 'an openPlan action',
      decl: withAction({ kind: 'openPlan', label: 'Open' }),
    },
    {
      name: 'action text naming {plan}',
      decl: withAction({ ...SEND, text: '/make {plan}' }),
    },
    {
      name: 'a plan predicate in available',
      decl: withAction({ ...SEND, available: ['planOpen'] }),
    },
    {
      name: 'a plan predicate in enabled',
      decl: withAction({ ...SEND, enabled: ['planRead'] }),
    },
    { name: 'a records stage', decl: minimal({}, { records: ['rounds'] }) },
    {
      name: 'a progress template naming {plan…}',
      decl: minimal({}, { progress: ' {plan.build}' }),
    },
    {
      name: 'a chipProgress template naming {plan…}',
      decl: minimal({}, { chipProgress: '{plan.wave}' }),
    },
    {
      name: 'a detail template naming {plan…}',
      decl: minimal({}, { detail: ['{plan.title}'] }),
    },
    {
      name: 'a planChanged trigger',
      decl: withTrigger({ event: 'planChanged' }),
    },
    { name: 'a planGone trigger', decl: withTrigger({ event: 'planGone' }) },
    {
      name: 'a clearsPlan trigger',
      decl: withTrigger({ event: 'dismissed', clearsPlan: true }),
    },
    {
      name: 'a planFromArgs trigger',
      decl: minimal({}, { enter: [{ skill: 'x:start', planFromArgs: true }] }),
    },
    {
      name: 'a plan predicate in when',
      decl: withTrigger({ step: 's', when: [{ counterRose: 'rounds' }] }),
    },
    { name: 'the Large example', decl: SAMPLE_LARGE },
  ])('$name uses the plan', ({ decl }) => {
    expect(usesPlan(decl)).toBe(true);
  });

  it.each([
    { name: 'the Small example', decl: SAMPLE_SMALL },
    {
      name: 'only idle and busy predicates',
      decl: withAction({ ...SEND, enabled: ['idle', 'busy'] }),
    },
  ])('$name uses no plan', ({ decl }) => {
    expect(usesPlan(decl)).toBe(false);
  });
});
