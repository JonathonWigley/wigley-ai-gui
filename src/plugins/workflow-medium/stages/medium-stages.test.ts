import { describe, expect, it } from 'vitest';
import type {
  ChecklistItem,
  SessionFlow,
  WorkflowSignal,
} from '../../workflow/contract';
import { foldFlow, newFlow } from '../../workflow/flow';
import { MEDIUM_WORKFLOW_ID } from '../contract';
import {
  MEDIUM_MAIN_STAGES,
  MEDIUM_PAGE_STAGES,
  mediumMainWorkflow,
} from './index';

function flowIn(stage: string, fields: Partial<SessionFlow> = {}): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: MEDIUM_WORKFLOW_ID,
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
  const stage = MEDIUM_PAGE_STAGES.find((each) => each.id === id);
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

describe('Medium stages', () => {
  it.each<{
    name: string;
    start: SessionFlow;
    signal: WorkflowSignal;
    stage: string;
  }>([
    {
      name: 'new flow, wigley:medium',
      start: NEW_FLOW,
      signal: skill('wigley:medium'),
      stage: 'interview',
    },
    {
      name: 'new flow, medium',
      start: NEW_FLOW,
      signal: skill('medium'),
      stage: 'interview',
    },
    ...[
      { from: 'interview', signal: step('build'), stage: 'build' },
      { from: 'build', signal: step('review'), stage: 'review' },
      { from: 'review', signal: step('fix'), stage: 'fix' },
      { from: 'fix', signal: step('review'), stage: 'review' },
      { from: 'fix', signal: step('land'), stage: 'land' },
      { from: 'land', signal: step('done'), stage: 'done' },
      { from: 'interview', signal: step('done'), stage: 'done' },
      { from: 'done', signal: skill('wigley:medium'), stage: 'interview' },
      { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
      { from: 'build', signal: skill('wigley:review'), stage: 'build' },
      { from: 'build', signal: step('check'), stage: 'build' },
    ].map(({ from, signal, stage }) => ({
      name: `${from}, ${JSON.stringify(signal)}`,
      start: flowIn(from),
      signal,
      stage,
    })),
  ])('foldFlow_MediumRules ($name)', ({ start, signal, stage }) => {
    const after = foldFlow(start, signal, [mediumMainWorkflow]);

    expect(after.stage).toBe(stage);
    expect(after.workflow).toBe(MEDIUM_WORKFLOW_ID);
    expect(after.movedUpFrom).toBeNull();
  });

  it('mediumMainWorkflow_Values', () => {
    const { id, order, firstStage } = mediumMainWorkflow;

    expect({ id, order, firstStage }).toEqual({
      id: 'workflow-medium',
      order: 20,
      firstStage: 'interview',
    });
    expect(MEDIUM_MAIN_STAGES.flatMap((s) => s.reportedAs ?? [])).toEqual([
      'build',
      'review',
      'fix',
      'land',
      'done',
    ]);
    expect(
      MEDIUM_MAIN_STAGES.filter((s) => s.finishes === true).map((s) => s.id),
    ).toEqual(['done']);
  });

  it('mediumPageStages_MatchMainHalves', () => {
    const ids = (stages: readonly { id: string; order: number }[]) =>
      stages.map(({ id, order }) => ({ id, order }));

    expect(ids(MEDIUM_PAGE_STAGES)).toEqual(ids(MEDIUM_MAIN_STAGES));
  });

  it('mediumTrail_ReadsFiveWords', () => {
    const bySlot = new Map(
      MEDIUM_PAGE_STAGES.map((stage) => [
        stage.stepSlot ?? stage.id,
        stage.label,
      ]),
    );

    expect([...bySlot.values()]).toEqual([
      'Interview',
      'Build',
      'Review',
      'Fix',
      'Land',
    ]);
    expect(pageStage('done').label).toBe('Land');
  });

  it.each([
    { stage: 'land', turnRunning: true, status: 'running' },
    { stage: 'land', turnRunning: false, status: 'paused' },
    { stage: 'done', turnRunning: true, status: 'done' },
    { stage: 'done', turnRunning: false, status: 'done' },
  ])(
    'mediumStatus $stage turnRunning $turnRunning',
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

  it.each([
    { state: null, progress: '' },
    { state: { fixCycles: 2 }, progress: ' · cycle 2' },
  ])('fixStatusProgress $progress', ({ state, progress }) => {
    expect(pageStage('fix').statusProgress?.(flowIn('fix', { state }))).toBe(
      progress,
    );
  });
});
