import type { ToolResult, ToolSession } from '../../sessions/contract';
import {
  type AnswersPayload,
  type FormsSession,
  ROUND_ERROR_NAME,
} from '../contract';

function payloadResult(payload: AnswersPayload): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: { ...payload },
  };
}

// Only an explicit `wait: false` returns the draft at once.
function waitArgument(args: unknown): boolean {
  return (args as { wait?: unknown } | undefined)?.wait !== false;
}

function callFormsTool(
  session: FormsSession,
  name: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  if (name === 'ask_round') {
    return session.askRound(args ?? {}, toolUseId, signal);
  }
  if (name === 'collect_last_round') {
    return session.collectLastRound(waitArgument(args), signal);
  }
  return Promise.reject(new Error(`forms has no tool "${name}"`));
}

// Forms' two MCP tools over one forms session. A malformed round comes back as
// an error result holding its message alone; any other error rejects the call.
export function createFormsToolSession(session: FormsSession): ToolSession {
  return {
    async call(name, args, { toolUseId, signal }) {
      try {
        return payloadResult(
          await callFormsTool(session, name, args, toolUseId, signal),
        );
      } catch (error) {
        if (error instanceof Error && error.name === ROUND_ERROR_NAME) {
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
