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
import { SMALL_WORKFLOW_ID } from '../contract';
import { workflowSmallManifest } from '../manifest';
import { SMALL_PAGE_STAGES } from '../stages';
import { workflowSmallPagePart } from './start';

// Small's part over a fake engine that holds what it adds and the draw options it
// hands over.
function setUp() {
  const added: PageWorkflow[] = [];
  const drawOptions: WorkflowDrawOptions[] = [];
  startPagePart(workflowSmallPagePart, {
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
  return { ...newFlow('s1', '/r'), workflow: SMALL_WORKFLOW_ID, checklist };
}

describe('workflowSmallPagePart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const { engine, dependency } = startEnginePagePart();
    const small = startPagePart(workflowSmallPagePart, {
      dependencies: [dependency],
    });
    expect(small.counts().registrations).toBeGreaterThan(0);

    await small.stop();

    expect(small.counts()).toEqual(noCounts);
    await engine.stop();
  });

  it('addWorkflow_CarriesTheSmallWorkflow', () => {
    const { id, label, badge, stages } = setUp().workflow;

    expect({ id, label, badge, stages }).toEqual({
      id: 'workflow-small',
      label: 'Small',
      badge: 'S',
      stages: SMALL_PAGE_STAGES,
    });
  });

  it('runAction_Rejects', async () => {
    await expect(
      setUp().workflow.runAction('s1', 'any', flowWith(null)),
    ).rejects.toThrow('Small has no actions');
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
    expect(manifest).toBe(workflowSmallManifest);
  });
});
