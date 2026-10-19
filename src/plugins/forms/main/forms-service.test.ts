import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../sessions/contract';
import type {
  AnswerEntry,
  AnswersPayload,
  FormBody,
  FormsSession,
} from '../contract';
import { createFormsService } from './forms-service';
import { answersPayload, fingerprint, parseRound } from './round';
import { RoundError } from './round-error';
import {
  createRoundStore,
  type RoundOwner,
  type RoundStore,
  type SavedOutcome,
  type SavedRound,
} from './round-store';
import { ScriptedRoundPresenter } from './scripted-presenter';

const DEFAULT_DEADLINE_SECONDS = 240;

const SESSION: SessionInfo = {
  sessionId: 'session-1',
  projectDir: '/work/wigley',
  deadlineSeconds: null,
};

function question(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Naming',
    context: 'Two modules do the same thing under different names.',
    question: 'Which name should win?',
    choices: ['module_a', 'module_b'],
    recommend: 1,
    rationale: 'module_a is older and already referenced elsewhere.',
    ...overrides,
  };
}

const NAMING_ARGS = {
  heading: 'Naming decisions',
  overview: 'Tidying modules. This round: names.',
  questions: [question()],
};

const PLACEMENT_ARGS = {
  heading: 'Placement decisions',
  overview: 'Tidying modules. This round: places.',
  questions: [
    question({ title: 'Placement', question: 'Where should it live?' }),
  ],
};

const NOTICE_ARGS = {
  ...NAMING_ARGS,
  notices: [{ title: 'Renamed the helper', context: 'No behaviour changed.' }],
};

function answer(entry: Partial<AnswerEntry>): AnswerEntry {
  return {
    index: 1,
    choice: 0,
    not_applicable: false,
    what: '',
    why: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...entry,
  };
}

function oneAnswer(entry: Partial<AnswerEntry>, note = ''): FormBody {
  return { note, answers: [answer(entry)], notice_comments: [] };
}

const HALF_BODY = oneAnswer({ choice: 2, what: 'half done' });

let roundsDir: string;
let hexCount: number;
let presenter: ScriptedRoundPresenter;
let store: RoundStore;

function startSession(info: Partial<SessionInfo> = {}): FormsSession {
  return createFormsService({
    presenter,
    store,
    defaultDeadlineSeconds: DEFAULT_DEADLINE_SECONDS,
  }).startSession({ id: 'app-1', info: { ...SESSION, ...info } });
}

function live(): AbortSignal {
  return new AbortController().signal;
}

function savedFile(roundId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(roundsDir, `${roundId}.json`), 'utf8'),
  );
}

// The newest saved file for a round, which the test expects to exist.
function newestSaved(roundFingerprint: string): SavedRound {
  const record = store.newestFor(roundFingerprint);
  expect(record).not.toBeNull();
  return record as SavedRound;
}

// The draft the latest shown round opened with, which the test expects to exist.
function latestDraft(): FormBody {
  const { draft } = presenter.latest();
  expect(draft).not.toBeNull();
  return draft as FormBody;
}

// A round an earlier app run left on disk.
function saveEarlier(
  args: unknown,
  outcome: SavedOutcome,
  body: FormBody,
  owner: RoundOwner = SESSION,
): SavedRound {
  const record = store.create(
    owner,
    fingerprint(parseRound(args)),
    args,
    body,
    null,
  );
  if (outcome !== 'open') {
    store.finish(record, outcome, body);
  }
  return record;
}

// Runs out the soft deadline of every call waiting now.
async function expireDeadline(seconds = DEFAULT_DEADLINE_SECONDS) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

// Tracks whether a call has answered yet.
function watch(pending: Promise<AnswersPayload>): { settled: boolean } {
  const state = { settled: false };
  void pending.then(() => {
    state.settled = true;
  });
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  roundsDir = mkdtempSync(path.join(tmpdir(), 'wigley-forms-service-'));
  hexCount = 0;
  presenter = new ScriptedRoundPresenter();
  store = createRoundStore({
    roundsDir,
    clock: { now: () => 1_000_000 },
    randomHex: () => (++hexCount).toString(16).padStart(8, '0'),
    log: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(roundsDir, { recursive: true, force: true });
});

describe('askRound', () => {
  it('returns the submitted answers as the payload', async () => {
    const session = startSession();

    const pending = session.askRound(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 1 }));

    expect(await pending).toEqual(
      answersPayload(
        parseRound(NAMING_ARGS),
        'submitted',
        oneAnswer({ choice: 1 }),
      ),
    );
  });

  it('shows a new round labelled with its project folder and no draft', () => {
    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest()).toMatchObject({
      label: 'wigley · Naming decisions',
      round: parseRound(NAMING_ARGS),
      draft: null,
    });
  });

  it('names its session on the round it shows', () => {
    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().sessionId).toBe('app-1');
  });

  it('labels a round with its heading alone when the session has no project', () => {
    void startSession({ projectDir: null }).askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().label).toBe('Naming decisions');
  });

  it('returns notices and their comments beside the answers', async () => {
    const pending = startSession().askRound(NOTICE_ARGS, null, live());
    presenter.submit(presenter.latest().roundId, {
      ...oneAnswer({ choice: 1 }),
      notice_comments: [{ index: 1, comment: 'looks right' }],
    });

    const payload = await pending;

    expect(payload.notices).toEqual([
      {
        index: 1,
        title: 'Renamed the helper',
        badge: 'Applied',
        comment: 'looks right',
      },
    ]);
    expect(payload.answers).toHaveLength(1);
  });

  it('rejects a malformed round with its RoundError and shows nothing', async () => {
    const rejection = startSession().askRound(
      { heading: 'H', questions: [] },
      null,
      live(),
    );

    await expect(rejection).rejects.toBeInstanceOf(RoundError);
    await expect(rejection).rejects.toThrow(
      'ask_round needs at least one question or notice.',
    );
    expect(presenter.shown).toEqual([]);
  });

  it("saves a new round's file with its calling tool use id, or null without one", () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, 'toolu_first', live());
    const first = presenter.latest().roundId;
    void startSession().askRound(PLACEMENT_ARGS, null, live());
    const second = presenter.latest().roundId;

    expect(savedFile(first).tool_use_id).toBe('toolu_first');
    expect(savedFile(second).tool_use_id).toBeNull();
  });

  it("opens a second call's round only once the user finishes the first", async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const second = session.askRound(PLACEMENT_ARGS, null, live());
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(1);
    const naming = presenter.latest();

    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    expect(await first).toEqual(
      answersPayload(
        parseRound(NAMING_ARGS),
        'submitted',
        oneAnswer({ choice: 1 }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    expect((await second).answers[0].choice).toBe(2);
  });

  it('runs the next call after one that rejected', async () => {
    const session = startSession();
    const malformed = session.askRound({ heading: 'H' }, null, live());
    void session.askRound(NAMING_ARGS, null, live());

    await expect(malformed).rejects.toBeInstanceOf(RoundError);
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(1);
  });

  it('closes the round in the window once the user cancels it', async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    presenter.cancel(shown.roundId, oneAnswer({}));

    expect((await pending).outcome).toBe('cancelled');
    expect(presenter.closed).toEqual([shown.roundId]);
  });
});

describe('the soft deadline', () => {
  it('hands back a draft at the default deadline and leaves the round open', async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    const call = watch(pending);

    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000 - 1);
    expect(call.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const payload = await pending;
    expect(payload.outcome).toBe('draft');
    expect(payload.next).toContain('collect_last_round');
    expect(presenter.closed).toEqual([]);
  });

  it("waits as long as the hello's deadline says", async () => {
    const pending = startSession({ deadlineSeconds: 300 }).askRound(
      NAMING_ARGS,
      null,
      live(),
    );
    const call = watch(pending);

    await expireDeadline(DEFAULT_DEADLINE_SECONDS);
    expect(call.settled).toBe(false);
    await expireDeadline(300 - DEFAULT_DEADLINE_SECONDS);

    expect((await pending).outcome).toBe('draft');
  });

  // 2_147_484 s is past setTimeout's 2**31-1 ms limit.
  it.each([0, -5, 2_147_484])(
    'uses the default for a deadline of %d',
    async (deadlineSeconds) => {
      const pending = startSession({ deadlineSeconds }).askRound(
        NAMING_ARGS,
        null,
        live(),
      );
      const call = watch(pending);

      await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000 - 1);
      expect(call.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.settled).toBe(true);
      expect((await pending).outcome).toBe('draft');
    },
  );

  it('carries the latest draft the user saved', async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    presenter.draft(
      presenter.latest().roundId,
      oneAnswer({ choice: 2, what: 'w' }),
    );

    await expireDeadline();
    const payload = await pending;

    expect(payload.outcome).toBe('draft');
    expect(payload.answers[0]).toMatchObject({ choice: 2, what: 'w' });
  });
});

describe('collectLastRound', () => {
  it('returns no_round when nothing was sent', async () => {
    const payload = await startSession().collectLastRound(true, live());

    expect(payload.outcome).toBe('no_round');
    expect(payload.answers).toEqual([]);
    expect(payload.next).toContain('ask_round');
  });

  it('re-attaches to a draft without showing the round again', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    expect((await first).outcome).toBe('draft');

    const second = session.collectLastRound(true, live());
    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }));

    expect((await second).outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(1);
  });

  it('wakes two calls waiting on one round with the same answers, marking the file returned once', async () => {
    const markReturned = vi.spyOn(store, 'markReturned');
    const session = startSession();
    const asking = session.askRound(NAMING_ARGS, null, live());
    const collecting = session.collectLastRound(true, live());
    const shown = presenter.latest();

    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }));
    const [fromAsk, fromCollect] = await Promise.all([asking, collecting]);

    expect(fromAsk.outcome).toBe('submitted');
    expect(fromCollect.outcome).toBe('submitted');
    expect(fromCollect.answers).toEqual(fromAsk.answers);
    expect(newestSaved(fingerprint(parseRound(NAMING_ARGS))).returned).toBe(
      true,
    );
    expect(markReturned).toHaveBeenCalledTimes(1);
    expect(presenter.closed).toEqual([shown.roundId]);
  });

  it('replays the last submitted answers', async () => {
    const session = startSession();
    const pending = session.askRound(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    const first = await pending;

    expect(await session.collectLastRound(true, live())).toEqual(first);
    expect(presenter.shown).toHaveLength(1);
  });

  it('with wait false returns the current draft at once', async () => {
    const session = startSession();
    void session.askRound(NOTICE_ARGS, null, live());
    presenter.draft(presenter.latest().roundId, {
      ...oneAnswer({}),
      notice_comments: [{ index: 1, comment: 'still checking' }],
    });

    const payload = await session.collectLastRound(false, live());

    expect(payload.outcome).toBe('draft');
    expect(payload.notices[0].comment).toBe('still checking');
  });

  it('with wait false reports a round the user submitted after its draft', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }, 'done'));

    const payload = await session.collectLastRound(false, live());

    expect(payload.outcome).toBe('submitted');
    expect(payload.note).toBe('done');
  });

  it('answers an aborted call with a draft', async () => {
    const session = startSession();
    const controller = new AbortController();
    const first = session.askRound(NAMING_ARGS, null, controller.signal);
    presenter.draft(presenter.latest().roundId, oneAnswer({ choice: 2 }));

    controller.abort();
    const payload = await first;

    expect(payload.outcome).toBe('draft');
    expect(payload.answers[0].choice).toBe(2);
  });
});

describe('a call the host cancels', () => {
  it('closes its round in the window and keeps the draft in the open file', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    presenter.draft(naming.roundId, oneAnswer({ choice: 2 }, 'half'));

    host.abort();
    await asking;

    expect(presenter.closed).toEqual([naming.roundId]);
    expect(savedFile(naming.roundId)).toMatchObject({
      outcome: 'open',
      body: { note: 'half' },
    });
  });

  it("shows the session's next round at once", async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);

    host.abort();
    await asking;
    void session.askRound(PLACEMENT_ARGS, null, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
  });

  it('opens a different round queued behind it at once', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    void session.askRound(PLACEMENT_ARGS, null, live());

    host.abort();
    await asking;
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.closed).toEqual([naming.roundId]);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
  });

  it('keeps the round open for a re-send of it queued behind the cancelled call', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const resent = session.askRound(NAMING_ARGS, null, live());

    host.abort();
    await asking;
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.closed).toEqual([]);
    expect(presenter.shown).toHaveLength(1);
    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    expect((await resent).outcome).toBe('submitted');
  });

  it('stops counting a queued re-send the host cancels, so cancelling the call ahead closes the round', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const resendHost = new AbortController();
    const resent = session.askRound(NAMING_ARGS, null, resendHost.signal);

    resendHost.abort();
    await expect(resent).rejects.toThrow(
      'ask_round was cancelled before it ran.',
    );
    expect(presenter.closed).toEqual([]);
    host.abort();
    await asking;

    expect(presenter.closed).toEqual([naming.roundId]);
  });

  it('closes a round left open after its deadline draft once a collect on it is cancelled', async () => {
    const session = startSession();
    const asking = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    await asking;
    const host = new AbortController();
    const collecting = session.collectLastRound(true, host.signal);

    host.abort();
    await collecting;

    expect(presenter.closed).toEqual([naming.roundId]);
  });

  it('answers a collect with no_round, whose next says to send the round again', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    presenter.draft(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    host.abort();
    await asking;

    const payload = await session.collectLastRound(true, live());

    expect(payload.outcome).toBe('no_round');
    expect(payload.next).toContain('send the same round again with ask_round');
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens the round pre-filled when it is sent again', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    presenter.draft(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    host.abort();
    await asking;

    void session.askRound(NAMING_ARGS, null, live());

    expect(presenter.shown).toHaveLength(2);
    expect(latestDraft()).toEqual(oneAnswer({ choice: 2 }));
  });

  it('keeps the round open while another call still waits on it', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const collecting = session.collectLastRound(true, live());

    host.abort();
    await asking;

    expect(presenter.closed).toEqual([]);
    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    expect((await collecting).outcome).toBe('submitted');
  });

  it('returns and marks returned a round the user finished in the same tick', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.askRound(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));

    host.abort();

    expect((await asking).outcome).toBe('submitted');
    expect(savedFile(naming.roundId).returned).toBe(true);
  });

  it('leaves the open round be when a call queued behind it is cancelled', async () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    const host = new AbortController();
    const queued = session.askRound(PLACEMENT_ARGS, null, host.signal);

    host.abort();
    await expect(queued).rejects.toThrow(
      'ask_round was cancelled before it ran.',
    );

    expect(presenter.closed).toEqual([]);
  });

  it("leaves the round open when a queued re-send's own deadline wakes it", async () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await vi.advanceTimersByTimeAsync(100_000);
    const resent = session.askRound(NAMING_ARGS, null, live());

    await expireDeadline();
    expect((await resent).outcome).toBe('draft');

    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.roundId).outcome).toBe('open');
  });
});

describe('re-sending a round', () => {
  it('re-attaches to the open round under a reworded heading, keeping its first tool use id', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, 'toolu_first', live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;

    const second = session.askRound(
      { ...NAMING_ARGS, heading: 'Reworded heading' },
      'toolu_resent',
      live(),
    );
    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }));

    expect((await second).outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(1);
    expect(savedFile(shown.roundId).tool_use_id).toBe('toolu_first');
  });

  it('replays the round just submitted', async () => {
    const session = startSession();
    const pending = session.askRound(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    const first = await pending;

    expect(await session.askRound(NAMING_ARGS, null, live())).toEqual(first);
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens a fresh round pre-filled from the round just cancelled', async () => {
    const session = startSession();
    const cancelledBody = oneAnswer(
      { choice: 2, what: 'half done' },
      'stop here',
    );
    const pending = session.askRound(NAMING_ARGS, null, live());
    const first = presenter.latest();
    presenter.cancel(first.roundId, cancelledBody);
    await pending;

    void session.askRound(NAMING_ARGS, null, live());

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().roundId).not.toBe(first.roundId);
    expect(presenter.latest().draft).toEqual(cancelledBody);
  });
});

describe('hand-back', () => {
  async function submitAfterDraft(session: FormsSession, choice: number) {
    const first = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.submit(shown.roundId, oneAnswer({ choice }));
    return shown;
  }

  it('hands back an earlier round submitted after its draft, and opens nothing', async () => {
    const session = startSession();
    const naming = await submitAfterDraft(session, 2);

    const handed = await session.askRound(PLACEMENT_ARGS, null, live());

    expect(handed.outcome).toBe('submitted');
    expect(handed.answers[0].choice).toBe(2);
    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(handed.next).toContain('send it again');
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([naming.roundId]);
  });

  it('opens the new round when it is sent again after the hand-back', async () => {
    const session = startSession();
    await submitAfterDraft(session, 2);
    await session.askRound(PLACEMENT_ARGS, null, live());

    const opened = session.askRound(PLACEMENT_ARGS, null, live());
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 1 }));
    const payload = await opened;

    expect(presenter.shown).toHaveLength(2);
    expect(payload.answers[0].choice).toBe(1);
    expect(payload).not.toHaveProperty('earlier_heading');
  });

  it('replays the hand-back to collect_last_round', async () => {
    const session = startSession();
    await submitAfterDraft(session, 2);
    const handed = await session.askRound(PLACEMENT_ARGS, null, live());

    const replayed = await session.collectLastRound(true, live());

    expect(replayed).toEqual(handed);
    expect(replayed.earlier_heading).toBe('Naming decisions');
  });

  it('hands back a cancelled earlier round with its note', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.cancel(shown.roundId, oneAnswer({}, 'stop here'));

    const handed = await session.askRound(PLACEMENT_ARGS, null, live());

    expect(handed.outcome).toBe('cancelled');
    expect(handed.note).toBe('stop here');
    expect(presenter.shown).toHaveLength(1);
  });
});

describe('a call made while another round is open', () => {
  const PLACEMENT_FINGERPRINT = fingerprint(parseRound(PLACEMENT_ARGS));
  const SCOPE_ARGS = {
    heading: 'Scope decisions',
    overview: 'Tidying modules. This round: scope.',
    questions: [question({ title: 'Scope', question: 'What does it cover?' })],
  };

  // A naming round left open past its only call's deadline draft.
  async function leaveOpenDraft(session: FormsSession) {
    const first = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    expect((await first).outcome).toBe('draft');
    return naming;
  }

  // A naming round left open past its first call's deadline draft, and a
  // placement call queued behind it 100 s after the first.
  async function queueBehindOpenDraft(session: FormsSession) {
    const first = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    presenter.draft(naming.roundId, oneAnswer({ choice: 2 }));
    await vi.advanceTimersByTimeAsync(100_000);
    const queued = session.askRound(PLACEMENT_ARGS, null, live());
    await expireDeadline(DEFAULT_DEADLINE_SECONDS - 100);
    return { firstDraft: await first, naming, queued };
  }

  it("keeps waiting past the first call's deadline draft while the round is still open", async () => {
    const session = startSession();
    const { firstDraft, naming, queued } = await queueBehindOpenDraft(session);

    expect(firstDraft.outcome).toBe('draft');
    expect(firstDraft.answers[0].choice).toBe(2);
    expect(watch(queued).settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.roundId).outcome).toBe('open');
  });

  it('opens its round once the user submits the open one', async () => {
    const session = startSession();
    const { naming, queued } = await queueBehindOpenDraft(session);

    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    // Collected in the submit's own tick, before the woken queued call runs,
    // so the queued call opens its round instead of handing this one back.
    const collected = await session.collectLastRound(true, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(collected.outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    const answered = await queued;
    expect(answered.outcome).toBe('submitted');
    expect(answered.earlier_heading).toBeUndefined();
    expect(answered.answers[0].choice).toBe(2);
  });

  it('returns a draft at its own deadline without opening its round or replacing the open one', async () => {
    const session = startSession();
    const { naming, queued } = await queueBehindOpenDraft(session);

    await expireDeadline(100);
    const payload = await queued;

    expect(payload.outcome).toBe('draft');
    expect(payload.summary).toBe(
      "This round, 'Placement decisions', was not shown: the round 'Naming " +
        "decisions' is still open in the app.",
    );
    expect(payload.next).toContain('Send this round again with ask_round');
    expect(payload.next).toContain('earlier_heading');
    expect(payload.earlier_heading).toBeUndefined();
    expect(payload.answers[0].status).toBe('untouched');
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
    const stillOpen = await session.collectLastRound(false, live());
    expect(stillOpen.outcome).toBe('draft');
    expect(stillOpen.answers[0].title).toBe('Naming');
    expect(savedFile(naming.roundId).outcome).toBe('open');
  });

  // The placement call's not-shown draft, returned at its own deadline.
  async function refuseBehindOpenDraft(session: FormsSession) {
    const { naming, queued } = await queueBehindOpenDraft(session);
    await expireDeadline(100);
    const refused = await queued;
    expect(refused.summary).toContain('was not shown');
    return naming;
  }

  it('makes a re-send of its refused round wait too, without closing the open round', async () => {
    const session = startSession();
    const naming = await refuseBehindOpenDraft(session);

    const resent = session.askRound(PLACEMENT_ARGS, null, live());
    const settled = watch(resent);
    await vi.advanceTimersByTimeAsync(1000);

    expect(settled.settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.roundId).outcome).toBe('open');
    await expireDeadline();
    const again = await resent;
    expect(again.outcome).toBe('draft');
    expect(again.summary).toContain('was not shown');
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });

  it('opens a re-sent refused round once the user submits the open one', async () => {
    const session = startSession();
    const naming = await refuseBehindOpenDraft(session);
    const resent = session.askRound(PLACEMENT_ARGS, null, live());

    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    // Collected in the submit's own tick, before the woken re-send runs, so
    // the re-send opens its round instead of handing this one back.
    const collected = await session.collectLastRound(true, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(collected.outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    const answered = await resent;
    expect(answered.outcome).toBe('submitted');
    expect(answered.answers[0].choice).toBe(2);
  });

  it('makes a fresh call wait behind an open draft and return a not-shown draft at its deadline', async () => {
    const session = startSession();
    const naming = await leaveOpenDraft(session);

    const fresh = session.askRound(PLACEMENT_ARGS, null, live());
    const settled = watch(fresh);
    await vi.advanceTimersByTimeAsync(1000);

    expect(settled.settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    await expireDeadline();
    const payload = await fresh;
    expect(payload.outcome).toBe('draft');
    expect(payload.summary).toContain('was not shown');
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
    expect(savedFile(naming.roundId).outcome).toBe('open');
  });

  it("opens a fresh call's round once the user submits the open draft", async () => {
    const session = startSession();
    const naming = await leaveOpenDraft(session);
    const fresh = session.askRound(PLACEMENT_ARGS, null, live());

    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    // Collected in the submit's own tick, before the woken call runs, so the
    // call opens its round instead of handing this one back.
    const collected = await session.collectLastRound(true, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(collected.outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    const answered = await fresh;
    expect(answered.outcome).toBe('submitted');
    expect(answered.answers[0].choice).toBe(2);
  });

  it('hands back the open draft to a fresh call woken by its submit, then opens the fresh round on a re-send', async () => {
    const session = startSession();
    const naming = await leaveOpenDraft(session);
    const fresh = session.askRound(PLACEMENT_ARGS, null, live());

    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    const handed = await fresh;

    expect(handed.outcome).toBe('submitted');
    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(presenter.shown).toHaveLength(1);
    expect(savedFile(naming.roundId).returned).toBe(true);
    void session.askRound(PLACEMENT_ARGS, null, live());
    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
  });

  it('returns the open draft, not a not-shown draft, to a re-send of the open round whose deadline passes while queued', async () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    const resent = session.askRound(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().roundId, oneAnswer({ choice: 2 }));

    // Fires the open call's deadline and the re-send's in one step, so the
    // re-send's passes before the open call's turn ends.
    vi.advanceTimersByTime(DEFAULT_DEADLINE_SECONDS * 1000);
    const payload = await resent;

    expect(payload.outcome).toBe('draft');
    expect(payload.summary).not.toContain('was not shown');
    expect(payload.answers[0].choice).toBe(2);
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens at most one round when one submit wakes calls queued behind aborted ones', async () => {
    const TESTING_ARGS = {
      heading: 'Testing decisions',
      overview: 'Tidying modules. This round: tests.',
      questions: [question({ title: 'Tests', question: 'What covers it?' })],
    };
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    const hostB1 = new AbortController();
    const b1 = session.askRound(SCOPE_ARGS, null, hostB1.signal);
    const placement = session.askRound(PLACEMENT_ARGS, null, live());
    const hostB2 = new AbortController();
    const b2 = session.askRound(SCOPE_ARGS, null, hostB2.signal);
    const testing = session.askRound(TESTING_ARGS, null, live());
    const testingCall = watch(testing);

    hostB1.abort();
    hostB2.abort();
    await expect(b1).rejects.toThrow('ask_round was cancelled before it ran.');
    await expect(b2).rejects.toThrow('ask_round was cancelled before it ran.');
    presenter.submit(naming.roundId, oneAnswer({ choice: 1 }));
    expect((await first).outcome).toBe('submitted');
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().round).toEqual(parseRound(PLACEMENT_ARGS));
    expect(testingCall.settled).toBe(false);
    expect(savedFile(naming.roundId).returned).toBe(true);
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 2 }));
    expect((await placement).answers[0].choice).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(3);
    expect(presenter.latest().round).toEqual(parseRound(TESTING_ARGS));
    presenter.submit(presenter.latest().roundId, oneAnswer({ choice: 1 }));
    const answered = await testing;
    expect(answered.outcome).toBe('submitted');
    expect(answered.earlier_heading).toBeUndefined();
  });

  it('makes a re-send wait when two queued calls were refused behind one open draft', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    const placement = session.askRound(PLACEMENT_ARGS, null, live());
    const scope = session.askRound(SCOPE_ARGS, null, live());
    await expireDeadline();
    expect((await first).outcome).toBe('draft');
    expect((await placement).summary).toContain('was not shown');
    expect((await scope).summary).toContain('was not shown');

    const resent = session.askRound(PLACEMENT_ARGS, null, live());
    const settled = watch(resent);
    await vi.advanceTimersByTimeAsync(1000);

    expect(settled.settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.roundId).outcome).toBe('open');
    await expireDeadline();
    expect((await resent).summary).toContain('was not shown');
    expect(presenter.closed).toEqual([]);
  });

  it('rejects and opens nothing once its session ends', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const queued = session.askRound(PLACEMENT_ARGS, null, live());
    const settled = watch(first);

    session.end();
    await expect(queued).rejects.toThrow(
      'The session ended before this ask_round ran.',
    );

    expect(settled.settled).toBe(true);
    expect(presenter.shown).toHaveLength(1);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });

  it('rejects and opens nothing once its signal aborts while queued', async () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    const host = new AbortController();
    const queued = session.askRound(PLACEMENT_ARGS, null, host.signal);

    host.abort();
    await expect(queued).rejects.toThrow(
      'ask_round was cancelled before it ran.',
    );

    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });

  it('rejects a call whose signal is already aborted and replaces nothing', async () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    await expireDeadline();
    const host = new AbortController();
    host.abort();

    await expect(
      session.askRound(PLACEMENT_ARGS, null, host.signal),
    ).rejects.toThrow('ask_round was cancelled before it ran.');

    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });
});

describe('saved rounds from an earlier app run', () => {
  it('pre-fills a re-sent round from its saved draft', () => {
    saveEarlier(NAMING_ARGS, 'open', HALF_BODY);

    void startSession().askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();

    expect(shown.draft).toEqual(HALF_BODY);
    expect(savedFile(shown.roundId).body).toEqual(HALF_BODY);
  });

  it('pre-fills a fresh round from an older round already returned', () => {
    const earlier = saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);
    store.markReturned(earlier);

    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().roundId).not.toBe(earlier.id);
    expect(presenter.latest().draft).toEqual(HALF_BODY);
  });

  it('returns the saved finished round to collect_last_round and marks it returned', async () => {
    const earlier = saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);
    const session = startSession();

    const first = await session.collectLastRound(true, live());
    const second = await session.collectLastRound(true, live());

    expect(first.outcome).toBe('submitted');
    expect(first.answers[0]).toMatchObject({ choice: 2, what: 'half done' });
    expect(second).toEqual(first);
    expect(newestSaved(earlier.fingerprint).returned).toBe(true);
  });

  it('hands back the saved finished round to a new round', async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);

    const handed = await startSession().askRound(PLACEMENT_ARGS, null, live());

    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(presenter.shown).toEqual([]);
  });

  it('returns the saved finished round plainly when that round is re-sent', async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);

    const payload = await startSession().askRound(NAMING_ARGS, null, live());

    expect(payload.outcome).toBe('submitted');
    expect(payload).not.toHaveProperty('earlier_heading');
    expect(presenter.shown).toEqual([]);
  });

  it("never returns another session's saved round", async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY, {
      sessionId: 'session-2',
      projectDir: '/work/wigley',
    });

    expect((await startSession().collectLastRound(true, live())).outcome).toBe(
      'no_round',
    );
  });

  it('hands back nothing without a session id or a project folder', async () => {
    const nobody = { sessionId: null, projectDir: null };
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY, nobody);

    const pending = startSession(nobody).askRound(PLACEMENT_ARGS, null, live());
    await expireDeadline();
    const payload = await pending;

    expect(payload.outcome).toBe('draft');
    expect(payload).not.toHaveProperty('earlier_heading');
    expect(presenter.shown).toHaveLength(1);
  });

  it('marks a saved round that no longer parses as returned and skips it', async () => {
    const record = store.create(
      SESSION,
      'unparseable',
      { heading: '', questions: [] },
      HALF_BODY,
      null,
    );
    store.finish(record, 'submitted', HALF_BODY);

    const payload = await startSession().collectLastRound(true, live());

    expect(payload.outcome).toBe('no_round');
    expect(newestSaved('unparseable').returned).toBe(true);
  });
});

describe('pre-fill', () => {
  it("drops a finished round's Don't ask presses", () => {
    const pressed = oneAnswer({
      choice: 2,
      what: 'half done',
      dont_ask: true,
      dont_ask_reason: 'obvious',
    });
    store.markReturned(saveEarlier(NAMING_ARGS, 'submitted', pressed));

    void startSession().askRound(NAMING_ARGS, null, live());

    expect(latestDraft().answers).toEqual([
      answer({ choice: 2, what: 'half done' }),
    ]);
  });

  it("keeps an open draft's Don't ask presses", () => {
    const pressed = oneAnswer({
      choice: 2,
      dont_ask: true,
      dont_ask_reason: 'obvious',
    });
    saveEarlier(NAMING_ARGS, 'open', pressed);

    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(pressed);
  });

  it('restores the choice number kept on a not-applicable answer', () => {
    const kept = oneAnswer({ choice: 2, not_applicable: true });
    saveEarlier(NAMING_ARGS, 'open', kept);

    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(kept);
  });
});

describe("the user's answers on disk", () => {
  it('saves drafts as they arrive, and marks the file returned only once a reply carries it', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;

    presenter.draft(shown.roundId, oneAnswer({ choice: 1 }, 'half'));
    expect(savedFile(shown.roundId)).toMatchObject({
      outcome: 'open',
      body: { note: 'half' },
    });

    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }, 'done'));
    expect(savedFile(shown.roundId)).toMatchObject({
      outcome: 'submitted',
      returned: false,
      body: { note: 'done' },
    });

    await session.collectLastRound(true, live());
    expect(savedFile(shown.roundId).returned).toBe(true);
  });

  it('keeps the first finish in both the answer and the file', async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();

    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }, 'submit'));
    presenter.cancel(shown.roundId, oneAnswer({ choice: 1 }, 'cancel'));
    const payload = await pending;

    expect(payload).toMatchObject({ outcome: 'submitted', note: 'submit' });
    expect(savedFile(shown.roundId)).toMatchObject({
      outcome: 'submitted',
      body: { note: 'submit' },
    });
    expect(presenter.closed).toEqual([shown.roundId]);
  });

  it("throws a draft's failed write to the caller and keeps the draft for the reply", async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    vi.spyOn(store, 'saveBody').mockImplementation(() => {
      throw new Error('could not save round r: EACCES');
    });

    expect(() =>
      presenter.draft(shown.roundId, oneAnswer({ choice: 2 }, 'half')),
    ).toThrow('could not save round r: EACCES');
    await expireDeadline();

    expect(await pending).toMatchObject({ outcome: 'draft', note: 'half' });
  });

  it('drops a draft that arrives after the finish', async () => {
    const pending = startSession().askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }, 'done'));
    await pending;

    presenter.draft(shown.roundId, oneAnswer({ choice: 2 }, 'late'));

    expect(savedFile(shown.roundId)).toMatchObject({
      outcome: 'submitted',
      body: { note: 'done' },
    });
  });
});

describe('a session that ends', () => {
  it('closes its open round in the window and keeps its answers', async () => {
    const session = startSession();
    const waiting = session.askRound(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    presenter.draft(shown.roundId, oneAnswer({ choice: 2 }, 'half'));

    session.end();

    expect(presenter.closed).toEqual([shown.roundId]);
    expect((await waiting).outcome).toBe('draft');
    expect(savedFile(shown.roundId)).toMatchObject({
      outcome: 'open',
      body: { note: 'half' },
    });
  });

  it('lets the next session re-send the round pre-filled', () => {
    const session = startSession();
    void session.askRound(NAMING_ARGS, null, live());
    presenter.draft(
      presenter.latest().roundId,
      oneAnswer({ choice: 2 }, 'half'),
    );
    session.end();

    void startSession().askRound(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(oneAnswer({ choice: 2 }, 'half'));
  });

  it('closes nothing when no round is open', () => {
    startSession().end();

    expect(presenter.closed).toEqual([]);
  });
});
