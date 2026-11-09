import { describe, expect, it } from 'vitest';
import { HEADLESS_NOTE } from '../../chat/contract';
import type { ToolCallContext } from '../../sessions/contract';
import type { MainStage, MainWorkflow } from '../contract';
import { createHeadlessLines } from './headless-line';
import { startStepTool, stepToolDefinition } from './step-tool';

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

function stage(id: string, reportedAs?: string): MainStage {
  return { id, order: 0, enter: () => null, reportedAs };
}

function workflow(id: string, stages: MainStage[]): MainWorkflow {
  return { id, order: 0, claims: () => false, firstStage: 'a', stages };
}

const WORKFLOWS = [
  workflow('one', [
    stage('quiet'),
    stage('build', 'build'),
    stage('c', 'check'),
  ]),
  workflow('two', [stage('building', 'build'), stage('review', 'review')]),
];

// The tool over `WORKFLOWS`, recording each report; `applies` is what each
// resolves, and `headless` what the session's headless flag reads.
function toolWith(applies: boolean, headless = false) {
  const reports: [string, string][] = [];
  const tool = startStepTool({
    workflows: () => WORKFLOWS,
    reportStep: async (sessionId, step) => {
      reports.push([sessionId, step]);
      return applies;
    },
    lines: createHeadlessLines({
      isHeadless: (sessionId) => headless && sessionId === 's1',
      launchedHeadless: () => false,
    }),
  })({ id: 's1', info: { sessionId: 'h1', projectDir: null, harness: null } });
  const call = (args: unknown) =>
    tool.call('set_workflow_step', args, NO_CALL_CONTEXT);
  return { call, tool, reports };
}

describe('set_workflow_step', () => {
  it('definition_ListsTheUnionOnce', () => {
    const { inputSchema } = stepToolDefinition(WORKFLOWS);

    expect(inputSchema).toMatchObject({
      required: ['step'],
      properties: { step: { enum: ['build', 'check', 'review'] } },
    });
  });

  it('call_ListedStep_ReportsTheStepForTheSession', async () => {
    const { call, reports } = toolWith(true);

    const result = await call({ step: 'review' });

    expect(reports).toEqual([['s1', 'review']]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Step set to review.');
  });

  it('call_RuleIgnoresIt_SucceedsSayingIgnored', async () => {
    const { call } = toolWith(false);

    const result = await call({ step: 'review' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      'Ignored review: this session is not at a place in the workflow that takes it.',
    );
  });

  it.each([
    { name: 'an unknown value', args: { step: 'nope' } },
    { name: 'a stage id with no reported value', args: { step: 'quiet' } },
    { name: 'the stage id of another reported value', args: { step: 'c' } },
    { name: 'no step', args: {} },
    { name: 'no arguments', args: undefined },
  ])('call_UnknownStep_ListsTheUnion ($name)', async ({ args }) => {
    const { call, reports } = toolWith(true);

    const result = await call(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Unknown step. Use one of: build, check, review.',
    );
    expect(reports).toEqual([]);
  });

  it('call_HeadlessSession_AppendsTheHeadlessNote', async () => {
    const { call } = toolWith(true, true);

    const set = await call({ step: 'build' });
    const unknown = await call({ step: 'nope' });

    expect(set.content[0].text).toBe(`Step set to build.\n${HEADLESS_NOTE}`);
    expect(unknown.content[0].text).not.toContain(HEADLESS_NOTE);
  });

  it('call_OtherToolName_Rejects', async () => {
    const { tool } = toolWith(true);

    await expect(tool.call('other', {}, NO_CALL_CONTEXT)).rejects.toThrow(
      'other',
    );
  });
});
