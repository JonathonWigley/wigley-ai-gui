import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlotStore } from '../../../shared/state/slot-store';
import { installFakeDom } from '../../../shared/page/test-dom';
import { startPagePart } from '../../../shared/plugin-part-harness.test-support';
import {
  type OpenedProblem,
  type PracticePlace,
  type ProblemSummary,
  practicePlaceSlot,
} from '../contract';
import { practicePagePart } from './start';

// Two problems, listed out of their sorted order: `easy` sorts first.
const HARD: ProblemSummary = {
  slug: 'hard-one',
  title: 'Hard One',
  difficulty: 'hard',
  tags: [],
  lists: [],
  status: 'new',
  due: false,
};
const EASY: ProblemSummary = {
  ...HARD,
  slug: 'easy-one',
  title: 'Easy One',
  difficulty: 'easy',
};
const SECOND = HARD.slug;

function opened(summary: ProblemSummary): OpenedProblem {
  return {
    summary,
    statement: '',
    signature: {
      kind: 'function',
      method: 'solve',
      params: [],
      returns: 'int',
    },
    code: '',
    notes: '',
    customCases: '',
    attempt: {
      id: 'a1',
      started: '2026-01-01T00:00:00Z',
      peeked: false,
      interviewer: null,
    },
    submissions: [],
  };
}

// A Practice page whose `list` reads both problems and whose `open` opens the
// slug asked for; `calls` holds each invoke, `place` the last page's place.
function startPracticePage(place?: PracticePlace) {
  installFakeDom(vi.stubGlobal);
  const calls: { method: string; args: unknown[] }[] = [];
  const state = createSlotStore(() => undefined);
  if (place !== undefined) {
    const oldPage = state.publish(practicePlaceSlot);
    oldPage.set(place);
    oldPage.dispose();
  }
  const harness = startPagePart(practicePagePart, {
    firstModeTaken: true,
    state,
    invoke: async (method, ...args) => {
      calls.push({ method, args });
      if (method === 'list') {
        return [HARD, EASY];
      }
      if (method === 'open') {
        return opened(args[0] === EASY.slug ? EASY : HARD);
      }
      return undefined;
    },
  });
  return { harness, calls };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const messagesOf = (harness: ReturnType<typeof startPracticePage>['harness']) =>
  harness.logs.map((line) => line.message);

describe('practicePagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the selected problem on openProblem', async () => {
    const { harness, calls } = startPracticePage();
    await settle();
    const commands = harness.started().commands;

    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();

    expect(calls).toContainEqual({ method: 'open', args: [SECOND] });
    expect(messagesOf(harness)).toContain(`opened ${SECOND}`);
  });

  it('reads the list again on changed', async () => {
    const { harness, calls } = startPracticePage();
    await settle();
    harness.started().commands.listDown({ arg: undefined });

    harness.send('changed', { slug: null });
    await settle();

    expect(calls.filter((call) => call.method === 'list')).toHaveLength(2);
    expect(harness.state.read(practicePlaceSlot, 'test').get()).toMatchObject({
      selectedSlug: SECOND,
    });
  });

  it('restores the place', async () => {
    const { harness } = startPracticePage({
      selectedSlug: SECOND,
      openSlug: SECOND,
      filter: '',
    });
    await settle();
    await settle();

    expect(messagesOf(harness)).toEqual(
      expect.arrayContaining([`selected ${SECOND}`, `opened ${SECOND}`]),
    );
  });
});
