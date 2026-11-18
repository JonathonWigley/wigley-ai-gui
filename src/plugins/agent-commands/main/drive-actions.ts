import type { DriveHost } from '../../../contracts/plugin';
import { argsObject, requiredString } from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import {
  errorResult,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';

// `agent-commands.call` and `agent-commands.result`, since a drive run's fake
// harness calls no MCP tool. A call goes to the tool session `toolsFor` gives
// the caller, one per session id for the run, around sessions' tool-call
// guards; it returns its call id at once, and its result stays readable for
// the run.
export function addDriveActions(
  drive: DriveHost,
  toolsFor: (callerId: string) => ToolSession,
): void {
  const toolSessions = new Map<string, ToolSession>();
  // Each call's result by its id, null while the call waits.
  const results = new Map<string, ToolResult | null>();
  let lastCallId = 0;
  drive.add('call', {
    description:
      "Calls an agent-commands tool (list_commands, run_command or read_state) as the agent in session sessionId, which must be a live session forms started a tool session for, and returns { callId } at once; a risky run waits on the user's Allow or Deny in that session's form, answered with forms' drive actions. Read the result with agent-commands.result.",
    args: '{ "sessionId": string, "tool": string, "args"?: object }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const sessionId = requiredString(args, 'sessionId');
      const tool = requiredString(args, 'tool');
      const toolSession = toolSessions.get(sessionId) ?? toolsFor(sessionId);
      toolSessions.set(sessionId, toolSession);
      lastCallId += 1;
      const callId = String(lastCallId);
      results.set(callId, null);
      void toolSession
        .call(tool, args.args, {
          toolUseId: null,
          signal: new AbortController().signal,
        })
        .then(
          (result) => results.set(callId, result),
          (error: unknown) =>
            results.set(callId, errorResult(errorText(error))),
        );
      return { callId };
    },
  });
  drive.add('result', {
    description:
      "An agent-commands.call's tool result once it settled, else { pending: true }.",
    args: '{ "callId": string }',
    async run(rawArgs) {
      const callId = requiredString(argsObject(rawArgs), 'callId');
      const result = results.get(callId);
      if (result === undefined) {
        throw new Error(`Unknown call ${callId}`);
      }
      return result ?? { pending: true };
    },
  });
}
