import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandKey } from '../../../contracts/commands';
import type { DemoStage, DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { DEMO_FORM_WAIT_MS } from '../../../shared/page/demo-form-wait';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';
import { active } from './form-state.test-support';
import { registerDemoSteps } from './demo-steps';
import { railItems } from './round-model';
import {
  apply,
  finding,
  initialState,
  notice,
  presentedRound,
  question,
} from './test-rounds';

useBuiltInFindingOrigins();

const DEMO_SESSION = 'r1-session';

const ROUND_PARTS = {
  findings: [finding('F1'), finding('F2'), finding('F3')],
  questions: [question('Q1'), question('Q2')],
  notices: [notice('N1'), notice('N2'), notice('N3')],
};

let ran: unknown[][];
let logged: string[];

// The forms page store with round r1 open, its session focused when
// `activeSessionId` names it.
function storeWith(activeSessionId: string) {
  return createReducerStore(
    initialState([presentedRound('r1', ROUND_PARTS)], activeSessionId),
    apply,
  );
}

// The forms.round page half over `store`, entered on the demo session.
async function enter(store: ReturnType<typeof storeWith>): Promise<DemoStage> {
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps({ demoSteps } as unknown as PageServices, {
    store,
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

describe('forms page demo steps', () => {
  it('the Round beat closes the review and focuses the first question', async () => {
    const stage = await enter(storeWith(DEMO_SESSION));

    await stage.beats[0].show();

    expect(ran).toEqual([
      ['forms.dismissConfirm'],
      ['forms.closeReview'],
      ['forms.focusItem', 3],
    ]);
  });

  it('a beat whose form never shows logs and runs nothing', async () => {
    const stage = await enter(storeWith('other-session'));

    const shown = stage.beats[0].show();
    await vi.advanceTimersByTimeAsync(DEMO_FORM_WAIT_MS);
    await shown;

    expect(ran).toEqual([]);
    expect(logged).toEqual([`demo form for ${DEMO_SESSION} not shown`]);
  });

  it.each([
    {
      case: 'the demo form is active',
      activeSessionId: DEMO_SESSION,
      commands: [['forms.dismissConfirm'], ['forms.closeReview']],
    },
    {
      case: 'another form is active',
      activeSessionId: 'other-session',
      commands: [],
    },
  ])(
    'dispose dismisses the confirm and closes the review while $case',
    async ({ activeSessionId, commands }) => {
      const stage = await enter(storeWith(activeSessionId));

      stage.dispose();

      expect(ran).toEqual(commands);
    },
  );

  it('the rail puts the first question at 3', () => {
    const round = active(
      initialState([presentedRound('r1', ROUND_PARTS)], DEMO_SESSION),
    );

    const rail = railItems(round);

    expect(rail[3]).toEqual({ kind: 'question', index: 1 });
  });
});
