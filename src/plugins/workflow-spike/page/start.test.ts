import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type PageWorkflow,
  type SessionFlow,
  type WorkflowDraw,
  type WorkflowDrawOptions,
  type WorkflowPageExports,
  workflowPageKey,
} from '../../workflow/contract';
import { newFlow } from '../../workflow/flow';
import { startEnginePagePart } from '../../workflow/page/engine-parts.test-support';
import { SPIKE_WORKFLOW_ID } from '../contract';
import { workflowSpikeManifest } from '../manifest';
import { SPIKE_PAGE_STAGES } from '../stages';
import { workflowSpikePagePart } from './start';

// Spike's part over a fake engine that holds what it adds and the draw options it
// hands over.
function setUp() {
  const added: PageWorkflow[] = [];
  const drawOptions: WorkflowDrawOptions[] = [];
  startPagePart(workflowSpikePagePart, {
    dependencies: [
      fakeDependency(
        workflowPageKey,
        () =>
          ({
            addWorkflow(workflow: PageWorkflow) {
              added.push(workflow);
              return { dispose: () => undefined };
            },
            createWorkflowDraw(_api: unknown, options: WorkflowDrawOptions) {
              drawOptions.push(options);
              return {} as WorkflowDraw;
            },
          }) as unknown as WorkflowPageExports,
      ),
    ],
  });
  return { workflow: added[0], options: drawOptions[0] };
}

function flowWith(checklist: SessionFlow['checklist']): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: SPIKE_WORKFLOW_ID, checklist };
}

describe('workflowSpikePagePart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const { engine, dependency } = startEnginePagePart();
    const spike = startPagePart(workflowSpikePagePart, {
      dependencies: [dependency],
    });
    expect(spike.counts().registrations).toBeGreaterThan(0);

    await spike.stop();

    expect(spike.counts()).toEqual(noCounts);
    await engine.stop();
  });

  it('addWorkflow_CarriesTheSpikeWorkflow', () => {
    const { id, label, badge, stages } = setUp().workflow;

    expect({ id, label, badge, stages }).toEqual({
      id: 'workflow-spike',
      label: 'Spike',
      badge: 'X',
      stages: SPIKE_PAGE_STAGES,
    });
  });

  it('runAction_Rejects', async () => {
    await expect(
      setUp().workflow.runAction('s1', 'any', flowWith(null)),
    ).rejects.toThrow('Spike has no actions');
  });

  it('progressText_CountsTheChecklist', () => {
    const checklist = [
      { text: 'a', done: true },
      { text: 'b', done: false },
      { text: 'c', done: false },
    ];

    expect(setUp().workflow.progressText?.(flowWith(checklist))).toBe('1/3');
  });

  it('createWorkflowDraw_TakesTheChecklistTitleAndThePluginsManifest', () => {
    const { manifest, sideTitle } = setUp().options;

    expect(sideTitle).toBe('Checklist');
    expect(manifest).toBe(workflowSpikeManifest);
  });
});
