import type { DriveHost } from '../../../contracts/plugin';
import { argsObject, requiredString } from '../../../shared/drive-args';
import type { AgentSession, ToolSession } from '../../sessions/contract';

// `assistantSession` is the assistant's sessionId, null before its first
// launch; `tools` starts backlog's tools for a session.
export interface BacklogDriveDeps {
  assistantSession(): Promise<string | null>;
  tools(session: AgentSession): ToolSession;
}

// The `session` arg that stands for the assistant's session.
const ASSISTANT_SESSION_ARG = 'assistant';

// `backlog.callTool`, since a fake harness makes no tool call.
export function addDriveActions(
  drive: DriveHost,
  deps: BacklogDriveDeps,
): void {
  drive.add('callTool', {
    description:
      'Calls one of backlog\'s tools (read_backlog_state, set_backlog_chunks) as the session `session` names: "assistant" for the Backlog assistant\'s session, else a row id. Returns the tool\'s result. Rejects when "assistant" names a session the assistant has not launched yet.',
    args: '{ "session": string, "tool": string, "args"?: object }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const session = requiredString(args, 'session');
      const tool = requiredString(args, 'tool');
      const toolArgs = args.args ?? {};
      const id =
        session === ASSISTANT_SESSION_ARG
          ? await deps.assistantSession()
          : session;
      if (id === null) {
        throw new Error('The assistant has no session yet');
      }
      const toolSession = deps.tools({
        id,
        info: { sessionId: null, projectDir: null, harness: null, rowId: null },
      });
      try {
        return await toolSession.call(tool, toolArgs, {
          toolUseId: null,
          signal: new AbortController().signal,
        });
      } finally {
        toolSession.end();
      }
    },
  });
}
