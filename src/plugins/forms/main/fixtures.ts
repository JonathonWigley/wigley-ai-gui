import type {
  ConnectedSession,
  Harness,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';

// Connects a fixture session as a relay would, its row added through
// `sessions`; the self-test script and the drive actions share it.
export function connectFixtureSession(
  sessions: Pick<SessionsMainExports, 'connect'>,
  spec: {
    sessionId: string;
    projectDir: string | null;
    harness: Harness;
    deadlineSeconds: number | null;
  },
): ConnectedSession {
  return sessions.connect({
    sessionId: spec.sessionId,
    projectDir: spec.projectDir,
    deadlineSeconds: spec.deadlineSeconds,
    harness: spec.harness,
  });
}

// Asks `round` in the session as an agent's `ask_round` call would, with no
// tool use id and a signal nothing aborts.
export function askFixtureRound(
  session: ConnectedSession,
  round: unknown,
): Promise<ToolResult> {
  return session.call('ask_round', round, {
    toolUseId: null,
    signal: new AbortController().signal,
  });
}
