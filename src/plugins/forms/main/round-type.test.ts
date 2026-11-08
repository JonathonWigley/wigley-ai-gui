import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFormOwnerInfo } from '../../../contracts/agent-forms';
import { NO_FORM_WAKE } from '../../../shared/agent-forms/chat-wake';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import {
  type AgentFormStore,
  createFolderFormStore,
  type SavedAgentForm,
  type SavedOutcome,
} from '../../../shared/agent-forms/form-store';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { ScriptedFormPresenter } from '../../../shared/agent-forms/scripted-presenter';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  AnswerEntry,
  AnswersPayload,
  FormBody,
  FormsSession,
  Round,
} from '../contract';
import { fingerprint, parseRound } from './round';
import { RoundError } from './round-error';
import { roundType, withKnownLayouts } from './round-type';

const DEFAULT_DEADLINE_SECONDS = 240;

const SESSION: AgentFormOwnerInfo = {
  sessionId: 'session-1',
  projectDir: '/work/wigley',
  deadlineSeconds: null,
};

function question(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Naming',
    summary: 'Which name should win?',
    context: 'Two modules do the same thing under different names.',
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
    question({ title: 'Placement', summary: 'Where should it live?' }),
  ],
};

const FINDING_ARGS = {
  heading: 'Review findings',
  overview: 'Reviewing the cache. This round: one finding.',
  findings: [
    {
      title: 'Stale cache',
      origin: 'caused',
      severity: 'important',
      impact: 'Users see stale data after a reload.',
      finding: 'The cache keeps entries after a reload.',
      proof: '- `cache.ts:40` never clears',
      choices: [
        { text: 'Fix it now', reason: 'It is one line.' },
        { text: 'Keep the cache', reason: 'Reloads are rare.' },
      ],
      recommend: 1,
      recommend_action: 'fix_now',
    },
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
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...entry,
  };
}

function oneAnswer(entry: Partial<AnswerEntry>, note = ''): FormBody {
  return {
    note,
    answers: [answer(entry)],
    finding_answers: [],
    notice_comments: [],
  };
}

const HALF_BODY = oneAnswer({ choice: 2, notes: 'half done' });

let roundsDir: string;
let nowMs: number;
let hexCount: number;
let presenter: ScriptedFormPresenter<Round, FormBody>;
let store: AgentFormStore;
// The layouts folder's names `withKnownLayouts` reads; a test may set its own.
let layoutNames: readonly string[];

function startSession(info: Partial<AgentFormOwnerInfo> = {}): FormsSession {
  return withKnownLayouts(
    createAgentFormService({
      type: roundType,
      presenter,
      store,
      wake: NO_FORM_WAKE,
      defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
      timers: globalTimers,
    }),
    () => layoutNames,
  ).startSession({ id: 'app-1', info: { ...SESSION, ...info } });
}

function live(): AbortSignal {
  return new AbortController().signal;
}

function savedFile(roundId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(roundsDir, `${roundId}.json`), 'utf8'),
  );
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
): SavedAgentForm {
  const record = store.create(
    SESSION,
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
  roundsDir = mkdtempSync(path.join(tmpdir(), 'wigley-round-type-'));
  nowMs = 1_000_000;
  hexCount = 0;
  presenter = new ScriptedFormPresenter();
  layoutNames = ['default'];
  store = createFolderFormStore({
    dir: roundsDir,
    clock: { now: () => nowMs },
    randomHex: () => (++hexCount).toString(16).padStart(8, '0'),
    paths: posixPaths,
    log: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(roundsDir, { recursive: true, force: true });
});

describe('roundType', () => {
  it('notShownPayload names the blocking round', () => {
    const payload = roundType.notShownPayload(
      parseRound(PLACEMENT_ARGS),
      'Naming decisions',
    );

    expect(payload.summary).toContain("'Placement decisions'");
    expect(payload.summary).toContain("'Naming decisions'");
    expect(payload.next).toContain('ask_round');
    expect(payload.next).toContain('earlier_heading');
    expect(payload.earlier_heading).toBeUndefined();
    expect(payload.answers[0].status).toBe('untouched');
  });

  it('notShownPayload names another round when none blocks', () => {
    const payload = roundType.notShownPayload(parseRound(PLACEMENT_ARGS), null);

    expect(payload.summary).toContain(
      'another round is still open in the app.',
    );
  });
});

describe('open', () => {
  it('returns notices and their comments beside the answers', async () => {
    const pending = startSession().open(NOTICE_ARGS, null, live());
    presenter.submit(presenter.latest().formId, {
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
    const rejection = startSession().open(
      { heading: 'H', questions: [] },
      null,
      live(),
    );

    await expect(rejection).rejects.toBeInstanceOf(RoundError);
    expect(presenter.shown).toEqual([]);
  });
});

describe('layouts a round names', () => {
  it('fails ask_round naming a layout the folder lacks, showing nothing and writing no file', async () => {
    layoutNames = ['default', 'compact'];
    const args = {
      ...FINDING_ARGS,
      findings: [
        FINDING_ARGS.findings[0],
        { ...FINDING_ARGS.findings[0], title: 'Dense', layout: 'dense' },
      ],
    };

    const rejection = startSession().open(args, null, live());

    await expect(rejection).rejects.toBeInstanceOf(RoundError);
    expect(presenter.shown).toEqual([]);
    expect(readdirSync(roundsDir)).toEqual([]);
  });

  it('fails a round naming a layout the folder lacks before it queues behind an open round', async () => {
    layoutNames = ['default'];
    const session = startSession();
    const first = watch(session.open(NAMING_ARGS, null, live()));

    const rejection = session.open(
      { ...PLACEMENT_ARGS, layout: 'dense' },
      null,
      live(),
    );

    await expect(rejection).rejects.toBeInstanceOf(RoundError);
    expect(first.settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens a round whose layouts the folder holds', () => {
    layoutNames = ['default', 'compact'];

    void startSession().open(
      { ...NAMING_ARGS, layout: 'compact' },
      null,
      live(),
    );

    expect(presenter.latest().form.layout).toBe('compact');
  });

  it('re-attaches a re-send that differs only in layout, keeping the layouts it opened with', async () => {
    layoutNames = ['default', 'compact'];
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;

    const second = session.open(
      { ...NAMING_ARGS, layout: 'compact' },
      null,
      live(),
    );
    presenter.submit(shown.formId, oneAnswer({ choice: 1 }));

    expect((await second).outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.latest().form.layout).toBeNull();
  });

  it('returns the answers of a saved round whose layout left the folder', async () => {
    saveEarlier({ ...NAMING_ARGS, layout: 'gone' }, 'submitted', HALF_BODY);

    const payload = await startSession().collect(true, live());

    expect(payload.outcome).toBe('submitted');
  });
});

describe('saved rounds from an earlier app run', () => {
  // A finding saved before findings carried an origin.
  const OLD_SHAPE_ARGS = {
    heading: 'Old review',
    overview: 'Reviewing the cache. This round: one finding.',
    findings: [{ ...FINDING_ARGS.findings[0], origin: undefined }],
  };

  it('reports a saved round that no longer parses to collect_last_round and leaves it unreturned', async () => {
    const record = store.create(
      SESSION,
      'unparseable',
      OLD_SHAPE_ARGS,
      HALF_BODY,
      null,
    );
    store.finish(record, 'submitted', HALF_BODY);
    const session = startSession();

    const failed = session.collect(true, live());

    await expect(failed).rejects.toThrow('Old review');
    await expect(failed).rejects.toThrow(`${record.id}.json`);
    await expect(failed).rejects.toThrow('origin');
    expect(savedFile(record.id).returned).toBe(false);
  });
});

describe('pre-fill', () => {
  it("drops a finished round's Don't ask presses", () => {
    const pressed = oneAnswer({
      choice: 2,
      notes: 'half done',
      dont_ask: true,
      dont_ask_reason: 'obvious',
    });
    store.markReturned(saveEarlier(NAMING_ARGS, 'submitted', pressed));

    void startSession().open(NAMING_ARGS, null, live());

    expect(latestDraft().answers).toEqual([
      answer({ choice: 2, notes: 'half done' }),
    ]);
  });

  it("drops a finished round's Don't ask presses on finding answers", () => {
    const pressed: FormBody = {
      note: '',
      answers: [],
      finding_answers: [
        {
          ...answer({
            choice: 2,
            notes: 'half done',
            dont_ask: true,
            dont_ask_reason: 'obvious',
          }),
          action: 'follow_up',
        },
      ],
      notice_comments: [],
    };
    store.markReturned(saveEarlier(FINDING_ARGS, 'submitted', pressed));

    void startSession().open(FINDING_ARGS, null, live());

    expect(latestDraft().finding_answers).toEqual([
      { ...answer({ choice: 2, notes: 'half done' }), action: 'follow_up' },
    ]);
  });

  it("pre-fills an old file's what and why as joined notes", () => {
    const oldBody = {
      note: '',
      answers: [{ index: 1, choice: 2, what: 'half', why: 'done' }],
      notice_comments: [],
    };
    saveEarlier(NAMING_ARGS, 'open', oldBody as unknown as FormBody);

    void startSession().open(NAMING_ARGS, null, live());

    const [entry] = latestDraft().answers;
    expect(entry.notes).toBe('half\n\ndone');
    expect(entry).not.toHaveProperty('what');
  });

  it("keeps an open draft's Don't ask presses", () => {
    const pressed = oneAnswer({
      choice: 2,
      dont_ask: true,
      dont_ask_reason: 'obvious',
    });
    saveEarlier(NAMING_ARGS, 'open', pressed);

    void startSession().open(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(pressed);
  });

  it('restores the choice number kept on a not-applicable answer', () => {
    const kept = oneAnswer({ choice: 2, not_applicable: true });
    saveEarlier(NAMING_ARGS, 'open', kept);

    void startSession().open(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(kept);
  });
});
