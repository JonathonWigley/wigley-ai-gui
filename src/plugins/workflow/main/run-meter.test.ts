import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import { createRunMeter, type RunMeter } from './run-meter';

const SESSION = 's1';

function usage(agentId: string, spendUsd: number | null): AgentEvent {
  return {
    type: 'usage',
    at: 1,
    agentId,
    contextTokens: 10,
    contextWindow: null,
    autocompact: { configured: null, reported: null },
    cacheExpiresAt: null,
    spendUsd,
  };
}

type Step =
  | number
  | AgentEvent
  | Extract<keyof RunMeter, 'cleared' | 'claimed' | 'finished' | 'forget'>;

describe('createRunMeter', () => {
  it.each<{
    name: string;
    steps: Step[];
    activeMs: number;
    costUsd: number | null;
  }>([
    {
      name: 'a main usage',
      steps: [4000, usage(MAIN_AGENT_ID, 0.5)],
      activeMs: 4000,
      costUsd: 0.5,
    },
    {
      name: "a subagent's usage",
      steps: [4000, usage('sub-1', 0.5)],
      activeMs: 4000,
      costUsd: null,
    },
    {
      name: 'a main usage with no spend yet',
      steps: [4000, usage(MAIN_AGENT_ID, null)],
      activeMs: 4000,
      costUsd: null,
    },
    {
      name: 'a clear between two processes',
      steps: [
        4000,
        usage(MAIN_AGENT_ID, 0.5),
        0,
        'cleared',
        1500,
        usage(MAIN_AGENT_ID, 0.25),
      ],
      activeMs: 5500,
      costUsd: 0.75,
    },
    {
      name: 'a second run after finished',
      steps: [
        4000,
        usage(MAIN_AGENT_ID, 0.5),
        'finished',
        6000,
        usage(MAIN_AGENT_ID, 0.75),
      ],
      activeMs: 2000,
      costUsd: 0.25,
    },
    {
      name: 'a run after the claim',
      steps: [
        3000,
        usage(MAIN_AGENT_ID, 1),
        'claimed',
        5000,
        usage(MAIN_AGENT_ID, 2),
      ],
      activeMs: 2000,
      costUsd: 1,
    },
    {
      name: 'forget',
      steps: [4000, usage(MAIN_AGENT_ID, 0.5), 'forget', 0],
      activeMs: 0,
      costUsd: null,
    },
  ])('$name', ({ steps, activeMs, costUsd }) => {
    let clock = 0;
    const meter = createRunMeter({ activeMsOf: () => clock });

    for (const step of steps) {
      if (typeof step === 'number') {
        clock = step;
      } else if (typeof step === 'string') {
        meter[step](SESSION);
      } else {
        meter.note(SESSION, step);
      }
    }

    expect(meter.read(SESSION)).toEqual({ activeMs, costUsd });
  });
});
