import type { ToolResult } from '../../sessions/contract';
import { CHAT_HARNESS_ID } from '../contract';
import type { ChatSessions } from './chat-sessions';
import { PERMISSION_TOOL_NAME } from './permission-tool';

// Fixtures the self-test script and the drive actions share.

// Asks a permission prompt in the chat session `sessionId` through chat's
// own `permission_prompt` tool, as Claude Code would for a tool call in
// `projectDir`, drawing its permission card. Resolves to the tool's reply
// once the user answers.
export function askFixturePermission(
  chat: Pick<ChatSessions, 'permissionToolSession'>,
  sessionId: string,
  projectDir: string,
  request: { toolName: string; input: unknown; toolUseId: string },
): Promise<ToolResult> {
  return chat
    .permissionToolSession({
      id: sessionId,
      info: {
        sessionId: null,
        projectDir,
        deadlineSeconds: null,
        harness: CHAT_HARNESS_ID,
      },
    })
    .call(
      PERMISSION_TOOL_NAME,
      {
        tool_name: request.toolName,
        input: request.input,
        tool_use_id: request.toolUseId,
      },
      { toolUseId: request.toolUseId, signal: new AbortController().signal },
    );
}
