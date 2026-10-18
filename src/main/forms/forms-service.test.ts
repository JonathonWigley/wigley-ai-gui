import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnswerEntry,
  AnswersPayload,
  FormBody,
  FormsSession,
  SessionInfo,
} from '../../contracts/forms';
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
  }).startSession({ ...SESSION, ...info });
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

  it.each([0, -5])(
    'uses the default for a deadline of %d',
    async (deadlineSeconds) => {
      const pending = startSession({ deadlineSeconds }).askRound(
        NAMING_ARGS,
        null,
        live(),
      );
      const call = watch(pending);

      await expireDeadline();

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

  it('answers an aborted call with a draft and leaves the round open', async () => {
    const session = startSession();
    const controller = new AbortController();
    const first = session.askRound(NAMING_ARGS, null, controller.signal);
    const shown = presenter.latest();

    controller.abort();
    expect((await first).outcome).toBe('draft');

    const second = session.collectLastRound(true, live());
    presenter.submit(shown.roundId, oneAnswer({ choice: 1 }));
    expect((await second).outcome).toBe('submitted');
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

describe('a new round over an open draft', () => {
  it('closes the open draft and keeps its file', async () => {
    const session = startSession();
    const first = session.askRound(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    await first;

    void session.askRound(PLACEMENT_ARGS, null, live());

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.closed).toEqual([naming.roundId]);
    expect(newestSaved(fingerprint(parseRound(NAMING_ARGS))).id).toBe(
      naming.roundId,
    );
    expect(savedFile(naming.roundId).outcome).toBe('open');
  });

  it("answers a call still waiting on the replaced round with that round's draft", async () => {
    const session = startSession();
    const waiting = session.askRound(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().roundId, oneAnswer({ choice: 2 }));

    void session.askRound(PLACEMENT_ARGS, null, live());
    const payload = await waiting;

    expect(payload.outcome).toBe('draft');
    expect(payload.answers[0].choice).toBe(2);
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
