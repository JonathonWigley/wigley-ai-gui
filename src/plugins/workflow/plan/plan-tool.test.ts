import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ToolCallContext } from '../../sessions/contract';
import type { DeclaredWorkflow } from '../contract';
import {
  planWorkflowFixture,
  USER_PLAN_FORMAT,
} from './plan-fixtures.test-support';
import {
  KEEPS_NO_PLAN_IGNORED,
  NO_FLOW_IGNORED,
  notEnabledIgnored,
} from './plan-report';
import { startPlanTool } from './plan-tool';

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

const PLAN_DIR = '/w/p/plan-a';
const EMPTY_DIR = '/w/p/plan-b';
const TASKS_DIR = '/w/p/plan-c';

const TASKS_FILE_WORKFLOW: DeclaredWorkflow = {
  ...planWorkflowFixture(),
  planFormat: { ...USER_PLAN_FORMAT, file: 'tasks.md' },
};

// The tool for session `s1` over memory files holding `PLAN_DIR/plan.md`,
// `TASKS_DIR/tasks.md` and an empty `EMPTY_DIR`, recording each report; the
// session's flow keeps `workflow`'s plan, or is ignored for the reason a
// string gives, and each report resolves `reportIgnored`.
async function toolWith(
  workflow: DeclaredWorkflow | string,
  reportIgnored: string | null = null,
) {
  const files = createMemoryFiles();
  await files.write(`${PLAN_DIR}/plan.md`, '# Plan A — plan\n');
  await files.write(`${TASKS_DIR}/tasks.md`, '# Plan C — plan\n');
  await files.makeFolder(EMPTY_DIR);
  const reports: [string, string][] = [];
  const tool = startPlanTool({
    paths: posixPaths,
    files,
    reportPlan: async (sessionId, planDir) => {
      reports.push([sessionId, planDir]);
      return reportIgnored;
    },
    planWorkflowOf: async () =>
      typeof workflow === 'string'
        ? { workflow: null, ignored: workflow }
        : { workflow, ignored: null },
  })({ id: 's1' });
  const call = (name: string, args: unknown) =>
    tool.call(name, args, NO_CALL_CONTEXT);
  return { call, reports };
}

describe('set_workflow_plan', () => {
  it.each([
    {
      name: 'a plan folder in a plan workflow',
      workflow: planWorkflowFixture(),
      args: { folder: PLAN_DIR },
      reported: [['s1', PLAN_DIR]],
      error: false,
      text: `Plan folder set to ${PLAN_DIR}.`,
    },
    {
      name: 'a plan folder with a trailing separator',
      workflow: planWorkflowFixture(),
      args: { folder: `${PLAN_DIR}/` },
      reported: [['s1', PLAN_DIR]],
      error: false,
      text: `Plan folder set to ${PLAN_DIR}/.`,
    },
    {
      name: 'a folder with no plan file',
      workflow: planWorkflowFixture(),
      args: { folder: EMPTY_DIR },
      reported: [],
      error: true,
      text: `${EMPTY_DIR} holds no plan.md.`,
    },
    {
      name: 'a folder holding the plan file the format names',
      workflow: TASKS_FILE_WORKFLOW,
      args: { folder: TASKS_DIR },
      reported: [['s1', TASKS_DIR]],
      error: false,
      text: `Plan folder set to ${TASKS_DIR}.`,
    },
    {
      name: 'a folder holding only plan.md when the format names another file',
      workflow: TASKS_FILE_WORKFLOW,
      args: { folder: PLAN_DIR },
      reported: [],
      error: true,
      text: `${PLAN_DIR} holds no tasks.md.`,
    },
    {
      name: 'a relative folder',
      workflow: planWorkflowFixture(),
      args: { folder: 'p/plan-a' },
      reported: [],
      error: true,
      text: 'folder must be an absolute path.',
    },
    {
      name: 'a plan folder in a flow keeping no plan',
      workflow: KEEPS_NO_PLAN_IGNORED,
      args: { folder: PLAN_DIR },
      reported: [],
      error: false,
      text: KEEPS_NO_PLAN_IGNORED,
    },
    {
      name: 'a folder with no plan file in a flow keeping no plan',
      workflow: KEEPS_NO_PLAN_IGNORED,
      args: { folder: EMPTY_DIR },
      reported: [],
      error: false,
      text: KEEPS_NO_PLAN_IGNORED,
    },
    {
      name: 'a plan folder in no flow',
      workflow: NO_FLOW_IGNORED,
      args: { folder: PLAN_DIR },
      reported: [],
      error: false,
      text: NO_FLOW_IGNORED,
    },
    {
      name: 'a plan folder in a flow of a workflow not enabled',
      workflow: notEnabledIgnored('workflow-large'),
      args: { folder: PLAN_DIR },
      reported: [],
      error: false,
      text: notEnabledIgnored('workflow-large'),
    },
  ])('answers $name', async ({ workflow, args, reported, error, text }) => {
    const { call, reports } = await toolWith(workflow);

    const result = await call('set_workflow_plan', args);

    expect(reports).toEqual(reported);
    expect(result.isError === true).toBe(error);
    expect(result.content[0].text).toBe(text);
  });

  // Breaks if a report ignored at fold time answers with another case's reason.
  it.each([KEEPS_NO_PLAN_IGNORED, NO_FLOW_IGNORED])(
    'setWorkflowPlan_FlowLeftBeforeTheReport_AnswersWhyTheFoldIgnored (%s)',
    async (ignored) => {
      const { call, reports } = await toolWith(planWorkflowFixture(), ignored);

      const result = await call('set_workflow_plan', { folder: PLAN_DIR });

      expect(reports).toEqual([['s1', PLAN_DIR]]);
      expect(result.content[0].text).toBe(ignored);
    },
  );

  it('call_AnotherToolName_Rejects', async () => {
    const { call } = await toolWith(planWorkflowFixture());

    await expect(call('other_tool', { folder: PLAN_DIR })).rejects.toThrow(
      'no workflow tool "other_tool"',
    );
  });
});
