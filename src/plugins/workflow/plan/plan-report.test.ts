import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_WORKFLOW,
  CHECKLIST_WORKFLOW_ID,
  type DeclaredWorkflow,
  type SessionFlow,
  type WorkflowMainExports,
  type WorkflowSignal,
} from '../contract';
import {
  KEEPS_NO_PLAN_IGNORED,
  NO_FLOW_IGNORED,
  notEnabledIgnored,
  planReporter,
  planWorkflowOf,
} from './plan-report';
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
      ignored: null,
    },
    {
      name: 'a flow of a plan workflow loaded only once ready settles',
      workflow: PLAN_WORKFLOW_ID,
      loadsLate: true,
      ignored: null,
    },
    {
      name: 'a workflow keeping no plan',
      workflow: NO_PLAN_WORKFLOW.id,
      loadsLate: false,
      ignored: KEEPS_NO_PLAN_IGNORED,
    },
    {
      name: 'a workflow no enabled entry has',
      workflow: 'gone:plan',
      loadsLate: false,
      ignored: notEnabledIgnored('gone:plan'),
    },
  ])(
    'in $name resolves why it is ignored',
    async ({ workflow, loadsLate, ignored }) => {
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

      expect(applied).toBe(ignored);
      expect(signalled).toEqual(
        ignored === null
          ? [['s1', { type: 'planReported', planDir: PLAN_DIR }, 'live']]
          : [],
      );
    },
  );
});

// Breaks if a report the app ignores answers with another case's reason, such
// as a flow saved on a retired workflow answering that it keeps no plan.
describe('planWorkflowOf', () => {
  it.each<{ name: string; workflow: string | null; ignored: string | null }>([
    { name: 'a plan workflow', workflow: PLAN_WORKFLOW_ID, ignored: null },
    { name: 'no flow', workflow: null, ignored: NO_FLOW_IGNORED },
    {
      name: 'the Checklist flow',
      workflow: CHECKLIST_WORKFLOW_ID,
      ignored: KEEPS_NO_PLAN_IGNORED,
    },
    {
      name: 'a workflow keeping no plan',
      workflow: NO_PLAN_WORKFLOW.id,
      ignored: KEEPS_NO_PLAN_IGNORED,
    },
    {
      name: 'a workflow no enabled entry has',
      workflow: 'workflow-large',
      ignored: notEnabledIgnored('workflow-large'),
    },
  ])('$name answers its case', async ({ workflow, ignored }) => {
    const enabled = [planWorkflowFixture(), NO_PLAN_WORKFLOW];

    const lookup = await planWorkflowOf(
      {
        workflow: {
          ready: Promise.resolve(),
          flowOf: () =>
            workflow === null ? null : ({ workflow } as SessionFlow),
          signal: () => undefined,
        },
        workflowOf: (flow) =>
          enabled.find((each) => each.id === flow.workflow) ?? null,
      },
      's1',
    );

    expect(lookup.ignored).toBe(ignored);
    expect(lookup.workflow?.id ?? null).toBe(
      ignored === null ? PLAN_WORKFLOW_ID : null,
    );
  });
});
