import { PERMISSION_TOOL_NAME } from '../../../contracts/agent';
import type { ToolDefinition } from '../../sessions/contract';
import type { PermissionAnswer } from '../contract';

export { PERMISSION_TOOL_NAME };
export const DEFAULT_DENY_MESSAGE = 'The user denied this tool call.';
export const CANCELLED_REASON =
  'The tool call was cancelled before the user answered.';
export const UNATTENDED_REASON =
  'This session runs unattended: nobody answers its permission prompts, so the app denied this tool call. Work without it, and report what it would have done.';
export const NOT_OWNED_TEXT =
  'permission_prompt answers only for sessions the wigley-ai-gui app started.';

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

export interface PermissionRequest {
  toolName: string;
  input: unknown;
  toolUseId: string | null;
}

// Reads Claude Code's `{ tool_name, input, tool_use_id? }`. Throws naming the
// first field wrong.
export function readPermissionRequest(args: unknown): PermissionRequest {
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
  answer: PermissionAnswer,
  input: unknown,
): string {
  return answer.allowed
    ? JSON.stringify({ behavior: 'allow', updatedInput: input })
    : JSON.stringify({
        behavior: 'deny',
        message: answer.reason ?? DEFAULT_DENY_MESSAGE,
      });
}
