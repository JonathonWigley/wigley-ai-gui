import { type AgentEvent, MAIN_AGENT_ID } from '../../../../contracts/agent';

const MAPPER = 'preview-agent-map';
const CHECKER = 'preview-agent-check';

// The agent events of the sample session, in event order, dated before `at`:
// a running subagent with three tool calls (two done, one running) and a
// reply's model, spend and near-full context; a subagent that finished done
// with no reply; a running task of the main agent's with a command; and a skill
// started by the main agent and one by the running subagent, neither a workflow
// stage's skill; and the main agent's context breakdown. Whatever draws a session's subagents, tasks and skills from
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
    previewContextBreakdown(at - 1_000),
  ];
}

// The main agent's context breakdown: sources in every size, one opening into its items, one item a path, and
// deferred tools.
function previewContextBreakdown(at: number): AgentEvent {
  return {
    type: 'contextBreakdown',
    agentId: MAIN_AGENT_ID,
    at,
    totalTokens: 157_000,
    contextWindow: 1_000_000,
    autocompactAt: 300_000,
    deferredTokens: 23_000,
    sources: [
      {
        id: 'messages.attachments',
        label: 'Attachments',
        tokens: 68_000,
        items: [
          { label: 'prompt_snapshot', isPath: false, tokens: 15_000 },
          { label: 'invoked_skills', isPath: false, tokens: 10_000 },
        ],
      },
      {
        id: 'messages.tool-results',
        label: 'Tool results',
        tokens: 25_000,
        items: [{ label: 'Bash', isPath: false, tokens: 13_000 }],
      },
      {
        id: 'messages.tool-calls',
        label: 'Tool calls',
        tokens: 14_000,
        items: [],
      },
      {
        id: 'memory_files',
        label: 'Memory files',
        tokens: 11_000,
        items: [
          { label: '/Users/preview/AGENTS.md', isPath: true, tokens: 11_000 },
        ],
      },
      {
        id: 'messages.replies',
        label: 'Agent replies',
        tokens: 11_000,
        items: [],
      },
      { id: 'messages.user', label: 'User messages', tokens: 9_000, items: [] },
      { id: 'skills', label: 'Skills', tokens: 9_000, items: [] },
      { id: 'system_tools', label: 'System tools', tokens: 6_000, items: [] },
      { id: 'system_prompt', label: 'System prompt', tokens: 2_000, items: [] },
      { id: 'mcp_tools', label: 'MCP tools', tokens: 2_000, items: [] },
    ],
  };
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
