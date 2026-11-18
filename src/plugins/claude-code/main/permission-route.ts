import type { PermissionDecision } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import { errorText } from '../../../shared/error-text';
import {
  type AgentSession,
  errorResult,
  type OfflineAnswer,
  textResult,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';

// The MCP tool Claude Code asks what a session's permission mode would still
// prompt, served to every session by the app's MCP server. Claude Code names a
// plugin's MCP tool `mcp__plugin_<plugin>_<server>__<tool>`: the server is
// `wigley-forms` in the marketplace's `wigley` plugin, Claude's name for that
// plugin's server rather than the app's.
export const PERMISSION_TOOL_NAME = 'permission_prompt';
export const CLAUDE_PERMISSION_TOOL = `mcp__plugin_wigley_wigley-forms__${PERMISSION_TOOL_NAME}`;
export const DEFAULT_DENY_MESSAGE = 'The user denied this tool call.';
export const CANCELLED_REASON =
  'The tool call was cancelled before the user answered.';
export const NO_PROCESS_TEXT =
  'permission_prompt answers only for sessions the wigley-ai-gui app started and still runs.';

// No `additionalProperties: false`: a field Claude Code adds later must not
// fail the call.
export const PERMISSION_TOOLS: ToolDefinition[] = [
  {
    name: PERMISSION_TOOL_NAME,
    description:
      "Answers Claude Code's permission prompts for a session the wigley-ai-gui app started: the app shows the tool call to the user, who allows or denies it. Claude Code calls it through --permission-prompt-tool; never call it yourself.",
    inputSchema: {
      type: 'object',
      required: ['tool_name', 'input'],
      properties: {
        tool_name: {
          type: 'string',
          description: 'The tool asking for permission.',
        },
        input: { type: 'object', description: "The tool call's input." },
        tool_use_id: { type: 'string', description: "The tool call's id." },
      },
    },
  },
];

export interface PermissionCall {
  toolName: string;
  input: unknown;
  toolUseId: string | null;
}

// A call the route hands a target: the read call and the arguments it was read
// from.
export interface RoutedPermissionCall extends PermissionCall {
  args: unknown;
}

// The process a row's calls reach. `ask` resolves to the reply text Claude
// reads; `signal` aborts when the call is cancelled.
export interface PermissionTarget {
  ask(call: RoutedPermissionCall, signal: AbortSignal): Promise<string>;
}

// `route` records the row's process, the promise pending while the process
// attaches; a later `route` for the same row replaces the earlier, and a
// dispose removes only its own record. `toolSession` is the tool session
// sessions builds for one relay: it answers each call by the row id
// `session.id`, looked up at call time, and its `end()` cancels every call it
// still has waiting.
export interface PermissionRoute {
  route(rowId: string, target: Promise<PermissionTarget | null>): Disposable;
  toolSession(session: AgentSession): ToolSession;
}

// Reads Claude Code's `{ tool_name, input, tool_use_id? }`. Throws naming the
// first field wrong.
export function readPermissionCall(args: unknown): PermissionCall {
  const fields = (args ?? {}) as {
    tool_name?: unknown;
    input?: unknown;
    tool_use_id?: unknown;
  };
  if (typeof fields.tool_name !== 'string') {
    throw new Error(`${PERMISSION_TOOL_NAME}: tool_name must be a string`);
  }
  if (fields.input === undefined) {
    throw new Error(`${PERMISSION_TOOL_NAME}: input is missing`);
  }
  if (
    fields.tool_use_id !== undefined &&
    typeof fields.tool_use_id !== 'string'
  ) {
    throw new Error(`${PERMISSION_TOOL_NAME}: tool_use_id must be a string`);
  }
  return {
    toolName: fields.tool_name,
    input: fields.input,
    toolUseId: fields.tool_use_id ?? null,
  };
}

// The text Claude Code reads as the user's decision; an allow passes the
// tool's input back unchanged.
export function permissionReplyText(
  decision: PermissionDecision,
  input: unknown,
): string {
  return decision.allowed
    ? JSON.stringify({ behavior: 'allow', updatedInput: input })
    : JSON.stringify({
        behavior: 'deny',
        message: decision.reason ?? DEFAULT_DENY_MESSAGE,
      });
}

// permission_prompt's answer while the app is closed: a tool the run's
// permission mode does not allow is denied, since nobody can allow it.
export const PERMISSION_OFFLINE: OfflineAnswer = {
  result: textResult(
    permissionReplyText(
      {
        allowed: false,
        reason:
          "The app is closed: this run's permission mode does not allow this tool, so it was denied.",
      },
      undefined,
    ),
  ),
  replay: false,
};

// The target a record's promise settles to; null when it settles null or
// rejects.
async function settledTarget(
  target: Promise<PermissionTarget | null>,
): Promise<PermissionTarget | null> {
  try {
    return await target;
  } catch {
    return null;
  }
}

export function createPermissionRoute(): PermissionRoute {
  const records = new Map<
    string,
    { target: Promise<PermissionTarget | null> }
  >();
  return {
    route(rowId, target) {
      const record = { target };
      records.set(rowId, record);
      return {
        dispose() {
          if (records.get(rowId) === record) {
            records.delete(rowId);
          }
        },
      };
    },
    toolSession(session) {
      // One abort per waiting call, following both the call's signal and `end()`.
      const waiting = new Set<AbortController>();
      return {
        async call(name, args, { signal }) {
          if (name !== PERMISSION_TOOL_NAME) {
            throw new Error(`claude-code has no tool "${name}"`);
          }
          let call: PermissionCall;
          try {
            call = readPermissionCall(args);
          } catch (error) {
            return errorResult(errorText(error));
          }
          const record = records.get(session.id);
          if (record === undefined) {
            return errorResult(NO_PROCESS_TEXT);
          }
          const abort = new AbortController();
          const onAbort = () => abort.abort();
          if (signal.aborted) {
            abort.abort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
          waiting.add(abort);
          try {
            const target = await settledTarget(record.target);
            if (target === null) {
              return errorResult(NO_PROCESS_TEXT);
            }
            return textResult(
              await target.ask({ ...call, args }, abort.signal),
            );
          } finally {
            waiting.delete(abort);
            signal.removeEventListener('abort', onAbort);
          }
        },
        end() {
          for (const abort of waiting) {
            abort.abort();
          }
          waiting.clear();
        },
      };
    },
  };
}
