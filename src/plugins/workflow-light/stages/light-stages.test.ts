import { describe, expect, it } from 'vitest';
import type {
  ChecklistItem,
  SessionFlow,
  WorkflowSignal,
} from '../../workflow/contract';
import { foldFlow, newFlow } from '../../workflow/flow';
import { LIGHT_WORKFLOW_ID } from '../contract';
import {
  LIGHT_MAIN_STAGES,
  LIGHT_PAGE_STAGES,
  lightMainWorkflow,
} from './index';

function flowIn(stage: string, fields: Partial<SessionFlow> = {}): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: LIGHT_WORKFLOW_ID,
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
  const stage = LIGHT_PAGE_STAGES.find((each) => each.id === id);
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

describe('Light stages', () => {
  it.each<{
    name: string;
    start: SessionFlow;
    signal: WorkflowSignal;
    stage: string;
    workflow: string | null;
  }>([
    {
      name: 'new flow, wigley:light',
      start: NEW_FLOW,
      signal: skill('wigley:light'),
      stage: 'scope',
      workflow: LIGHT_WORKFLOW_ID,
    },
    {
      name: 'new flow, light',
      start: NEW_FLOW,
      signal: skill('light'),
      stage: 'scope',
      workflow: LIGHT_WORKFLOW_ID,
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
      { from: 'done', signal: skill('wigley:light'), stage: 'scope' },
      { from: 'build', signal: step('review'), stage: 'build' },
      { from: 'build', signal: skill('wigley:review'), stage: 'build' },
      { from: 'build', signal: { type: 'turnEnded' } as const, stage: 'build' },
    ].map(({ from, signal, stage }) => ({
      name: `${from}, ${JSON.stringify(signal)}`,
      start: flowIn(from),
      signal,
      stage,
      workflow: LIGHT_WORKFLOW_ID,
    })),
  ])('foldFlow_LightRules ($name)', ({ start, signal, stage, workflow }) => {
    const after = foldFlow(start, signal, [lightMainWorkflow]);

    expect(after.stage).toBe(stage);
    expect(after.workflow).toBe(workflow);
    expect(after.movedUpFrom).toBeNull();
  });

  it('lightMainWorkflow_Values', () => {
    const { id, order, firstStage, fixCycles } = lightMainWorkflow;

    expect({ id, order, firstStage, fixCycles }).toEqual({
      id: 'workflow-light',
      order: 10,
      firstStage: 'scope',
      fixCycles: undefined,
    });
    expect(LIGHT_MAIN_STAGES.flatMap((s) => s.reportedAs ?? [])).toEqual([
      'build',
      'check',
      'land',
      'done',
    ]);
    expect(
      LIGHT_MAIN_STAGES.filter((s) => s.finishes === true).map((s) => s.id),
    ).toEqual(['done']);
  });

  it('lightPageStages_MatchMainHalves', () => {
    const ids = (stages: readonly { id: string; order: number }[]) =>
      stages.map(({ id, order }) => ({ id, order }));

    expect(ids(LIGHT_PAGE_STAGES)).toEqual(ids(LIGHT_MAIN_STAGES));
  });

  it('lightTrail_ReadsFourWords', () => {
    const bySlot = new Map(
      LIGHT_PAGE_STAGES.map((stage) => [
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
    { stage: 'done', turnRunning: true, status: 'done' },
    { stage: 'done', turnRunning: false, status: 'done' },
  ])(
    'lightStatus $stage turnRunning $turnRunning',
    ({ stage, turnRunning, status }) => {
      expect(pageStage(stage).status(flowIn(stage, { turnRunning }))).toBe(
        status,
      );
    },
  );

  it.each([
    { checklist: null, progress: '' },
    { checklist: [], progress: '' },
    { checklist: ONE_OF_THREE, progress: ' 1/3' },
  ])('buildStatusProgress $progress', ({ checklist, progress }) => {
    expect(
      pageStage('build').statusProgress?.(flowIn('build', { checklist })),
    ).toBe(progress);
  });
});
