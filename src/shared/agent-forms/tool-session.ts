import type {
  AgentFormSession,
  AgentFormToolResult,
  AgentFormToolSession,
  AgentFormType,
} from '../../contracts/agent-forms';

// The parts of a form type its tool session reads.
type AgentFormTools = Pick<
  AgentFormType<unknown, unknown, unknown>,
  'openTool' | 'collectTool' | 'argsErrorName'
>;

function payloadResult(payload: object): AgentFormToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: { ...payload },
  };
}

// Only an explicit `wait: false` returns the draft at once.
function waitArgument(args: unknown): boolean {
  return (args as { wait?: unknown } | undefined)?.wait !== false;
}

function callFormTool<Payload>(
  session: AgentFormSession<Payload>,
  tools: AgentFormTools,
  name: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  if (name === tools.openTool) {
    return session.open(args ?? {}, toolUseId, signal);
  }
  if (name === tools.collectTool) {
    return session.collect(waitArgument(args), signal);
  }
  return Promise.reject(new Error(`no agent form tool "${name}"`));
}

// A form type's two MCP tools, `type.openTool` and `type.collectTool`, over
// one session. A malformed call, an Error named `type.argsErrorName`, comes
// back as an error result holding its message alone; any other error rejects
// the call.
export function createAgentFormToolSession<Payload extends object>(
  session: AgentFormSession<Payload>,
  type: AgentFormTools,
): AgentFormToolSession {
  return {
    async call(name, args, { toolUseId, signal }) {
      try {
        return payloadResult(
          await callFormTool(session, type, name, args, toolUseId, signal),
        );
      } catch (error) {
        if (error instanceof Error && error.name === type.argsErrorName) {
          return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
          };
        }
        throw error;
      }
    },
    end: () => session.end(),
  };
}
