import { describe, expect, it } from 'vitest';
import type {
  ChecklistItem,
  SessionFlow,
  WorkflowSignal,
} from '../../workflow/contract';
import { foldFlow, newFlow } from '../../workflow/flow';
import { SMALL_WORKFLOW_ID } from '../contract';
import {
  SMALL_MAIN_STAGES,
  SMALL_PAGE_STAGES,
  smallMainWorkflow,
} from './index';

function flowIn(stage: string, fields: Partial<SessionFlow> = {}): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: SMALL_WORKFLOW_ID,
    stage,
    ...fields,
  };
}

function skill(name: string): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: '', argsPath: null };
}

function step(name: string): WorkflowSignal {
  return { type: 'stepReported', step: name };
}

function pageStage(id: string) {
  const stage = SMALL_PAGE_STAGES.find((each) => each.id === id);
  if (stage === undefined) {
    throw new Error(`no page stage ${id}`);
  }
  return stage;
}

const ONE_OF_THREE: readonly ChecklistItem[] = [
  { text: 'a', done: true },
  { text: 'b', done: false },
  { text: 'c', done: false },
];

const NEW_FLOW = newFlow('s1', '/r');

describe('Small stages', () => {
  it.each<{
    name: string;
    start: SessionFlow;
    signal: WorkflowSignal;
    stage: string;
    workflow: string | null;
  }>([
    {
      name: 'new flow, wigley:small',
      start: NEW_FLOW,
      signal: skill('wigley:small'),
      stage: 'scope',
      workflow: SMALL_WORKFLOW_ID,
    },
    {
      name: 'new flow, small',
      start: NEW_FLOW,
      signal: skill('small'),
      stage: 'scope',
      workflow: SMALL_WORKFLOW_ID,
    },
    {
      name: 'new flow, wigley:review',
      start: NEW_FLOW,
      signal: skill('wigley:review'),
      stage: 'idle',
      workflow: null,
    },
    ...[
      { from: 'scope', signal: step('build'), stage: 'build' },
      { from: 'build', signal: step('check'), stage: 'check' },
      { from: 'check', signal: step('land'), stage: 'land' },
      { from: 'land', signal: step('done'), stage: 'done' },
      { from: 'scope', signal: step('done'), stage: 'done' },
      { from: 'check', signal: step('build'), stage: 'build' },
      { from: 'done', signal: skill('wigley:small'), stage: 'scope' },
      { from: 'build', signal: step('review'), stage: 'build' },
      { from: 'build', signal: skill('wigley:review'), stage: 'build' },
      { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
    ].map(({ from, signal, stage }) => ({
      name: `${from}, ${JSON.stringify(signal)}`,
      start: flowIn(from),
      signal,
      stage,
      workflow: SMALL_WORKFLOW_ID,
    })),
  ])('foldFlow_SmallRules ($name)', ({ start, signal, stage, workflow }) => {
    const after = foldFlow(start, signal, [smallMainWorkflow]);

    expect(after.stage).toBe(stage);
    expect(after.workflow).toBe(workflow);
    expect(after.movedUpFrom).toBeNull();
  });

  it('smallMainWorkflow_Values', () => {
    const { id, order, firstStage, fixCycles } = smallMainWorkflow;

    expect({ id, order, firstStage, fixCycles }).toEqual({
      id: 'workflow-small',
      order: 10,
      firstStage: 'scope',
      fixCycles: undefined,
    });
    expect(SMALL_MAIN_STAGES.flatMap((s) => s.reportedAs ?? [])).toEqual([
      'build',
      'check',
      'land',
      'done',
    ]);
    expect(
      SMALL_MAIN_STAGES.filter((s) => s.finishes === true).map((s) => s.id),
    ).toEqual(['done']);
  });

  it('smallPageStages_MatchMainHalves', () => {
    const ids = (stages: readonly { id: string; order: number }[]) =>
      stages.map(({ id, order }) => ({ id, order }));

    expect(ids(SMALL_PAGE_STAGES)).toEqual(ids(SMALL_MAIN_STAGES));
  });

  it('smallTrail_ReadsFourWords', () => {
    const bySlot = new Map(
      SMALL_PAGE_STAGES.map((stage) => [
        stage.stepSlot ?? stage.id,
        stage.label,
      ]),
    );

    expect([...bySlot.values()]).toEqual(['Scope', 'Build', 'Check', 'Land']);
    expect(pageStage('done').label).toBe('Land');
  });

  it.each([
    { stage: 'land', turnRunning: true, status: 'running' },
    { stage: 'land', turnRunning: false, status: 'paused' },
    { stage: 'done', turnRunning: true, status: 'running' },
    { stage: 'done', turnRunning: false, status: 'done' },
  ])(
    'smallStatus $stage turnRunning $turnRunning',
    ({ stage, turnRunning, status }) => {
      expect(pageStage(stage).status(flowIn(stage, { turnRunning }))).toBe(
        status,
      );
    },
  );

  it.each([
    { checklist: null, progress: '' },
    { checklist: ONE_OF_THREE, progress: ' 1/3' },
  ])('buildStatusProgress $progress', ({ checklist, progress }) => {
    expect(
      pageStage('build').statusProgress?.(flowIn('build', { checklist })),
    ).toBe(progress);
  });
});
