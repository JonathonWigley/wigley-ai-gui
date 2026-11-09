import { describe, expect, it } from 'vitest';
import {
  type FakeDependency,
  noCounts,
  startMainPart,
} from '../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../shared/registrations';
import type {
  SessionFlow,
  WorkflowMainExports,
  WorkflowSignal,
} from './workflow/contract';
import { foldFlow, newFlow } from './workflow/flow';
import {
  FAKE_CHAT,
  FAKE_SESSIONS,
  startEngineMainPart,
} from './workflow/main/engine-fakes.test-support';
import { LARGE_WORKFLOW_ID } from './workflow-large/contract';
import { largeMainWorkflow } from './workflow-large/large-workflow';
import { MEDIUM_WORKFLOW_ID } from './workflow-medium/contract';
import { workflowMediumMainPart } from './workflow-medium/main/start';
import { mediumMainWorkflow } from './workflow-medium/stages';
import { SMALL_WORKFLOW_ID } from './workflow-small/contract';
import { workflowSmallMainPart } from './workflow-small/main/start';
import { smallMainWorkflow } from './workflow-small/stages';
import { SPIKE_WORKFLOW_ID } from './workflow-spike/contract';
import { workflowSpikeMainPart } from './workflow-spike/main/start';
import { spikeMainWorkflow } from './workflow-spike/stages';

const settled = () => new Promise((settle) => setImmediate(settle));

const WORKFLOWS = [
  smallMainWorkflow,
  mediumMainWorkflow,
  largeMainWorkflow,
  spikeMainWorkflow,
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
    const small = fold(
      { ...NEW_FLOW, checklist: [{ text: 'a', done: true }] },
      skill('wigley:small'),
    );
    const medium = fold(
      { ...small, checklist: [{ text: 'a', done: true }] },
      skill('wigley:medium'),
    );
    const large = fold(medium, skill('wigley:feature'));

    expect(small).toMatchObject({
      workflow: SMALL_WORKFLOW_ID,
      movedUpFrom: null,
    });
    expect(medium).toMatchObject({
      workflow: MEDIUM_WORKFLOW_ID,
      movedUpFrom: SMALL_WORKFLOW_ID,
      stage: 'interview',
      checklist: null,
    });
    expect(large).toMatchObject({
      workflow: LARGE_WORKFLOW_ID,
      movedUpFrom: MEDIUM_WORKFLOW_ID,
    });
  });

  it('movingDown_SetsMovedUpFromToo', () => {
    const flow = fold(
      fold(NEW_FLOW, skill('wigley:medium')),
      skill('wigley:small'),
    );

    expect(flow).toMatchObject({
      workflow: SMALL_WORKFLOW_ID,
      movedUpFrom: MEDIUM_WORKFLOW_ID,
    });
  });

  it.each([
    { workflow: SMALL_WORKFLOW_ID, stage: 'build' },
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
    'wigley:small',
    'wigley:medium',
    'wigley:feature',
    'wigley:feature-primer',
    'wigley:make',
    'wigley:spike',
  ])('claims_AreDisjoint %s', (name) => {
    const claimers = WORKFLOWS.filter((workflow) =>
      workflow.claims(skill(name)),
    );

    expect(claimers).toHaveLength(1);
  });

  it.each([
    {
      workflow: SMALL_WORKFLOW_ID,
      claim: 'wigley:small',
      start: (dependencies: readonly FakeDependency<'main'>[]) =>
        startMainPart(workflowSmallMainPart, { dependencies }),
    },
    {
      workflow: MEDIUM_WORKFLOW_ID,
      claim: 'wigley:medium',
      start: (dependencies: readonly FakeDependency<'main'>[]) =>
        startMainPart(workflowMediumMainPart, { dependencies }),
    },
    {
      workflow: SPIKE_WORKFLOW_ID,
      claim: 'wigley:spike',
      start: (dependencies: readonly FakeDependency<'main'>[]) =>
        startMainPart(workflowSpikeMainPart, { dependencies }),
    },
  ])(
    'mainPart_OnTheEngine_ClaimsUntilStopped $workflow',
    async ({ workflow, claim, start }) => {
      const { engine, dependency } = startEngineMainPart();
      const exported = engine
        .started()
        .exports?.(createRegistrations()) as WorkflowMainExports;
      const level = start([dependency, FAKE_SESSIONS, FAKE_CHAT]);
      const claimedBy = async (sessionId: string) => {
        engine.emit('sessions.connected', {
          id: sessionId,
          info: { sessionId: `h-${sessionId}`, projectDir: '/r' },
        });
        engine.emit('chat.sessionOpened', { sessionId, profileDir: '~/.c' });
        await settled();
        exported.signal(sessionId, skill(claim), 'live');
        return exported.flowOf(sessionId)?.workflow;
      };

      expect(await claimedBy('s1')).toBe(workflow);

      await level.stop();

      expect(level.counts()).toEqual(noCounts);
      expect(await claimedBy('s2')).toBeNull();
    },
  );
});
