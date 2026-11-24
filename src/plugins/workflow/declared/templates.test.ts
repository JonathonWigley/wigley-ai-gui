import { describe, expect, it } from 'vitest';
import type { PlanState, SessionFlow } from '../contract';
import { newFlow } from '../flow';
import {
  SAMPLE_PLAN_DIR,
  samplePlan,
  taskLine,
} from './sample-fixtures.test-support';
import { isTemplateVariable, renderDetail, renderTemplate } from './templates';

// Two built boxes of three checked, and the open verification task.
const PLAN = samplePlan({
  title: 'Spec',
  wave: 2,
  counters: { reviewRounds: 3 },
  tasks: [
    taskLine('a', true),
    taskLine('b', true),
    taskLine('c', false, { group: 2 }),
    taskLine('verify', false, { group: 2, verification: true }),
  ],
});

// A flow with the plan above, `fix` at 2 and a checklist of one done of two.
function flowWith(fields: Partial<SessionFlow> = {}): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    plan: PLAN,
    counters: { fix: 2 },
    checklist: [
      { text: 'x', done: true },
      { text: 'y', done: false },
    ],
    ...fields,
  };
}

const unread: PlanState = samplePlan(null);

describe('renderTemplate', () => {
  it.each([
    { template: '{plan}', fields: {}, text: SAMPLE_PLAN_DIR },
    { template: '{plan.title}', fields: {}, text: 'Spec' },
    { template: '{plan.checked}/{plan.total}', fields: {}, text: '2/4' },
    { template: '{plan.build}', fields: {}, text: '2/3' },
    { template: 'wave {plan.wave}', fields: {}, text: 'wave 2' },
    {
      template: 'round {plan.counter.reviewRounds}',
      fields: {},
      text: 'round 3',
    },
    { template: ' · cycle {counter.fix}', fields: {}, text: ' · cycle 2' },
    { template: ' {checklist}', fields: {}, text: ' 1/2' },
    { template: 'no variable', fields: {}, text: 'no variable' },
    {
      template: ' · cycle {counter.fix}',
      fields: { counters: {} },
      text: '',
    },
    {
      template: '{plan.title} at {plan.wave}',
      fields: { plan: samplePlan({ title: 'Spec', wave: null }) },
      text: 'Spec at ',
    },
    { template: '{plan}', fields: { plan: null }, text: '' },
    { template: '{plan.title}', fields: { plan: null }, text: '' },
    {
      template: 'round {plan.counter.reviewRounds}',
      fields: { plan: null },
      text: '',
    },
    { template: '{plan}', fields: { plan: unread }, text: SAMPLE_PLAN_DIR },
    { template: '{plan.total} tasks', fields: { plan: unread }, text: '' },
    {
      template: '{plan.build}',
      fields: {
        plan: samplePlan({
          tasks: [taskLine('verify', false, { verification: true })],
        }),
      },
      text: '',
    },
    { template: ' {checklist}', fields: { checklist: null }, text: '' },
    { template: ' {checklist}', fields: { checklist: [] }, text: '' },
  ])('$template over $fields → "$text"', ({ template, fields, text }) => {
    expect(renderTemplate(template, flowWith(fields))).toBe(text);
  });
});

describe('renderDetail', () => {
  it('RenderDetail_LeavesOutEmptyParts', () => {
    const flow = flowWith({ plan: samplePlan({ title: 'Spec', wave: null }) });

    expect(
      renderDetail(['{plan.build}', 'wave {plan.wave}', '{plan.title}'], flow),
    ).toBe('Spec');
  });
});

describe('isTemplateVariable', () => {
  it.each([
    { name: 'plan.counter.reviewRounds', listed: true },
    { name: 'counter.fix', listed: true },
    { name: 'checklist', listed: true },
    { name: 'plan.wave', listed: true },
    { name: 'counter.', listed: false },
    { name: 'plan.counter.', listed: false },
    { name: 'plan.dir', listed: false },
  ])('$name → $listed', ({ name, listed }) => {
    expect(isTemplateVariable(name)).toBe(listed);
  });
});
