import type { DemoMainStep } from '../../../contracts/demo';
import type { ChatMainExports } from '../../chat/contract';
import { REAL_SESSION_STEP_ID } from '../contract';

export const REAL_SESSION_TEXT = 'Say hello to the team in one short sentence.';

// The real-session step's main half: a real Claude session on chat's default
// profile in the scratch folder, ephemeral, as its one session `session`.
// Throws `Chat has no profiles.` when chat has no default profile. Its
// dispose does nothing: leaving the step closes the session, as it does every
// step's.
export function realSessionMainStep(
  chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'>,
): DemoMainStep {
  return {
    id: REAL_SESSION_STEP_ID,
    async enter(context) {
      const profile = chat.defaultProfile(null);
      if (profile === null) {
        throw new Error('Chat has no profiles.');
      }
      const sessionId = await chat.launch({
        projectDir: context.scratchDir,
        profile,
        message: { text: REAL_SESSION_TEXT, images: [] },
        ephemeral: true,
      });
      return { sessions: { session: sessionId }, dispose: () => undefined };
    },
  };
}
