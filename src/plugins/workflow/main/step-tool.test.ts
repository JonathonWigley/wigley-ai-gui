import { describe, expect, it } from 'vitest';
import type { ToolCallContext } from '../../sessions/contract';
import type { MainStage } from '../contract';
import { startStepTool, stepToolDefinition } from './step-tool';

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

function stage(id: string, reportedAs?: string): MainStage {
  return { id, order: 0, enter: () => null, reportedAs };
}

const STAGES = [stage('a'), stage('coldRead', 'cold_read'), stage('z', 'z')];

// The tool over `STAGES`, recording each report; `applies` is what each resolves.
function toolWith(applies: boolean) {
  const reports: [string, string][] = [];
  const tool = startStepTool({
    stages: () => STAGES,
    reportStep: async (sessionId, reported) => {
      reports.push([sessionId, reported]);
      return applies;
    },
  })({ id: 's1' });
  const call = (args: unknown) =>
    tool.call('set_workflow_step', args, NO_CALL_CONTEXT);
  return { call, tool, reports };
}

describe('set_workflow_step', () => {
  it('definition_ListsEachStagesReportedValue', () => {
    const { inputSchema } = stepToolDefinition(STAGES);

    expect(inputSchema).toMatchObject({
      required: ['step'],
      properties: { step: { enum: ['cold_read', 'z'] } },
    });
  });

  it('call_ReportedValue_ReportsThatStageForTheSession', async () => {
    const { call, reports } = toolWith(true);

    const result = await call({ step: 'cold_read' });

    expect(reports).toEqual([['s1', 'coldRead']]);
    expect(result.isError).toBeUndefined();
  });

  it('call_RuleIgnoresIt_SucceedsSayingIgnored', async () => {
    const { call } = toolWith(false);

    const result = await call({ step: 'z' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Ignored');
  });

  it.each([
    { name: 'an unknown value', args: { step: 'nope' } },
    { name: 'a stage id with no reported value', args: { step: 'a' } },
    {
      name: 'the stage id of another reported value',
      args: { step: 'coldRead' },
    },
    { name: 'no step', args: {} },
    { name: 'no arguments', args: undefined },
  ])('call_IsAnErrorNamingTheAcceptedValues ($name)', async ({ args }) => {
    const { call, reports } = toolWith(true);

    const result = await call(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cold_read, z');
    expect(reports).toEqual([]);
  });

  it('call_OtherToolName_Rejects', async () => {
    const { tool } = toolWith(true);

    await expect(tool.call('other', {}, NO_CALL_CONTEXT)).rejects.toThrow(
      'other',
    );
  });
});
