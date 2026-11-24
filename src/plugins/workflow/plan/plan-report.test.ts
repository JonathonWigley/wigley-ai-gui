import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_WORKFLOW,
  type DeclaredWorkflow,
  type SessionFlow,
  type WorkflowMainExports,
  type WorkflowSignal,
} from '../contract';
import { planReporter } from './plan-report';
import {
  PLAN_WORKFLOW_ID,
  planWorkflowFixture,
} from './plan-fixtures.test-support';

const PLAN_DIR = '/w/p/plan-a';

const NO_PLAN_WORKFLOW: DeclaredWorkflow = {
  id: 'test:small',
  pluginName: 'test',
  decl: { ...CHECKLIST_WORKFLOW, id: 'small' },
  planFormat: null,
};

describe('planReporter', () => {
  it.each([
    {
      name: 'a flow of a plan workflow',
      workflow: PLAN_WORKFLOW_ID,
      loadsLate: false,
      resolves: true,
    },
    {
      name: 'a flow of a plan workflow loaded only once ready settles',
      workflow: PLAN_WORKFLOW_ID,
      loadsLate: true,
      resolves: true,
    },
    {
      name: 'a workflow keeping no plan',
      workflow: NO_PLAN_WORKFLOW.id,
      loadsLate: false,
      resolves: false,
    },
    {
      name: 'a workflow no enabled entry has',
      workflow: 'gone:plan',
      loadsLate: false,
      resolves: false,
    },
  ])(
    'in $name resolves $resolves',
    async ({ workflow, loadsLate, resolves }) => {
      const ready = Promise.withResolvers<void>();
      let loaded = !loadsLate;
      const signalled: [string, WorkflowSignal, string][] = [];
      const engine: Pick<WorkflowMainExports, 'ready' | 'flowOf' | 'signal'> = {
        ready: ready.promise,
        flowOf: (sessionId) =>
          loaded && sessionId === 's1' ? ({ workflow } as SessionFlow) : null,
        signal: (sessionId, signal, origin) => {
          signalled.push([sessionId, signal, origin]);
        },
      };
      const enabled = [planWorkflowFixture(), NO_PLAN_WORKFLOW];

      const applying = planReporter({
        workflow: engine,
        workflowOf: (flow) =>
          enabled.find((each) => each.id === flow.workflow) ?? null,
      })('s1', PLAN_DIR);
      loaded = true;
      ready.resolve();
      const applied = await applying;

      expect(applied).toBe(resolves);
      expect(signalled).toEqual(
        resolves
          ? [['s1', { type: 'planReported', planDir: PLAN_DIR }, 'live']]
          : [],
      );
    },
  );
});
