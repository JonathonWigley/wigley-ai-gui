import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAsk,
  AgentHarness,
  AgentHarnessInfo,
  ChatEntry,
} from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import { FAKE_ASK_REPLY } from '../../../shared/fake-agent-harness';
import {
  deferred,
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type ChatMainExports,
  type ChatSessionInfo,
  chatEntriesSlot,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  type FormsMainExports,
  formsConfirmsSlot,
  formsMainKey,
  type OpenConfirm,
} from '../../forms/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { permissionReviewsSlot, type Review } from '../contract';
import {
  findReviewer,
  REVIEW_TIMEOUT_MS,
  type ReviewerDeps,
} from './review-requests';
import { permissionReviewMainPart } from './start';

const SESSION = 's1';
const WORK = { name: 'work', configDir: '~/.claude-work' };

const DONE: Review = {
  state: 'done',
  summary: 'Deletes the file fake.txt from the project folder.',
  verdict: 'deny',
  risk: 'medium',
};
const REVIEWING: Review = { state: 'reviewing' };

const CHAT: Pick<ChatMainExports, 'defaultProfile'> = {
  defaultProfile: () => null,
};
const SESSIONS: Pick<SessionsMainExports, 'label'> = { label: () => 'gamma' };
const CLAUDE = { id: 'claude' } as AgentHarness;

const CONFIRM: OpenConfirm = {
  sessionId: SESSION,
  subject: { toolName: 'run_command', input: { id: 'core.quit' } },
};

const settled = () => new Promise((settle) => setImmediate(settle));

const reviewsOf = (entries: [string, Review][]) => new Map(entries);

function chatSession(
  sessionId: string,
  session: Partial<ChatSessionInfo> = {},
): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/work/app',
    harness: 'claude',
    profile: 'work',
    activity: 'waiting',
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'app',
    branch: null,
    worktrees: [],
    headless: false,
    ...session,
  };
}

function permission(id: string, isAnswered = false): ChatEntry {
  return {
    kind: 'permission',
    id,
    at: 0,
    toolName: 'Bash',
    input: { command: 'rm fake.txt' },
    summary: 'rm fake.txt',
    answer: isAnswered ? { allowed: true, reason: null } : null,
    raw: [],
  };
}

function assistant(id: string): ChatEntry {
  return {
    kind: 'assistant',
    id,
    at: 0,
    agentId: 'main',
    text: 'Done.',
    streaming: false,
    raw: [],
  };
}

// A slot store holding chat session `s1` on harness `claude`, whose profile
// `work` is published, with the writers of the slots the part reads.
function seedSlots() {
  const state = createSlotStore(() => undefined);
  const infos = state.publish(coreAgentHarnessesSlot);
  infos.set('claude', harnessInfo({ profiles: [WORK] }));
  const chatSessions = state.publish(chatSessionSlot);
  chatSessions.set(SESSION, chatSession(SESSION));
  return {
    state,
    chatSessions,
    entries: state.publish(chatEntriesSlot),
    confirms: state.publish(formsConfirmsSlot),
  };
}

type Slots = ReturnType<typeof seedSlots>;
type Pending = ReturnType<typeof deferred<string>>;

// The part over `seedSlots`' slots, which `seed` writes before the start.
// `answer` is the stub ask's: by default each ask waits in `pending` until the
// test settles it, and rejects once its signal aborts, as a harness's does.
function startReviewing(
  options: {
    answer?: (request: AgentAsk) => Promise<string>;
    seed?: (slots: Slots) => void;
  } = {},
) {
  const slots = seedSlots();
  options.seed?.(slots);
  const pending: Pending[] = [];
  const holdUntilSettled = (request: AgentAsk) => {
    const reply = deferred<string>();
    request.signal.addEventListener('abort', () =>
      reply.reject(new Error('aborted')),
    );
    pending.push(reply);
    return reply.promise;
  };
  const ask = vi.fn(options.answer ?? holdUntilSettled);
  const claude: Pick<AgentHarness, 'id' | 'ask'> = { id: 'claude', ask };
  const harness = startMainPart(permissionReviewMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => CHAT as ChatMainExports),
      fakeDependency(formsMainKey, () => ({}) as FormsMainExports),
      fakeDependency(sessionsMainKey, () => SESSIONS as SessionsMainExports),
    ],
    services: { agentHarnesses: harnessRegistryOf([claude as AgentHarness]) },
    state: slots.state,
  });
  return {
    ...slots,
    harness,
    ask,
    pending,
    reviews: harness.state.read(permissionReviewsSlot, 'test'),
    signal: (call: number) => ask.mock.calls[call][0].signal,
    messages: () =>
      harness.logs
        .filter(({ source }) => source === 'permission-review')
        .map(({ message }) => message),
  };
}

type Test = ReturnType<typeof startReviewing>;

// `findReviewer`'s deps over chat session `session`, chat's default profile
// `fallback`, harness `claude` publishing `work` and the unregistered harness
// `lab` publishing `lab`.
function reviewerDeps(
  session: ChatSessionInfo | undefined,
  fallback: string | null,
): ReviewerDeps {
  const infos = new Map<string, AgentHarnessInfo>([
    ['claude', harnessInfo({ profiles: [WORK] })],
    ['lab', harnessInfo({ profiles: [{ name: 'lab', configDir: '~/.lab' }] })],
  ]);
  return {
    chatSessions: {
      get: (id) => (id === session?.sessionId ? session : undefined),
    },
    harnessInfos: { get: (id) => infos.get(id), all: () => infos },
    harnesses: { get: (id) => (id === CLAUDE.id ? CLAUDE : null) },
    defaultProfile: () => fallback,
  };
}

describe('permissionReviewMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startReviewing();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startReviewing();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each([
    {
      case: 'an unanswered permission put',
      act: (test: Test) => test.entries.put(SESSION, permission('p1')),
      asks: 1,
      keys: ['s1/p1'],
    },
    {
      case: 'the same put twice',
      act: (test: Test) => {
        test.entries.put(SESSION, permission('p1'));
        test.entries.put(SESSION, permission('p1'));
      },
      asks: 1,
      keys: ['s1/p1'],
    },
    {
      case: 'a put with an answer',
      act: (test: Test) => test.entries.put(SESSION, permission('p1', true)),
      asks: 0,
      keys: [],
    },
    {
      case: 'a replace holding an unanswered permission',
      act: (test: Test) => test.entries.replace(SESSION, [permission('p1')]),
      asks: 0,
      keys: [],
    },
    {
      case: 'an answer put while the review runs',
      act: (test: Test) => {
        test.entries.put(SESSION, permission('p1'));
        test.entries.put(SESSION, permission('p1', true));
      },
      asks: 1,
      keys: ['s1/p1'],
    },
    {
      case: 'a non-permission entry put',
      act: (test: Test) => test.entries.put(SESSION, assistant('a1')),
      asks: 0,
      keys: [],
    },
    {
      case: 'a new forms.confirms key',
      act: (test: Test) => test.confirms.set('r1', CONFIRM),
      asks: 1,
      keys: ['confirm/r1'],
    },
    {
      case: 'the same confirms key set twice',
      act: (test: Test) => {
        test.confirms.set('r1', CONFIRM);
        test.confirms.set('r1', CONFIRM);
      },
      asks: 1,
      keys: ['confirm/r1'],
    },
  ])('request_$case_StartsReviews', async ({ act, asks, keys }) => {
    const test = startReviewing();

    act(test);

    expect(test.ask).toHaveBeenCalledTimes(asks);
    expect(test.reviews.all()).toEqual(
      reviewsOf(keys.map((key): [string, Review] => [key, REVIEWING])),
    );
    for (const reply of test.pending) {
      reply.resolve(FAKE_ASK_REPLY);
    }
    await settled();
    expect(test.reviews.all()).toEqual(
      reviewsOf(keys.map((key): [string, Review] => [key, DONE])),
    );
  });

  it('request_Confirm_AsksOnItsSessionsProfileAndFolder', () => {
    const test = startReviewing();

    test.confirms.set('r1', CONFIRM);

    expect(test.ask.mock.calls[0][0]).toMatchObject({
      profileDir: '~/.claude-work',
      prompt: expect.stringContaining('Project folder: /work/app'),
    });
  });

  it.each([
    {
      case: 'a deny reply',
      settle: (test: Test) => test.pending[0].resolve(FAKE_ASK_REPLY),
      review: DONE,
      log: 'reviewed Bash in gamma: deny · medium',
      isAborted: false,
    },
    {
      case: 'a rejected ask',
      settle: (test: Test) => test.pending[0].reject(new Error('boom')),
      review: { state: 'unavailable', reason: 'boom' },
      log: 'review unavailable for Bash in gamma: boom',
      isAborted: false,
    },
    {
      case: 'a reply that is not JSON',
      settle: (test: Test) => test.pending[0].resolve('not json'),
      review: {
        state: 'unavailable',
        reason: "the reviewer's reply was not the expected JSON",
      },
      log: "review unavailable for Bash in gamma: the reviewer's reply was not the expected JSON",
      isAborted: false,
    },
    {
      case: 'an ask past the time limit',
      settle: (test: Test) => test.harness.advance(REVIEW_TIMEOUT_MS),
      review: {
        state: 'unavailable',
        reason: 'the review took longer than 60 s',
      },
      log: 'review unavailable for Bash in gamma: the review took longer than 60 s',
      isAborted: true,
    },
  ])('review_$case_Publishes', async ({ settle, review, log, isAborted }) => {
    const test = startReviewing();
    test.entries.put(SESSION, permission('p1'));
    expect(test.reviews.get('s1/p1')).toEqual(REVIEWING);

    settle(test);
    await settled();

    expect(test.reviews.get('s1/p1')).toEqual(review);
    expect(test.messages()).toEqual([log]);
    expect(test.signal(0).aborted).toBe(isAborted);
  });

  it.each([
    {
      case: 'its confirms key deleted',
      open: (test: Test) => test.confirms.set('r1', CONFIRM),
      remove: (test: Test) => test.confirms.delete('r1'),
      key: 'confirm/r1',
    },
    {
      case: 'its session ended',
      open: (test: Test) => test.entries.put(SESSION, permission('p1')),
      remove: (test: Test) =>
        test.harness.emit('sessions.ended', { sessionId: SESSION }),
      key: 's1/p1',
    },
    {
      case: 'a replace without its entry',
      open: (test: Test) => test.entries.put(SESSION, permission('p1')),
      remove: (test: Test) => test.entries.replace(SESSION, [assistant('a1')]),
      key: 's1/p1',
    },
  ])('removal_$case_AbortsAndDeletes', async ({ open, remove, key }) => {
    const test = startReviewing();
    open(test);

    remove(test);
    await settled();

    expect(test.signal(0).aborted).toBe(true);
    expect(test.reviews.all().has(key)).toBe(false);
    expect(test.messages()).toEqual([]);
  });

  it('replace_StillHoldingTheEntry_KeepsItsReview', async () => {
    const test = startReviewing();
    test.entries.put(SESSION, permission('p1'));

    test.entries.replace(SESSION, [permission('p1'), assistant('a1')]);
    await settled();

    expect(test.signal(0).aborted).toBe(false);
    expect(test.reviews.get('s1/p1')).toEqual(REVIEWING);
  });

  it.each([
    {
      case: 'a chat session on an unregistered harness',
      session: chatSession(SESSION, { harness: 'codex' }),
      fallback: null,
      reason: 'no agent harness "codex"',
    },
    {
      case: 'a chat session on an unpublished profile',
      session: chatSession(SESSION, { profile: 'home' }),
      fallback: null,
      reason: 'no profile "home"',
    },
    {
      case: 'no chat session and no default profile',
      session: undefined,
      fallback: null,
      reason: 'no profile to review with',
    },
    {
      case: 'no chat session and an unpublished default profile',
      session: undefined,
      fallback: 'home',
      reason: 'no profile "home"',
    },
    {
      case: 'no chat session and a default profile on an unregistered harness',
      session: undefined,
      fallback: 'lab',
      reason: 'no agent harness "lab"',
    },
  ])('findReviewer_$case_IsUnavailable', ({ session, fallback, reason }) => {
    const reviewer = findReviewer(SESSION, reviewerDeps(session, fallback));

    expect(reviewer).toEqual({ reason });
  });

  it.each([
    {
      case: 'a chat session',
      session: chatSession(SESSION),
      projectDir: '/work/app',
    },
    { case: 'the default profile', session: undefined, projectDir: null },
  ])('findReviewer_$case_FindsTheProfile', ({ session, projectDir }) => {
    expect(findReviewer(SESSION, reviewerDeps(session, 'work'))).toEqual({
      harness: CLAUDE,
      profileDir: '~/.claude-work',
      projectDir,
    });
  });

  it.each([
    {
      case: 'an unanswered entry under review',
      answer: undefined,
      seed: (slots: Slots) => slots.entries.put(SESSION, permission('p1')),
      asks: 2,
      reviews: reviewsOf([['s1/p1', REVIEWING]]),
    },
    {
      case: 'a done review of an entry still present',
      answer: () => Promise.resolve(FAKE_ASK_REPLY),
      seed: (slots: Slots) => slots.entries.put(SESSION, permission('p1')),
      asks: 1,
      reviews: reviewsOf([['s1/p1', DONE]]),
    },
    {
      case: 'a confirms key open at start',
      answer: () => Promise.resolve(FAKE_ASK_REPLY),
      seed: (slots: Slots) => slots.confirms.set('r1', CONFIRM),
      asks: 1,
      reviews: reviewsOf([['confirm/r1', DONE]]),
    },
    {
      case: 'reviews whose session and round went',
      answer: undefined,
      seed: (slots: Slots) => {
        const held = slots.state.publish(permissionReviewsSlot);
        held.set('s9/p1', DONE);
        held.set('confirm/r9', DONE);
        held.dispose();
      },
      asks: 0,
      reviews: reviewsOf([]),
    },
  ])('restart_$case', async ({ answer, seed, asks, reviews }) => {
    const test = startReviewing({ answer, seed });
    await settled();

    await test.harness.restart();
    await settled();

    expect(test.ask).toHaveBeenCalledTimes(asks);
    expect(test.reviews.all()).toEqual(reviews);
  });
});
