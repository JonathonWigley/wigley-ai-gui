import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import type { SessionTabView } from '../../sessions/contract';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { createFlowTabs } from './flow-tab';

const SESSION = 'row-1';

function flowOf(hasLeftIdle: boolean): SessionFlow {
  return {
    ...newFlow(SESSION, '/p/proj'),
    stage: hasLeftIdle ? 'feature' : 'idle',
    hasLeftIdle,
  };
}

// Flow tabs over sessions that record each added tab and timers that hold
// each pending run until the test fires it.
function setUp() {
  let flow = newFlow(SESSION, '/p/proj');
  const added: SessionTabView[] = [];
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  const tabs = createFlowTabs({
    addTab(_sessionId, tab) {
      added.push(tab);
      return {
        setStatus: () => undefined,
        select: () => undefined,
        takeOver: () => ({ release: () => undefined }),
        remove: () => undefined,
        isVisible: () => false,
      };
    },
    timers: {
      set(run) {
        const handle = nextHandle++;
        pending.set(handle, run);
        return handle;
      },
      clear: (handle) => pending.delete(handle),
    },
    log: () => undefined,
    flowOf: () => flow,
    nameOf: () => 'proj',
    draw: () => ({ dispose: () => undefined }),
    shown: () => undefined,
  });
  const steps = {
    flow(hasLeftIdle: boolean) {
      flow = flowOf(hasLeftIdle);
      tabs.setFlow(flow);
    },
    build: () => tabs.chatTabBuilt(SESSION),
    timer() {
      const runs = [...pending.values()];
      pending.clear();
      for (const run of runs) {
        run();
      }
    },
    remove: () => tabs.remove(SESSION),
  };
  return { steps, added };
}

type Step = 'flow' | 'idleFlow' | 'build' | 'timer' | 'remove';

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flow tabs', () => {
  it.each<{ case: string; order: Step[]; addsAfter: number[] }>([
    {
      case: 'FlowThenBuildThenTimer_AddsAfterTheTimerOnly',
      order: ['flow', 'build', 'timer'],
      addsAfter: [0, 0, 1],
    },
    {
      case: 'BuildThenFlow_AddsAtOnce',
      order: ['build', 'flow'],
      addsAfter: [0, 1],
    },
    {
      case: 'IdleFlowThenBuild_AddsNone',
      order: ['idleFlow', 'build', 'timer'],
      addsAfter: [0, 0, 0],
    },
    {
      case: 'SecondFlowAfterTheAdd_AddsNoSecond',
      order: ['build', 'flow', 'flow', 'build', 'timer'],
      addsAfter: [0, 1, 1, 1, 1],
    },
    {
      case: 'RemoveThenFlow_WaitsForTheNextBuild',
      order: ['build', 'flow', 'remove', 'flow', 'build', 'timer'],
      addsAfter: [0, 1, 1, 1, 1, 2],
    },
  ])('add_$case', ({ order, addsAfter }) => {
    const { steps, added } = setUp();
    const counts: number[] = [];

    for (const step of order) {
      if (step === 'flow' || step === 'idleFlow') {
        steps.flow(step === 'flow');
      } else {
        steps[step]();
      }
      counts.push(added.length);
    }

    expect(counts).toEqual(addsAfter);
    expect(added.map((tab) => tab.id)).toEqual(
      added.map(() => 'workflow.flow'),
    );
  });
});
