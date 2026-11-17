import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import { type FormsMainExports, formsMainKey } from '../../forms/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type SessionsMainExports,
  sessionsMainKey,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import { agentCommandsMainPart } from './start';

describe('agentCommandsMainPart', () => {
  it('contributes the three tools to every agent, subagents included, and adds the drive actions', async () => {
    const contributions: {
      tools: ToolDefinition[];
      start: (session: AgentSession) => ToolSession;
      options: ContributeToolsOptions | undefined;
    }[] = [];
    const harness = startMainPart(agentCommandsMainPart, {
      dependencies: [
        fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
        fakeDependency(formsMainKey, () => ({}) as FormsMainExports),
        fakeDependency(
          sessionsMainKey,
          (consumer) =>
            ({
              contributeTools: (
                tools: ToolDefinition[],
                start: (session: AgentSession) => ToolSession,
                options?: ContributeToolsOptions,
              ) => {
                contributions.push({ tools, start, options });
                return consumer.track({ dispose() {} });
              },
            }) as unknown as SessionsMainExports,
        ),
      ],
      drive: true,
    });
    const toolSession = contributions[0]?.start({
      id: 'c1',
      info: {
        sessionId: 'host-1',
        projectDir: '/home/Game',
        harness: 'claude',
        rowId: null,
      },
    });

    const slotIds = await toolSession?.call(
      'read_state',
      {},
      { toolUseId: null, signal: new AbortController().signal },
    );

    expect(
      contributions.map(({ tools, options }) => [
        tools.map(({ name }) => name),
        options,
      ]),
    ).toEqual([[['list_commands', 'run_command', 'read_state'], undefined]]);
    expect(slotIds?.isError).toBeUndefined();
    expect(Array.isArray(JSON.parse(slotIds?.content[0]?.text ?? ''))).toBe(
      true,
    );
    expect([...(harness.drive?.actions.keys() ?? [])]).toEqual([
      'call',
      'result',
    ]);
  });
});
