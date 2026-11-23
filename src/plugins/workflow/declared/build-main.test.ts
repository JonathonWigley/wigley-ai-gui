import { describe, expect, it } from 'vitest';
import type { PredicateDecl } from '../../../contracts/contributions';
import type {
  DeclaredWorkflow,
  PlanProgress,
  SessionFlow,
  WorkflowSignal,
} from '../contract';
import { foldFlow, newFlow } from '../flow';
import { buildMainWorkflow } from './build-main';
import { samplePlan, taskLine } from './sample-fixtures.test-support';
import { sampleDeclared } from './sample-workflows';
import type { PlanFold } from './plan-fold';
import { renderTemplate } from './templates';
import { holds } from './triggers';

// A plan fold that takes each `planChanged` progress and keeps the plan
// otherwise, standing in for the plan capability.
const READS_PROGRESS: PlanFold = {
  fold: (flow, signal) =>
    signal.type === 'planChanged' && flow.plan !== null
      ? { ...flow.plan, progress: signal.progress }
      : flow.plan,
};

const skill = (name: string, args = ''): WorkflowSignal => ({
  type: 'skillStarted',
  skill: name,
  args,
  argsPath: null,
});
const step = (stage: string): WorkflowSignal => ({
  type: 'stepReported',
  step: stage,
});

const progress = (fields: Partial<PlanProgress>): PlanProgress => ({
  title: 'Spec',
  checked: 0,
  total: 2,
  wave: 1,
  counters: {},
  tasks: [taskLine('t1', false), taskLine('t2', false)],
  ...fields,
});

function folds(
  workflow: DeclaredWorkflow,
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): SessionFlow {
  const workflows = [buildMainWorkflow(workflow, READS_PROGRESS)];
  return signals.reduce(
    (current, signal) => foldFlow(current, signal, workflows),
    flow,
  );
}

const LARGE = sampleDeclared('large');

// A Large flow in `stage` with a read plan of two open tasks.
function largeIn(stage: string, fields: Partial<SessionFlow> = {}) {
  return {
    ...newFlow('s1', '/r'),
    workflow: LARGE.id,
    stage,
    plan: samplePlan(progress({})),
    ...fields,
  };
}

// The Large example with `interview` also entered on the explore step, so one
// signal matches a trigger of the current stage and one of a later stage.
function largeWithSecondExploreTrigger(): DeclaredWorkflow {
  const workflow = sampleDeclared('large');
  const interview = workflow.decl.stages.find(({ id }) => id === 'interview');
  interview?.enter.push({ step: 'explore', from: ['featureRun'] });
  return workflow;
}

describe('buildMainWorkflow › trigger rules', () => {
  it.each<{
    name: string;
    workflow?: DeclaredWorkflow;
    flow: SessionFlow;
    signal: WorkflowSignal;
    expected: Partial<SessionFlow>;
  }>([
    {
      name: 'an own skill re-enters its stage and clears the plan again',
      flow: largeIn('explore'),
      signal: skill('wigley:feature'),
      expected: { stage: 'explore', plan: null },
    },
    {
      name: 'a step trigger does not match in its own stage',
      flow: largeIn('explore'),
      signal: step('explore'),
      expected: { stage: 'explore' },
    },
    {
      name: "a later stage's trigger wins over the current stage's",
      workflow: largeWithSecondExploreTrigger(),
      flow: largeIn('explore'),
      signal: step('explore'),
      expected: { stage: 'interview' },
    },
    {
      name: 'a from group lets interview in from explore',
      flow: largeIn('explore'),
      signal: step('interview'),
      expected: { stage: 'interview' },
    },
    {
      name: 'a from group keeps interview out from make',
      flow: largeIn('make'),
      signal: step('interview'),
      expected: { stage: 'make' },
    },
    {
      name: 'planReady enters on an idle turn end with tasks',
      flow: largeIn('plan', { turnRunning: true }),
      signal: { type: 'turnEnded' },
      expected: { stage: 'planReady' },
    },
    {
      name: 'planReady waits while a subagent runs',
      flow: largeIn('plan', { turnRunning: true, runningSubagents: ['a1'] }),
      signal: { type: 'turnEnded' },
      expected: { stage: 'plan' },
    },
    {
      name: 'planReady waits for a plan with tasks',
      flow: largeIn('plan', {
        turnRunning: true,
        plan: samplePlan(progress({ total: 0, tasks: [] })),
      }),
      signal: { type: 'turnEnded' },
      expected: { stage: 'plan' },
    },
    {
      name: 'review enters when a review round is added',
      flow: largeIn('make', {
        plan: samplePlan(progress({ counters: { reviewRounds: 1 } }), {
          snapshots: { reviewRounds: 1 },
        }),
      }),
      signal: {
        type: 'planChanged',
        progress: progress({ counters: { reviewRounds: 2 } }),
      },
      expected: { stage: 'review' },
    },
    {
      name: 'review waits while the round count holds',
      flow: largeIn('make', {
        plan: samplePlan(progress({ counters: { reviewRounds: 1 } }), {
          snapshots: { reviewRounds: 1 },
        }),
      }),
      signal: {
        type: 'planChanged',
        progress: progress({ checked: 1, counters: { reviewRounds: 1 } }),
      },
      expected: { stage: 'make' },
    },
    {
      name: 'closed keeps the stage it was entered from',
      flow: largeIn('review'),
      signal: { type: 'planGone' },
      expected: { stage: 'closed', enteredFrom: 'review' },
    },
    {
      name: 'a busy planChanged in closed reopens to enteredFrom',
      flow: largeIn('closed', { enteredFrom: 'fix', turnRunning: true }),
      signal: { type: 'planChanged', progress: progress({ checked: 1 }) },
      expected: { stage: 'fix', enteredFrom: 'fix' },
    },
    {
      name: 'an idle planChanged in closed stays closed',
      flow: largeIn('closed', { enteredFrom: 'fix' }),
      signal: { type: 'planChanged', progress: progress({ checked: 1 }) },
      expected: { stage: 'closed' },
    },
    {
      name: 'a claim from the Checklist flow enters the claimed stage',
      flow: newFlow('s1', '/r'),
      signal: skill('wigley:feature'),
      expected: { workflow: LARGE.id, stage: 'explore', plan: null },
    },
  ])('$name', ({ workflow, flow, signal, expected }) => {
    expect(folds(workflow ?? LARGE, flow, [signal])).toMatchObject(expected);
  });

  it('RecordsStage_SnapshotsTheCounter_AndAReopenDoesNot', () => {
    const counted = progress({ counters: { reviewRounds: 2 } });
    const entered = folds(
      LARGE,
      largeIn('planReady', { plan: samplePlan(counted) }),
      [skill('wigley:make', 'docs/plan-x')],
    );
    const reopened = folds(
      LARGE,
      largeIn('closed', {
        enteredFrom: 'make',
        turnRunning: true,
        plan: samplePlan(counted, { snapshots: { reviewRounds: 1 } }),
      }),
      [{ type: 'planChanged', progress: counted }],
    );

    expect(entered).toMatchObject({
      stage: 'make',
      plan: { snapshots: { reviewRounds: 2 } },
    });
    expect(reopened).toMatchObject({
      stage: 'make',
      plan: { snapshots: { reviewRounds: 1 } },
    });
  });

  it('StageChange_StopsTheCountdown', () => {
    const flow = largeIn('planReady', { countdownEndsAt: 9_000 });

    expect(folds(LARGE, flow, [skill('wigley:make')]).countdownEndsAt).toBe(
      null,
    );
  });

  it.each<WorkflowSignal>([{ type: 'turnStarted' }, { type: 'cleared' }])(
    '$type stops the countdown',
    (signal) => {
      const flow = largeIn('planReady', { countdownEndsAt: 9_000 });

      expect(folds(LARGE, flow, [signal]).countdownEndsAt).toBe(null);
    },
  );
});

describe('buildMainWorkflow › counters', () => {
  it('TwoFixesFromReview_CountTwo_AndANewClaimResets', () => {
    const medium = sampleDeclared('medium');
    const inReview: SessionFlow = {
      ...newFlow('s1', '/r'),
      workflow: medium.id,
      stage: 'review',
    };

    const twice = folds(medium, inReview, [
      step('fix'),
      step('build'),
      step('review'),
      step('fix'),
    ]);
    const fixStage = medium.decl.stages.find(({ id }) => id === 'fix');
    const restarted = folds(medium, twice, [skill('wigley:medium')]);

    expect(twice.counters).toEqual({ fix: 2 });
    expect(renderTemplate(fixStage?.progress ?? '', twice)).toBe(' · cycle 2');
    expect(buildMainWorkflow(medium, READS_PROGRESS).fixCycles?.(twice)).toBe(
      2,
    );
    expect(restarted).toMatchObject({
      stage: 'interview',
      counters: { fix: 0 },
    });
  });
});

describe('holds with the plan unread', () => {
  const unread = (fields: Partial<SessionFlow>): SessionFlow => ({
    ...newFlow('s1', '/r'),
    plan: samplePlan(null),
    ...fields,
  });

  it.each<{ predicate: PredicateDecl; flow: SessionFlow; held: boolean }>([
    { predicate: 'planRead', flow: unread({}), held: false },
    { predicate: 'planHasTasks', flow: unread({}), held: false },
    { predicate: 'planOpen', flow: unread({}), held: false },
    {
      predicate: { counterRose: 'reviewRounds' },
      flow: unread({}),
      held: false,
    },
    { predicate: 'idle', flow: unread({}), held: true },
    { predicate: 'busy', flow: unread({ turnRunning: true }), held: true },
  ])('$predicate → $held', ({ predicate, flow, held }) => {
    expect(holds(predicate, flow)).toBe(held);
  });
});
