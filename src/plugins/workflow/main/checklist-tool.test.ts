import { describe, expect, it } from 'vitest';
import { HEADLESS_NOTE } from '../../chat/contract';
import type { ToolCallContext } from '../../sessions/contract';
import type { ChecklistItem } from '../contract';
import { createHeadlessLines } from './headless-line';
import { startChecklistTool } from './checklist-tool';

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

// The tool for session s1, recording each report; `applies` is what each
// resolves, and `headless` what the session's headless flag reads.
function toolWith(applies: boolean, headless = false) {
  const reports: [string, readonly ChecklistItem[]][] = [];
  const tool = startChecklistTool({
    reportChecklist: async (sessionId, items) => {
      reports.push([sessionId, items]);
      return applies;
    },
    lines: createHeadlessLines({
      isHeadless: (sessionId) => headless && sessionId === 's1',
      launchedHeadless: () => false,
    }),
  })({
    id: 's1',
    info: { sessionId: 'h1', projectDir: null, harness: null, rowId: null },
  });
  const call = (args: unknown) =>
    tool.call('set_workflow_checklist', args, NO_CALL_CONTEXT);
  return { call, tool, reports };
}

describe('set_workflow_checklist', () => {
  it.each([
    { args: {} },
    { args: undefined },
    { args: { items: 'a' } },
    { args: { items: [1] } },
    { args: { items: [null] } },
    { args: { items: [{ text: 'a' }] } },
    { args: { items: [{ text: 1, done: true }] } },
    { args: { items: [{ text: '', done: true }] } },
    { args: { items: [{ text: 'a', done: 'yes' }] } },
    {
      args: {
        items: [
          { text: 'a', done: true },
          { text: 'b', done: 1 },
        ],
      },
    },
  ])('call_BadItems_ReturnsErrorNamingShape ($args)', async ({ args }) => {
    const { call, reports } = toolWith(true);

    const result = await call(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'items must be an array of { text: string, done: boolean }, with text not empty.',
    );
    expect(reports).toEqual([]);
  });

  it('call_ValidItems_ReportsAndSaysCount', async () => {
    const { call, reports } = toolWith(true);

    const result = await call({
      items: [
        { text: 'a', done: true, extra: 1 },
        { text: 'b', done: false },
        { text: 'c', done: true },
      ],
    });

    expect(reports).toEqual([
      [
        's1',
        [
          { text: 'a', done: true },
          { text: 'b', done: false },
          { text: 'c', done: true },
        ],
      ],
    ]);
    expect(result.content[0].text).toBe('Checklist set: 2 of 3 done.');
  });

  it('call_Empty_Accepted', async () => {
    const { call } = toolWith(true);

    const result = await call({ items: [] });

    expect(result.content[0].text).toBe('Checklist set: 0 of 0 done.');
  });

  it('call_ReportFalse_SucceedsSayingIgnored', async () => {
    const { call } = toolWith(false);

    const result = await call({ items: [{ text: 'a', done: false }] });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toBe(
      'Ignored the checklist: this session has no workflow yet.',
    );
  });

  it('call_HeadlessSession_AppendsTheHeadlessNote', async () => {
    const { call } = toolWith(true, true);

    const result = await call({
      items: [
        { text: 'a', done: true },
        { text: 'b', done: false },
      ],
    });

    expect(result.content[0].text).toBe(
      `Checklist set: 1 of 2 done.\n${HEADLESS_NOTE}`,
    );
  });

  it('call_OtherToolName_Rejects', async () => {
    const { tool } = toolWith(true);

    await expect(tool.call('x', {}, NO_CALL_CONTEXT)).rejects.toThrow(
      'no workflow tool "x"',
    );
  });
});
