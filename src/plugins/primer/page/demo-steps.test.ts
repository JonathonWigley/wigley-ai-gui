import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandKey } from '../../../contracts/commands';
import type { DemoStage, DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { DEMO_FORM_WAIT_MS } from '../../../shared/page/demo-form-wait';
import { registerDemoSteps } from './demo-steps';
import { initialState } from './primer-state';
import { createPrimerStore } from './primer-store';
import { presentedPrimer } from './test-primers';

const DEMO_SESSION = 'p1-session';

let ran: unknown[][];
let logged: string[];

// The primer page half entered on the demo session, over a store holding
// primer p1 with `activeSessionId` focused.
async function enter(activeSessionId: string): Promise<DemoStage> {
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps({ demoSteps } as unknown as PageServices, {
    store: createPrimerStore(
      initialState([presentedPrimer('p1')], activeSessionId),
    ),
    activate: () => undefined,
    timers: globalTimers,
    commands: {
      run: (key: string | CommandKey<unknown>, arg?: unknown) => {
        const id = typeof key === 'string' ? key : key.id;
        ran.push(arg === undefined ? [id] : [id, arg]);
        return Promise.resolve();
      },
    },
    log: (line) => logged.push(line),
  });
  const [step] = demoSteps.list();
  return step.enter({
    scratchDir: '/scratch',
    sessions: { session: DEMO_SESSION },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  ran = [];
  logged = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('primer page demo steps', () => {
  it('the Tasks beat closes the review and selects the first task', async () => {
    const stage = await enter(DEMO_SESSION);

    await stage.beats[0].show();

    expect(ran).toEqual([
      ['primer.dismissConfirm'],
      ['primer.closeReview'],
      ['primer.selectTask', 1],
    ]);
  });

  it('a beat whose primer never shows logs and runs nothing', async () => {
    const stage = await enter('other-session');

    const shown = stage.beats[0].show();
    await vi.advanceTimersByTimeAsync(DEMO_FORM_WAIT_MS);
    await shown;

    expect(ran).toEqual([]);
    expect(logged).toEqual([`demo form for ${DEMO_SESSION} not shown`]);
  });
});
