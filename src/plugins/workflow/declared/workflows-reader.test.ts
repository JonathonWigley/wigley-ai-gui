import { describe, expect, it } from 'vitest';
import type { WorkflowDecl } from '../../../contracts/contributions';
import {
  DESIGN_LARGE,
  DESIGN_MEDIUM,
  DESIGN_PLAN_FORMAT,
  DESIGN_SMALL,
  DESIGN_SOURCE,
  DESIGN_WORKFLOWS,
  strategyOf,
} from './fixtures.test-support';
import { declaredWorkflows, workflowsReader } from './workflows-reader';

// The Large example's stage indexes the refusal rows name.
const PRIMER = 1;
const INTERVIEW = 3;
const PLAN_READY = 6;
const MAKE = 7;
const REVIEW = 8;

// A section holding the Large example after `change`.
function largeWith(change: (decl: WorkflowDecl) => void): WorkflowDecl[] {
  const decl = structuredClone(DESIGN_LARGE);
  change(decl);
  return [decl];
}

function stage(decl: WorkflowDecl, index: number) {
  return decl.stages[index];
}

describe('workflowsReader', () => {
  it('Read_TheFourDesignExamples_Pass', () => {
    expect(workflowsReader.read(DESIGN_WORKFLOWS, DESIGN_SOURCE)).toEqual({
      ok: true,
      value: DESIGN_WORKFLOWS,
    });
  });

  it.each<{ name: string; section: unknown; reason: string }>([
    {
      name: 'a claim in no skill trigger',
      section: largeWith((decl) => decl.claims.push('wigley:other')),
      reason: '[0].claims[3]: wigley:other is in 0 skill triggers, not one',
    },
    {
      name: 'a claim in two skill triggers',
      section: largeWith((decl) =>
        stage(decl, REVIEW).enter.push({ skill: 'wigley:make' }),
      ),
      reason: '[0].claims[2]: wigley:make is in 2 skill triggers, not one',
    },
    {
      name: 'a group named like a stage',
      section: largeWith((decl) => {
        decl.groups = { ...decl.groups, make: ['make'] };
      }),
      reason: '[0].groups.make: a group is named like a stage',
    },
    {
      name: 'a from naming nothing',
      section: largeWith((decl) => {
        stage(decl, INTERVIEW).enter = [
          { step: 'interview', from: ['nowhere'] },
        ];
      }),
      reason:
        '[0].stages[3].enter[0].from: nowhere is neither a stage nor a group',
    },
    {
      name: 'an auto naming an openPlan action',
      section: largeWith((decl) => {
        stage(decl, PLAN_READY).auto = 'openPlan';
      }),
      reason:
        '[0].stages[6].auto: openPlan is not a send, clearAndSend, launch, event action',
    },
    {
      name: 'reopens without finishes',
      section: largeWith((decl) => {
        stage(decl, MAKE).reopens = true;
      }),
      reason: '[0].stages[7].reopens: only a stage that finishes reopens',
    },
    {
      name: 'a send with no text',
      section: largeWith((decl) => {
        delete decl.actions?.retro?.text;
      }),
      reason: '[0].actions.retro.text: not a non-empty string',
    },
    {
      name: 'an unknown template variable',
      section: largeWith((decl) => {
        stage(decl, MAKE).progress = ' {plan.done}';
      }),
      reason: '[0].stages[7].progress: {plan.done} is not a template variable',
    },
    {
      name: '{plan} outside an action text',
      section: largeWith((decl) => {
        stage(decl, MAKE).detail = ['{plan}'];
      }),
      reason: "[0].stages[7].detail[0]: {plan} is only for an action's text",
    },
    {
      name: 'an id with -',
      section: largeWith((decl) => {
        decl.id = 'large-plan';
      }),
      reason: '[0].id: not a letter followed by letters and digits',
    },
    {
      name: 'an action id with -',
      section: largeWith((decl) => {
        decl.actions = {
          ...decl.actions,
          'clear-all': { kind: 'send', label: 'Clear', text: '/clear' },
        };
      }),
      reason:
        '[0].actions.clear-all: the id is not a letter followed by letters and digits',
    },
    {
      name: 'order 1000',
      section: largeWith((decl) => {
        decl.order = 1000;
      }),
      reason: '[0].order: not a number below 1000',
    },
    {
      name: "a claimed skill's trigger with from",
      section: largeWith((decl) => {
        stage(decl, PRIMER).enter = [
          { skill: 'wigley:feature-primer', from: ['idle'] },
        ];
      }),
      reason:
        '[0].stages[1].enter[0]: the claimed skill wigley:feature-primer takes no from and no when',
    },
    {
      name: 'an empty key',
      section: largeWith((decl) => {
        const retro = decl.actions?.retro;
        if (retro !== undefined) {
          retro.key = '';
        }
      }),
      reason: '[0].actions.retro.key: not a non-empty string',
    },
    {
      name: 'an id declared twice',
      section: [DESIGN_SMALL, DESIGN_SMALL],
      reason: '[1].id: small is already declared at [0]',
    },
    {
      name: 'a section that is not an array',
      section: DESIGN_SMALL,
      reason: 'not an array of workflow declarations',
    },
  ])('Read_$name_IsRefusedWithItsPath', ({ section, reason }) => {
    expect(workflowsReader.read(section, DESIGN_SOURCE)).toEqual({
      ok: false,
      reasons: [reason],
    });
  });
});

describe('declaredWorkflows', () => {
  it('DeclaredWorkflows_QualifiesJoinsPlanFormatAndLeavesOutOff', () => {
    const declared = declaredWorkflows(
      [
        strategyOf('wigley', [DESIGN_SMALL, DESIGN_LARGE]),
        strategyOf('acme', [DESIGN_MEDIUM]),
      ],
      [strategyOf('wigley', DESIGN_PLAN_FORMAT)],
      ['wigley:small'],
    );

    expect(declared).toEqual([
      {
        id: 'wigley:large',
        pluginName: 'wigley',
        decl: DESIGN_LARGE,
        planFormat: DESIGN_PLAN_FORMAT,
      },
      {
        id: 'acme:medium',
        pluginName: 'acme',
        decl: DESIGN_MEDIUM,
        planFormat: null,
      },
    ]);
  });
});
