import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ToolCallContext } from '../../sessions/contract';
import { startPlanTool } from './plan-tool';

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

const PLAN_DIR = '/w/p/plan-a';
const EMPTY_DIR = '/w/p/plan-b';

// The tool for session `s1` over memory files holding `PLAN_DIR/plan.md` and an
// empty `EMPTY_DIR`, recording each report; `isLarge` is what each resolves.
async function toolWith(isLarge: boolean) {
  const files = createMemoryFiles();
  await files.write(`${PLAN_DIR}/plan.md`, '# Plan A — plan\n');
  await files.makeFolder(EMPTY_DIR);
  const reports: [string, string][] = [];
  const tool = startPlanTool({
    paths: posixPaths,
    files,
    reportPlan: async (sessionId, planDir) => {
      reports.push([sessionId, planDir]);
      return isLarge;
    },
  })({ id: 's1' });
  const call = (args: unknown) =>
    tool.call('set_workflow_plan', args, NO_CALL_CONTEXT);
  return { call, reports };
}

describe('set_workflow_plan', () => {
  it.each([
    {
      name: 'a plan folder in a Large flow',
      isLarge: true,
      args: { folder: PLAN_DIR },
      reported: [['s1', PLAN_DIR]],
      error: false,
      text: `Plan folder set to ${PLAN_DIR}.`,
    },
    {
      name: 'a plan folder with a trailing separator',
      isLarge: true,
      args: { folder: `${PLAN_DIR}/` },
      reported: [['s1', PLAN_DIR]],
      error: false,
      text: `Plan folder set to ${PLAN_DIR}/.`,
    },
    {
      name: 'a folder with no plan.md',
      isLarge: true,
      args: { folder: EMPTY_DIR },
      reported: [],
      error: true,
      text: `${EMPTY_DIR} holds no plan.md.`,
    },
    {
      name: 'a relative folder',
      isLarge: true,
      args: { folder: 'p/plan-a' },
      reported: [],
      error: true,
      text: 'folder must be an absolute path.',
    },
    {
      name: 'a plan folder in a flow that is not Large',
      isLarge: false,
      args: { folder: PLAN_DIR },
      reported: [['s1', PLAN_DIR]],
      error: false,
      text: 'Ignored: this session runs no Large workflow.',
    },
  ])('answers $name', async ({ isLarge, args, reported, error, text }) => {
    const { call, reports } = await toolWith(isLarge);

    const result = await call(args);

    expect(reports).toEqual(reported);
    expect(result.isError === true).toBe(error);
    expect(result.content[0].text).toBe(text);
  });
});
