import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from './workflow/contract';
import { foldFlow, newFlow } from './workflow/flow';
import { HEAVY_WORKFLOW_ID } from './workflow-heavy/contract';
import { heavyMainWorkflow } from './workflow-heavy/heavy-workflow';
import { LIGHT_WORKFLOW_ID } from './workflow-light/contract';
import { lightMainWorkflow } from './workflow-light/stages';
import { MEDIUM_WORKFLOW_ID } from './workflow-medium/contract';
import { mediumMainWorkflow } from './workflow-medium/stages';

const WORKFLOWS = [
  lightMainWorkflow,
  mediumMainWorkflow,
  heavyMainWorkflow,
].sort((a, b) => a.order - b.order);

function skill(name: string): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: '', argsPath: null };
}

const NEW_FLOW = newFlow('s1', '/r');

const fold = (flow: SessionFlow, signal: WorkflowSignal) =>
  foldFlow(flow, signal, WORKFLOWS);

function flowOf(workflow: string, stage: string): SessionFlow {
  return { ...NEW_FLOW, workflow, stage };
}

describe('workflow levels', () => {
  it('claimOrder_MovesUp', () => {
    const light = fold(
      { ...NEW_FLOW, checklist: [{ text: 'a', done: true }] },
      skill('wigley:light'),
    );
    const medium = fold(
      { ...light, checklist: [{ text: 'a', done: true }] },
      skill('wigley:medium'),
    );
    const heavy = fold(medium, skill('wigley:feature'));

    expect(light).toMatchObject({
      workflow: LIGHT_WORKFLOW_ID,
      movedUpFrom: null,
    });
    expect(medium).toMatchObject({
      workflow: MEDIUM_WORKFLOW_ID,
      movedUpFrom: LIGHT_WORKFLOW_ID,
      stage: 'interview',
      checklist: null,
    });
    expect(heavy).toMatchObject({
      workflow: HEAVY_WORKFLOW_ID,
      movedUpFrom: MEDIUM_WORKFLOW_ID,
    });
  });

  it('movingDown_SetsMovedUpFromToo', () => {
    const flow = fold(
      fold(NEW_FLOW, skill('wigley:medium')),
      skill('wigley:light'),
    );

    expect(flow).toMatchObject({
      workflow: LIGHT_WORKFLOW_ID,
      movedUpFrom: MEDIUM_WORKFLOW_ID,
    });
  });

  it.each([
    { workflow: LIGHT_WORKFLOW_ID, stage: 'build' },
    { workflow: MEDIUM_WORKFLOW_ID, stage: 'review' },
  ])(
    'sharedStageIds_FoldOnlyTheCurrentWorkflow $workflow',
    ({ workflow, stage }) => {
      const flow = fold(flowOf(workflow, 'build'), {
        type: 'stepReported',
        step: 'review',
      });

      expect(flow.stage).toBe(stage);
    },
  );

  it.each(['wigley:review', 'wigley:debug', 'wigley:explore'])(
    'skillsOutsideTheLevels_ClaimNothing %s',
    (name) => {
      expect(fold(NEW_FLOW, skill(name)).workflow).toBeNull();
    },
  );

  it.each([
    'wigley:light',
    'wigley:medium',
    'wigley:feature',
    'wigley:feature-primer',
    'wigley:make',
  ])('claims_AreDisjoint %s', (name) => {
    const claimers = WORKFLOWS.filter((workflow) =>
      workflow.claims(skill(name)),
    );

    expect(claimers).toHaveLength(1);
  });
});
