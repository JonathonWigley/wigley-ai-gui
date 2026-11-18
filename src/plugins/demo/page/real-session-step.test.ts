import { describe, expect, it } from 'vitest';
import { realSessionPageStep } from './real-session-step';

describe('realSessionPageStep', () => {
  it.each<{
    name: string;
    sessions: Record<string, string>;
    expected: { activated: string[] } | { error: string };
  }>([
    {
      name: 'a session',
      sessions: { session: 's1' },
      expected: { activated: ['s1'] },
    },
    {
      name: 'none',
      sessions: {},
      expected: { error: 'The real session did not start.' },
    },
  ])(
    'realSessionPageStep_Sessions_ActivatesOrThrows: $name',
    async ({ sessions, expected }) => {
      const activated: string[] = [];
      const step = realSessionPageStep({
        activate: (sessionId) => void activated.push(sessionId),
      });

      let outcome: { activated: string[] } | { error: string };
      try {
        const stage = await step.enter({ scratchDir: '/scratch', sessions });
        for (const beat of stage.beats) {
          await beat.show();
        }
        outcome = { activated };
      } catch (error) {
        outcome = { error: (error as Error).message };
      }

      expect(outcome).toEqual(expected);
    },
  );
});
