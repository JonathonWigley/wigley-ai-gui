import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import {
  fakeDependency,
  noCounts,
  startPagePart,
  type PartCounts,
} from '../../../shared/plugin-part-harness.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import {
  type SessionRow,
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type PageStage,
  type SessionFlow,
  workflowFlowsSlot,
  type WorkflowPageExports,
} from '../contract';
import { newFlow } from '../flow';
import { workflowPagePart } from './start';
import type { createWorkflowView } from './workflow-view';

// Each session id the view's `setFlow` ran for, in order.
const drawn = vi.hoisted(() => ({ setFlow: [] as string[] }));

vi.mock('./workflow-view', async (importOriginal) => {
  const original = await importOriginal<typeof import('./workflow-view')>();
  return {
    ...original,
    createWorkflowView(deps: Parameters<typeof createWorkflowView>[0]) {
      const view = original.createWorkflowView(deps);
      return {
        ...view,
        setFlow(flow: SessionFlow) {
          drawn.setFlow.push(flow.sessionId);
          view.setFlow(flow);
        },
      };
    },
  };
});

const NONE_LIVE: PartCounts = noCounts;

const EXTRA_STAGE = {
  id: 'extra',
  label: 'Extra',
  inStepper: false,
  order: 70,
  actions: () => [],
} as unknown as PageStage;

const noHandle = (consumer: Registrations) => () =>
  consumer.track({ dispose: () => undefined });

// Workflow's page part over fakes that file each part they take under it, as
// sessions' and chat's views do.
function startWorkflow() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  return startPagePart(workflowPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: noHandle(consumer),
            addTab: noHandle(consumer),
            setActivity: () => undefined,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: noHandle(consumer),
            addSidePart: noHandle(consumer),
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        docsPageKey,
        () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
      ),
    ],
  });
}

describe('workflow page part', () => {
  beforeEach(() => {
    drawn.setFlow = [];
  });

  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startWorkflow();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startWorkflow();

    await harness.restart();

    expect(Object.keys(harness.started().commands)).toContain('mainAction');
    await harness.stop();
    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('exports_ConsumerDisposed_FreesTheStageId', () => {
    const harness = startWorkflow();
    const exportsFor = (consumer: Registrations) =>
      harness.started().exports?.(consumer) as WorkflowPageExports;
    const consumerA = createRegistrations();
    exportsFor(consumerA).addStage(EXTRA_STAGE);

    consumerA.dispose();

    expect(() =>
      exportsFor(createRegistrations()).addStage(EXTRA_STAGE),
    ).not.toThrow();
  });

  function row(sessionId: string): SessionRow {
    return {
      sessionId,
      label: sessionId,
      project: 'project',
      harness: 'claude',
      marked: false,
      projectDir: '/r',
      hostSessionId: `h-${sessionId}`,
      titles: { user: null, agent: null, firstMessage: null },
    };
  }

  // A harness past `core.pageReady` whose slots held rows and flows of s1, s2 and
  // s3 before it, and the flow of `gone`, which has no row.
  function startWithThreeFlows() {
    const harness = startWorkflow();
    const rows = harness.state.publish(sessionsRowsSlot);
    const flows = harness.state.publish(workflowFlowsSlot);
    for (const sessionId of ['s1', 's2', 's3']) {
      rows.set(sessionId, row(sessionId));
      flows.set(sessionId, newFlow(sessionId, '/r'));
    }
    flows.set('gone', newFlow('gone', '/r'));
    harness.emit('core.pageReady', null);
    return { harness, rows, flows };
  }

  it('pageReady_DrawsEachFlowTheSlotHolds', () => {
    startWithThreeFlows();

    expect(drawn.setFlow).toEqual(['s1', 's2', 's3']);
  });

  it('oneFlowNotice_DrawsOneFlow', () => {
    const { flows } = startWithThreeFlows();
    drawn.setFlow = [];

    flows.set('s2', { ...newFlow('s2', '/r'), stage: 'make' });

    expect(drawn.setFlow).toEqual(['s2']);
  });

  it('flowNotice_RowHasLeft_DrawsNothing', () => {
    const { rows, flows } = startWithThreeFlows();
    drawn.setFlow = [];

    rows.delete('s2');
    flows.set('s2', { ...newFlow('s2', '/r'), stage: 'make' });

    expect(drawn.setFlow).toEqual([]);
  });

  it('undefinedNotice_KeepsTheDrawnFlow', () => {
    const { flows } = startWithThreeFlows();
    drawn.setFlow = [];

    flows.delete('s2');

    expect(drawn.setFlow).toEqual([]);
  });
});
