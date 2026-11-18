import { describe, expect, it } from 'vitest';
import type { DemoMainContext } from '../../../contracts/demo';
import type { LaunchRequest } from '../../chat/contract';
import { realSessionMainStep } from './real-session-step';

const CONTEXT: DemoMainContext = {
  scratchDir: '/data/demo/scratch',
  launchSession: () => Promise.reject(new Error('not a demo session')),
  processEvents: () => {
    throw new Error('not a demo session');
  },
};

// The step over a chat whose default profile is `profile`; `launches` holds
// each launch request.
function stepOver(profile: string | null) {
  const launches: LaunchRequest[] = [];
  const step = realSessionMainStep({
    defaultProfile: () => profile,
    async launch(request) {
      launches.push(request);
      return 'real-1';
    },
  });
  return { step, launches };
}

describe('realSessionMainStep', () => {
  it('enter_DefaultProfile_LaunchesEphemeralInScratch', async () => {
    const { step, launches } = stepOver('work');

    const stage = await step.enter(CONTEXT);

    expect(launches).toEqual([
      {
        projectDir: '/data/demo/scratch',
        profile: 'work',
        message: {
          text: 'Say hello to the team in one short sentence.',
          images: [],
        },
        ephemeral: true,
      },
    ]);
    expect(stage.sessions).toEqual({ session: 'real-1' });
  });

  it('enter_NoProfile_Throws', async () => {
    const { step, launches } = stepOver(null);

    await expect(step.enter(CONTEXT)).rejects.toThrow('Chat has no profiles.');
    expect(launches).toEqual([]);
  });
});
