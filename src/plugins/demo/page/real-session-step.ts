import type { DemoStep } from '../../../contracts/demo';
import type { SessionsPageExports } from '../../sessions/contract';
import { REAL_SESSION_STEP_ID } from '../contract';

// The real-session step's page half, last in the run: its one beat shows the
// session its main half launched, `session`, and throws
// `The real session did not start.` without one. Its dispose does nothing:
// leaving the step's main half closes the session.
export function realSessionPageStep(
  sessions: Pick<SessionsPageExports, 'activate'>,
): DemoStep {
  return {
    id: REAL_SESSION_STEP_ID,
    section: 'live',
    order: 1000,
    title: 'Real session',
    caption:
      'A real Claude session starts on the default profile and says hello to the team.',
    files: [
      'src/plugins/demo/main/real-session-step.ts',
      'src/plugins/demo/page/real-session-step.ts',
    ],
    async enter(context) {
      const sessionId: string | undefined = context.sessions.session;
      if (sessionId === undefined) {
        throw new Error('The real session did not start.');
      }
      return {
        beats: [{ name: 'hello', show: () => sessions.activate(sessionId) }],
        dispose: () => undefined,
      };
    },
  };
}
