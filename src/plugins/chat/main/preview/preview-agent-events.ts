import { type AgentEvent, MAIN_AGENT_ID } from '../../../../contracts/agent';

const MAPPER = 'preview-agent-map';
const CHECKER = 'preview-agent-check';

// The agent events of the sample session, in event order, dated before `at`:
// a running subagent with three tool calls (two done, one running) and a
// reply's model, spend and near-full context; a subagent that finished done
// with no reply; a running task of the main agent's with a command; and a skill
// started by the main agent and one by the running subagent, neither a workflow
// stage's skill. Whatever draws a session's subagents, tasks and skills from
// agent events draws these in the sample's Chat tab.
export function previewAgentEvents(at: number): AgentEvent[] {
  return [
    {
      type: 'agentSpawned',
      at: at - 95_000,
      agentId: MAPPER,
      parentAgentId: MAIN_AGENT_ID,
      agentType: 'wigley:sonnet-medium',
      description: 'Map every caller of the session list',
      name: 'map-sessions',
      model: 'sonnet',
      effort: 'medium',
    },
    {
      type: 'skillStarted',
      at: at - 93_000,
      agentId: MAIN_AGENT_ID,
      skill: 'wigley:writing-code',
      args: '',
    },
    {
      type: 'agentReplied',
      at: at - 90_000,
      agentId: MAPPER,
      model: 'claude-sonnet-5-5',
      spendUsd: 0.4213,
      contextTokens: 166_000,
      contextWindow: 200_000,
      autocompactLimit: null,
    },
    {
      type: 'skillStarted',
      at: at - 89_000,
      agentId: MAPPER,
      skill: 'wigley:explore',
      args: '',
    },
    ...previewTool(
      MAPPER,
      1,
      'Read',
      'src/plugins/sessions/contract.ts',
      at - 88_000,
      true,
    ),
    ...previewTool(MAPPER, 2, 'Grep', 'addRowPart', at - 80_000, true),
    {
      type: 'agentSpawned',
      at: at - 75_000,
      agentId: CHECKER,
      parentAgentId: MAIN_AGENT_ID,
      agentType: 'Explore',
      description: 'Find every adapter behind the Files contract',
      name: 'Explore',
      model: null,
      effort: null,
    },
    {
      type: 'taskStarted',
      at: at - 60_000,
      taskId: 'preview-task',
      agentId: MAIN_AGENT_ID,
      description: 'Run the self-test',
      command: 'npm run selftest -- --plugin agent-strip',
    },
    {
      type: 'agentFinished',
      at: at - 40_000,
      agentId: CHECKER,
      outcome: 'done',
    },
    ...previewTool(
      MAPPER,
      3,
      'Read',
      'src/plugins/chat/page/composer-stop-holder.ts',
      at - 20_000,
      false,
    ),
  ];
}

// Tool call `n` of `agentId`: its start, and its end when `isFinished`.
function previewTool(
  agentId: string,
  n: number,
  tool: string,
  summary: string,
  at: number,
  isFinished: boolean,
): AgentEvent[] {
  const toolUseId = `${agentId}-tool-${n}`;
  const started: AgentEvent = {
    type: 'toolStarted',
    at,
    agentId,
    toolUseId,
    tool,
    summary,
  };
  return isFinished
    ? [
        started,
        { type: 'toolFinished', at: at + 2_000, agentId, toolUseId, ok: true },
      ]
    : [started];
}
