import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatEntryPart,
  type ChatPageExports,
  chatPageKey,
} from '../../chat/contract';
import {
  type FormsCardPart,
  formsConfirmsSlot,
  type FormsPageExports,
  formsPageKey,
} from '../../forms/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import {
  chatReviewKey,
  confirmReviewKey,
  permissionReviewsSlot,
} from '../contract';
import { permissionReviewPagePart } from './start';

const SESSION = 's1';
const ENTRY = 'e3';
const KEY = chatReviewKey(SESSION, ENTRY);
const ROUND = 'round-7';

// The part on the harness, over fakes that file each handle with
// `consumer.track` as the real views do; chat's builds the entry part into a
// new wrapper at once, for a permission entry of the session, and forms' the
// card part, for the first question of round `ROUND`.
function startOnHarness() {
  const wrappers: FakeElement[] = [];
  const cardWrappers: FakeElement[] = [];
  const harness = startPagePart(permissionReviewPagePart, {
    dependencies: [
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addEntryPart(part: ChatEntryPart<'permission'>) {
              const wrapper = new FakeElement('div');
              wrappers.push(wrapper);
              part.build(asHtml(wrapper), {
                sessionId: SESSION,
                input: {
                  kind: 'permission',
                  id: ENTRY,
                  toolName: 'Bash',
                  summary: 'git push',
                  input: { command: 'git push' },
                  answer: null,
                  raw: [],
                },
              });
              return consumer.track({ dispose: () => undefined });
            },
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        formsPageKey,
        (consumer) =>
          ({
            addCardPart(part: FormsCardPart) {
              const wrapper = new FakeElement('div');
              cardWrappers.push(wrapper);
              part.build(asHtml(wrapper), {
                roundId: ROUND,
                kind: 'question',
                index: 1,
              });
              return consumer.track({ dispose: () => undefined });
            },
          }) as unknown as FormsPageExports,
      ),
      fakeDependency(
        sessionsPageKey,
        () => ({ activate: () => undefined }) as unknown as SessionsPageExports,
      ),
    ],
  });
  // The heading the latest of `drawn` shows, undefined while it is empty.
  const headingOf = (drawn: FakeElement[]) => {
    const wrapper = drawn.at(-1) ?? new FakeElement('div');
    return findAll(wrapper, 'permission-review-verdict-heading')[0]
      ?.textContent;
  };
  return {
    harness,
    heading: () => headingOf(wrappers),
    cardHeading: () => headingOf(cardWrappers),
  };
}

type Harness = ReturnType<typeof startOnHarness>['harness'];

describe('permissionReviewPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startOnHarness();
    harness.ready();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startOnHarness();
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each<{ name: string; load: (harness: Harness) => Promise<void> }>([
    { name: 'page load', load: async (harness) => harness.ready() },
    {
      name: 'live restart',
      load: async (harness) => {
        harness.ready();
        await harness.restart();
      },
    },
  ])(
    'ready_ReviewWrittenBefore_DrawsItAndHearsTheNext: $name',
    async ({ load }) => {
      const { harness, heading } = startOnHarness();
      const reviews = harness.state.publish(permissionReviewsSlot);
      reviews.set(KEY, {
        state: 'done',
        summary: 'Pushes the branch.',
        verdict: 'approve',
        risk: 'low',
      });
      expect(heading()).toBeUndefined();

      await load(harness);
      const drawnAtLoad = heading();
      reviews.set(KEY, {
        state: 'done',
        summary: 'Pushes to a protected branch.',
        verdict: 'deny',
        risk: 'high',
      });

      expect([drawnAtLoad, heading()]).toEqual([
        'Approve · low risk',
        'Deny · high risk',
      ]);
    },
  );

  it.each<{
    case: string;
    confirmOpens: 'beforeReady' | 'afterReady' | 'never';
    expected: string | undefined;
  }>([
    {
      case: 'OpenBeforeReady_DrawsAtReady',
      confirmOpens: 'beforeReady',
      expected: 'Approve · low risk',
    },
    {
      case: 'OpensAfterReady_DrawsOnTheConfirm',
      confirmOpens: 'afterReady',
      expected: 'Approve · low risk',
    },
    {
      case: 'NotAConfirmRound_StaysEmpty',
      confirmOpens: 'never',
      expected: undefined,
    },
  ])('confirmCard_$case', ({ confirmOpens, expected }) => {
    const { harness, cardHeading } = startOnHarness();
    harness.state.publish(permissionReviewsSlot).set(confirmReviewKey(ROUND), {
      state: 'done',
      summary: 'Pushes the branch.',
      verdict: 'approve',
      risk: 'low',
    });
    const confirms = harness.state.publish(formsConfirmsSlot);
    const openConfirm = () =>
      confirms.set(ROUND, {
        sessionId: SESSION,
        subject: { toolName: 'Bash', input: { command: 'git push' } },
      });

    if (confirmOpens === 'beforeReady') {
      openConfirm();
    }
    harness.ready();
    if (confirmOpens === 'afterReady') {
      openConfirm();
    }

    expect(cardHeading()).toBe(expected);
  });
});
