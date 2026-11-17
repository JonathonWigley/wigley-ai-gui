import { openFixtureForm } from '../../../shared/agent-forms/drive-actions';
import type { ConnectedSession, ToolResult } from '../../sessions/contract';
import { ROUND_OPEN_TOOL } from './mcp-wording';

// Asks `round` in the session as an agent's `ask_round` call would, with no
// tool use id and a signal nothing aborts.
export function askFixtureRound(
  session: ConnectedSession,
  round: unknown,
): Promise<ToolResult> {
  return openFixtureForm(session, ROUND_OPEN_TOOL, round);
}
