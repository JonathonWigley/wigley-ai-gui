import { openFixtureForm } from '../../../shared/agent-forms/drive-actions';
import type { ConnectedSession, ToolResult } from '../../sessions/contract';
import { roundType } from './round-type';

// Asks `round` in the session as an agent's `ask_round` call would, with no
// tool use id and a signal nothing aborts.
export function askFixtureRound(
  session: ConnectedSession,
  round: unknown,
): Promise<ToolResult> {
  return openFixtureForm(session, roundType.openTool, round);
}
