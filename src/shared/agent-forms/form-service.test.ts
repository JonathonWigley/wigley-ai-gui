import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentFormAutoAnswer,
  AgentFormOwnerInfo,
  AgentFormSession,
  AgentFormWake,
} from '../../contracts/agent-forms';
import type { Timers } from '../../contracts/ambient';
import { posixPaths } from '../paths/posix-paths';
import { createAgentFormService } from './form-service';
import {
  type AgentFormOwnerRef,
  type AgentFormStore,
  createFolderFormStore,
  type SavedAgentForm,
  type SavedOutcome,
} from './form-store';
import { globalTimers } from './global-timers.test-support';
import { ScriptedFormPresenter } from './scripted-presenter';
import {
  TEST_FORM_ERROR_NAME,
  TEST_FORM_TYPE,
  type TestBody,
  type TestForm,
  type TestPayload,
} from './test-form-type';

const DEFAULT_DEADLINE_SECONDS = 240;

const SESSION: AgentFormOwnerInfo = {
  sessionId: 'session-1',
  projectDir: '/work/wigley',
};

const NAMING_ARGS = {
  heading: 'Naming decisions',
  items: ['module_a or module_b'],
};

const PLACEMENT_ARGS = {
  heading: 'Placement decisions',
  items: ['where it lives'],
};

function body(note: string): TestBody {
  return { note };
}

const HALF_BODY = body('half done');

function parse(args: unknown): TestForm {
  return TEST_FORM_TYPE.parse(args);
}

function fingerprintOf(args: unknown): string {
  return TEST_FORM_TYPE.fingerprint(parse(args));
}

let formsDir: string;
let nowMs: number;
let hexCount: number;
let presenter: ScriptedFormPresenter<TestForm, TestBody>;
let store: AgentFormStore;
// Each `(sessionId, text)` the service woke its session with.
let wakes: [string, string][];

const wake: AgentFormWake = {
  formFinishedUnheard: (sessionId, text) => {
    wakes.push([sessionId, text]);
  },
};

function newService(timers: Timers = globalTimers) {
  return createAgentFormService({
    type: TEST_FORM_TYPE,
    presenter,
    store,
    wake,
    defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
    timers,
  });
}

function startSession(
  info: Partial<AgentFormOwnerInfo> = {},
): AgentFormSession<TestPayload> {
  return newService().startSession({
    id: 'app-1',
    info: { ...SESSION, ...info },
  });
}

function live(): AbortSignal {
  return new AbortController().signal;
}

function savedFile(formId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(formsDir, `${formId}.json`), 'utf8'),
  );
}

// The newest saved file for a form, which the test expects to exist.
function newestSaved(formFingerprint: string): SavedAgentForm {
  const record = store.newestFor(formFingerprint);
  expect(record).not.toBeNull();
  return record as SavedAgentForm;
}

// The draft the latest shown form opened with, which the test expects to exist.
function latestDraft(): TestBody {
  const { draft } = presenter.latest();
  expect(draft).not.toBeNull();
  return draft as TestBody;
}

// A form an earlier app run left on disk.
function saveEarlier(
  args: unknown,
  outcome: SavedOutcome,
  saved: TestBody,
  owner: AgentFormOwnerRef = SESSION,
): SavedAgentForm {
  const record = store.create(owner, fingerprintOf(args), args, saved, null);
  if (outcome !== 'open') {
    store.finish(record, outcome, saved);
  }
  return record;
}

// Runs out the soft deadline of every call waiting now.
async function expireDeadline(seconds = DEFAULT_DEADLINE_SECONDS) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

// Tracks whether a call has answered yet.
function watch(pending: Promise<TestPayload>): { settled: boolean } {
  const state = { settled: false };
  const markSettled = () => {
    state.settled = true;
  };
  void pending.then(markSettled, markSettled);
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  formsDir = mkdtempSync(path.join(tmpdir(), 'wigley-form-service-'));
  nowMs = 1_000_000;
  hexCount = 0;
  wakes = [];
  presenter = new ScriptedFormPresenter();
  store = createFolderFormStore({
    dir: formsDir,
    clock: { now: () => nowMs },
    randomHex: () => (++hexCount).toString(16).padStart(8, '0'),
    paths: posixPaths,
    log: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(formsDir, { recursive: true, force: true });
});

describe('open', () => {
  it('returns the submitted answers as the payload', async () => {
    const session = startSession();

    const pending = session.open(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('choice 1'));

    expect(await pending).toEqual(
      TEST_FORM_TYPE.payload(parse(NAMING_ARGS), 'submitted', body('choice 1')),
    );
  });

  it('shows a new form for its session, labelled with its project folder and no draft', () => {
    void startSession().open(NAMING_ARGS, null, live());

    expect(presenter.latest()).toMatchObject({
      sessionId: 'app-1',
      label: 'wigley · Naming decisions',
      form: parse(NAMING_ARGS),
      draft: null,
    });
  });

  it('labels a form with its heading alone when the session has no project', () => {
    void startSession({ projectDir: null }).open(NAMING_ARGS, null, live());

    expect(presenter.latest().label).toBe('Naming decisions');
  });

  it("saves a new form's file with its calling tool use id, or null without one", () => {
    const session = startSession();
    void session.open(NAMING_ARGS, 'toolu_first', live());
    const first = presenter.latest().formId;
    void startSession().open(PLACEMENT_ARGS, null, live());
    const second = presenter.latest().formId;

    expect(savedFile(first).tool_use_id).toBe('toolu_first');
    expect(savedFile(second).tool_use_id).toBeNull();
  });

  it("opens a second call's form only once the user finishes the first", async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const second = session.open(PLACEMENT_ARGS, null, live());
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(1);
    const naming = presenter.latest();

    presenter.submit(naming.formId, body('choice 1'));
    expect(await first).toEqual(
      TEST_FORM_TYPE.payload(parse(NAMING_ARGS), 'submitted', body('choice 1')),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
    presenter.submit(presenter.latest().formId, body('choice 2'));
    expect((await second).note).toBe('choice 2');
  });

  it('runs the next call after one that rejected', async () => {
    const session = startSession();
    const malformed = session.open({ heading: 'H' }, null, live());
    void session.open(NAMING_ARGS, null, live());

    await expect(malformed).rejects.toMatchObject({
      name: TEST_FORM_ERROR_NAME,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(1);
  });

  it('closes the form in the window once the user cancels it', async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    presenter.cancel(shown.formId, body(''));

    expect((await pending).outcome).toBe('cancelled');
    expect(presenter.closed).toEqual([shown.formId]);
  });

  it.each([
    { typed: 'half', note: 'half' },
    { typed: null, note: '' },
  ])(
    'cancel returns cancelled to the waiting call with the latest body: $typed',
    async ({ typed, note }) => {
      const pending = startSession().open(NAMING_ARGS, null, live());
      const shown = presenter.latest();
      if (typed !== null) {
        presenter.draft(shown.formId, body(typed));
      }

      presenter.cancelHold(shown.formId);
      presenter.cancelHold(shown.formId);
      const payload = await pending;

      expect(payload.outcome).toBe('cancelled');
      expect(payload.note).toBe(note);
      expect(presenter.closed).toEqual([shown.formId]);
    },
  );
});

describe('the soft deadline', () => {
  it('hands back a draft at the default deadline and leaves the form open', async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    const call = watch(pending);

    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000 - 1);
    expect(call.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const payload = await pending;
    expect(payload.outcome).toBe('draft');
    expect(presenter.closed).toEqual([]);
  });

  it("waits as long as the host record's deadline says", async () => {
    const pending = startSession({ host: { deadline_seconds: 300 } }).open(
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

  it.each([0, -5, '300', null, Number.NaN])(
    'uses the default for a host deadline of %s',
    async (deadlineSeconds) => {
      const pending = startSession({
        host: { deadline_seconds: deadlineSeconds },
      }).open(NAMING_ARGS, null, live());
      const call = watch(pending);

      await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000 - 1);
      expect(call.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(call.settled).toBe(true);
      expect((await pending).outcome).toBe('draft');
    },
  );

  it('waits the longest timer delay for a host deadline past the 32-bit limit', async () => {
    const longestDelayMs = 2147483647;
    const pending = startSession({
      host: { deadline_seconds: 2_147_484 },
    }).open(NAMING_ARGS, null, live());
    const call = watch(pending);

    await expireDeadline();
    expect(call.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(
      longestDelayMs - DEFAULT_DEADLINE_SECONDS * 1000 - 1,
    );
    expect(call.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect((await pending).outcome).toBe('draft');
  });

  it('runs its deadline through the timers it is given', async () => {
    const runs: { run: () => void; ms: number }[] = [];
    const timers: Timers = {
      set(run, ms) {
        runs.push({ run, ms });
        return runs.length;
      },
      clear: () => {},
    };
    const pending = newService(timers)
      .startSession({ id: 'app-1', info: SESSION })
      .open(NAMING_ARGS, null, live());

    expect(runs.map(({ ms }) => ms)).toEqual([DEFAULT_DEADLINE_SECONDS * 1000]);
    runs[0].run();

    expect((await pending).outcome).toBe('draft');
  });

  it('leaves no timer pending once a call settles', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const queued = session.open(PLACEMENT_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('choice 1'));
    await first;
    await vi.advanceTimersByTimeAsync(0);
    presenter.submit(presenter.latest().formId, body('choice 2'));

    await queued;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('carries the latest draft the user saved', async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().formId, body('w'));

    await expireDeadline();
    const payload = await pending;

    expect(payload.outcome).toBe('draft');
    expect(payload.note).toBe('w');
  });
});

describe('collect', () => {
  it('returns no_form when nothing was sent', async () => {
    const payload = await startSession().collect(true, live());

    expect(payload.outcome).toBe('no_form');
  });

  it('re-attaches to a draft without showing the form again', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    expect((await first).outcome).toBe('draft');

    const second = session.collect(true, live());
    presenter.submit(shown.formId, body('choice 1'));

    expect((await second).outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(1);
  });

  it('wakes two calls waiting on one form with the same answers, marking the file returned', async () => {
    const session = startSession();
    const asking = session.open(NAMING_ARGS, null, live());
    const collecting = session.collect(true, live());
    const shown = presenter.latest();

    presenter.submit(shown.formId, body('choice 1'));
    const [fromAsk, fromCollect] = await Promise.all([asking, collecting]);

    expect(fromAsk.outcome).toBe('submitted');
    expect(fromCollect.outcome).toBe('submitted');
    expect(fromCollect.note).toEqual(fromAsk.note);
    expect(newestSaved(fingerprintOf(NAMING_ARGS)).returned).toBe(true);
    expect(presenter.closed).toEqual([shown.formId]);
  });

  it('replays the last submitted answers', async () => {
    const session = startSession();
    const pending = session.open(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('choice 2'));
    const first = await pending;

    expect(await session.collect(true, live())).toEqual(first);
    expect(presenter.shown).toHaveLength(1);
  });

  it('with wait false returns the current draft at once', async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().formId, body('still checking'));

    const payload = await session.collect(false, live());

    expect(payload.outcome).toBe('draft');
    expect(payload.note).toBe('still checking');
  });

  it('with wait false reports a form the user submitted after its draft', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.submit(shown.formId, body('done'));

    const payload = await session.collect(false, live());

    expect(payload.outcome).toBe('submitted');
    expect(payload.note).toBe('done');
  });

  it('answers an aborted call with a draft', async () => {
    const session = startSession();
    const controller = new AbortController();
    const first = session.open(NAMING_ARGS, null, controller.signal);
    presenter.draft(presenter.latest().formId, body('choice 2'));

    controller.abort();
    const payload = await first;

    expect(payload.outcome).toBe('draft');
    expect(payload.note).toBe('choice 2');
  });
});

describe('a call the host cancels', () => {
  it('closes its form in the window and keeps the draft in the open file', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    presenter.draft(naming.formId, body('half'));

    host.abort();
    await asking;

    expect(presenter.closed).toEqual([naming.formId]);
    expect(savedFile(naming.formId)).toMatchObject({
      outcome: 'open',
      body: { note: 'half' },
    });
  });

  it("shows the session's next form at once", async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);

    host.abort();
    await asking;
    void session.open(PLACEMENT_ARGS, null, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
  });

  it('opens a different form queued behind it at once', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    void session.open(PLACEMENT_ARGS, null, live());

    host.abort();
    await asking;
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.closed).toEqual([naming.formId]);
    expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
  });

  it('keeps the form open for a re-send of it queued behind the cancelled call', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const resent = session.open(NAMING_ARGS, null, live());

    host.abort();
    await asking;
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.closed).toEqual([]);
    expect(presenter.shown).toHaveLength(1);
    presenter.submit(naming.formId, body('choice 1'));
    expect((await resent).outcome).toBe('submitted');
  });

  it('stops counting a queued re-send the host cancels, so cancelling the call ahead closes the form', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const resendHost = new AbortController();
    const resent = session.open(NAMING_ARGS, null, resendHost.signal);

    resendHost.abort();
    await expect(resent).rejects.toThrow(/open_form/);
    expect(presenter.closed).toEqual([]);
    host.abort();
    await asking;

    expect(presenter.closed).toEqual([naming.formId]);
  });

  it('closes a form left open after its deadline draft once a collect on it is cancelled', async () => {
    const session = startSession();
    const asking = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    await asking;
    const host = new AbortController();
    const collecting = session.collect(true, host.signal);

    host.abort();
    await collecting;

    expect(presenter.closed).toEqual([naming.formId]);
  });

  it('answers a collect with no_form and shows nothing new', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    presenter.draft(presenter.latest().formId, body('choice 2'));
    host.abort();
    await asking;

    const payload = await session.collect(true, live());

    expect(payload.outcome).toBe('no_form');
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens the form pre-filled when it is sent again', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    presenter.draft(presenter.latest().formId, body('choice 2'));
    host.abort();
    await asking;

    void session.open(NAMING_ARGS, null, live());

    expect(presenter.shown).toHaveLength(2);
    expect(latestDraft()).toEqual(body('choice 2'));
  });

  it('keeps the form open while another call still waits on it', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    const collecting = session.collect(true, live());

    host.abort();
    await asking;

    expect(presenter.closed).toEqual([]);
    presenter.submit(naming.formId, body('choice 1'));
    expect((await collecting).outcome).toBe('submitted');
  });

  it('returns and marks returned a form the user finished in the same tick', async () => {
    const session = startSession();
    const host = new AbortController();
    const asking = session.open(NAMING_ARGS, null, host.signal);
    const naming = presenter.latest();
    presenter.submit(naming.formId, body('choice 1'));

    host.abort();

    expect((await asking).outcome).toBe('submitted');
    expect(savedFile(naming.formId).returned).toBe(true);
  });

  it('leaves the open form be when a call queued behind it is cancelled', async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    const host = new AbortController();
    const queued = session.open(PLACEMENT_ARGS, null, host.signal);

    host.abort();
    await expect(queued).rejects.toThrow(/open_form/);

    expect(presenter.closed).toEqual([]);
  });

  it("leaves the form open when a queued re-send's own deadline wakes it", async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await vi.advanceTimersByTimeAsync(100_000);
    const resent = session.open(NAMING_ARGS, null, live());

    await expireDeadline();
    expect((await resent).outcome).toBe('draft');

    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.formId).outcome).toBe('open');
  });
});

describe('re-sending a form', () => {
  it('re-attaches to the open form under a reworded heading, keeping its first tool use id', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, 'toolu_first', live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;

    const second = session.open(
      { ...NAMING_ARGS, heading: 'Reworded heading' },
      'toolu_resent',
      live(),
    );
    presenter.submit(shown.formId, body('choice 1'));

    expect((await second).outcome).toBe('submitted');
    expect(presenter.shown).toHaveLength(1);
    expect(savedFile(shown.formId).tool_use_id).toBe('toolu_first');
  });

  it('replays the form just submitted', async () => {
    const session = startSession();
    const pending = session.open(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('choice 2'));
    const first = await pending;

    expect(await session.open(NAMING_ARGS, null, live())).toEqual(first);
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens a fresh form pre-filled from the form just cancelled', async () => {
    const session = startSession();
    const cancelledBody = body('stop here');
    const pending = session.open(NAMING_ARGS, null, live());
    const first = presenter.latest();
    presenter.cancel(first.formId, cancelledBody);
    await pending;

    void session.open(NAMING_ARGS, null, live());

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().formId).not.toBe(first.formId);
    expect(presenter.latest().draft).toEqual(body('finished: stop here'));
  });
});

describe('hand-back', () => {
  async function submitAfterDraft(
    session: AgentFormSession<TestPayload>,
    note: string,
  ) {
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.submit(shown.formId, body(note));
    return shown;
  }

  it('hands back an earlier form submitted after its draft, and opens nothing', async () => {
    const session = startSession();
    const naming = await submitAfterDraft(session, 'choice 2');

    const handed = await session.open(PLACEMENT_ARGS, null, live());

    expect(handed.outcome).toBe('submitted');
    expect(handed.note).toBe('choice 2');
    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([naming.formId]);
  });

  it('opens the new form when it is sent again after the hand-back', async () => {
    const session = startSession();
    await submitAfterDraft(session, 'choice 2');
    await session.open(PLACEMENT_ARGS, null, live());

    const opened = session.open(PLACEMENT_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('choice 1'));
    const payload = await opened;

    expect(presenter.shown).toHaveLength(2);
    expect(payload.note).toBe('choice 1');
    expect(payload).not.toHaveProperty('earlier_heading');
  });

  it('replays the hand-back to collect_last_form', async () => {
    const session = startSession();
    await submitAfterDraft(session, 'choice 2');
    const handed = await session.open(PLACEMENT_ARGS, null, live());

    const replayed = await session.collect(true, live());

    expect(replayed).toEqual(handed);
    expect(replayed.earlier_heading).toBe('Naming decisions');
  });

  it('hands back a cancelled earlier form with its note', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;
    presenter.cancel(shown.formId, body('stop here'));

    const handed = await session.open(PLACEMENT_ARGS, null, live());

    expect(handed.outcome).toBe('cancelled');
    expect(handed.note).toBe('stop here');
    expect(presenter.shown).toHaveLength(1);
  });
});

describe('the wake', () => {
  const SUBMITTED_TEXT =
    'The user submitted the form "Naming decisions" in the forms app. Call collect_last_form for its answers.';
  const CANCELLED_TEXT =
    'The user cancelled the form "Naming decisions" in the forms app. Call collect_last_form for its answers.';

  // The naming form left open after its only call returned a draft.
  async function openPastDraft(session: AgentFormSession<TestPayload>) {
    const first = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    expect((await first).outcome).toBe('draft');
    return naming.formId;
  }

  it.each<{
    case: string;
    finishWithCallsAround: (
      session: AgentFormSession<TestPayload>,
    ) => Promise<void>;
    expected: [string, string][];
  }>([
    {
      case: 'submitted after its only call returned a draft',
      finishWithCallsAround: async (session) => {
        const formId = await openPastDraft(session);
        presenter.submit(formId, body('choice 1'));
      },
      expected: [['app-1', SUBMITTED_TEXT]],
    },
    {
      case: 'submitted while its open call waits',
      finishWithCallsAround: async (session) => {
        void session.open(NAMING_ARGS, null, live());
        presenter.submit(presenter.latest().formId, body('choice 1'));
      },
      expected: [],
    },
    {
      case: 'submitted while a collect call waits',
      finishWithCallsAround: async (session) => {
        const formId = await openPastDraft(session);
        void session.collect(true, live());
        presenter.submit(formId, body('choice 1'));
      },
      expected: [],
    },
    {
      case: 'submitted with a re-send of it queued',
      finishWithCallsAround: async (session) => {
        void session.open(NAMING_ARGS, null, live());
        const formId = presenter.latest().formId;
        void session.open(NAMING_ARGS, null, live());
        presenter.submit(formId, body('choice 1'));
      },
      expected: [],
    },
    {
      case: 'submitted with a call for another form queued',
      finishWithCallsAround: async (session) => {
        const formId = await openPastDraft(session);
        void session.open(PLACEMENT_ARGS, null, live());
        presenter.submit(formId, body('choice 1'));
      },
      expected: [],
    },
    {
      case: 'cancelled after its only call returned a draft',
      finishWithCallsAround: async (session) => {
        const formId = await openPastDraft(session);
        presenter.cancel(formId, body('stop here'));
      },
      expected: [['app-1', CANCELLED_TEXT]],
    },
    {
      case: "cancelled by its session's close after its only call returned a draft",
      finishWithCallsAround: async (session) => {
        const formId = await openPastDraft(session);
        presenter.cancelHold(formId);
      },
      expected: [],
    },
  ])(
    'wakes the session only when no call will return the form: $case',
    async ({ finishWithCallsAround, expected }) => {
      await finishWithCallsAround(startSession());

      expect(wakes).toEqual(expected);
    },
  );
});

describe('a call made while another form is open', () => {
  const PLACEMENT_FINGERPRINT = fingerprintOf(PLACEMENT_ARGS);
  const SCOPE_ARGS = {
    heading: 'Scope decisions',
    items: ['what it covers'],
  };

  // A naming form left open past its only call's deadline draft.
  async function leaveOpenDraft(session: AgentFormSession<TestPayload>) {
    const first = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    await expireDeadline();
    expect((await first).outcome).toBe('draft');
    return naming;
  }

  // A naming form left open past its first call's deadline draft, and a
  // placement call queued behind it 100 s after the first.
  async function queueBehindOpenDraft(session: AgentFormSession<TestPayload>) {
    const first = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    presenter.draft(naming.formId, body('choice 2'));
    await vi.advanceTimersByTimeAsync(100_000);
    const queued = session.open(PLACEMENT_ARGS, null, live());
    await expireDeadline(DEFAULT_DEADLINE_SECONDS - 100);
    return { firstDraft: await first, naming, queued };
  }

  it("keeps waiting past the first call's deadline draft while the form is still open", async () => {
    const session = startSession();
    const { firstDraft, naming, queued } = await queueBehindOpenDraft(session);

    expect(firstDraft.outcome).toBe('draft');
    expect(firstDraft.note).toBe('choice 2');
    expect(watch(queued).settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.formId).outcome).toBe('open');
  });

  it('returns a draft at its own deadline without opening its form or replacing the open one', async () => {
    const session = startSession();
    const { naming, queued } = await queueBehindOpenDraft(session);

    await expireDeadline(100);
    const payload = await queued;

    expect(payload).toEqual({
      outcome: 'draft',
      heading: 'Placement decisions',
      note: '',
      notShown: true,
      blockingHeading: 'Naming decisions',
    });
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
    const stillOpen = await session.collect(false, live());
    expect(stillOpen.outcome).toBe('draft');
    expect(stillOpen.heading).toBe('Naming decisions');
    expect(savedFile(naming.formId).outcome).toBe('open');
  });

  // The placement call's not-shown draft, returned at its own deadline.
  async function refuseBehindOpenDraft(session: AgentFormSession<TestPayload>) {
    const { naming, queued } = await queueBehindOpenDraft(session);
    await expireDeadline(100);
    const refused = await queued;
    expect(refused.notShown).toBe(true);
    return naming;
  }

  // Each way a placement call comes to wait behind the open naming form.
  const WAITING_CALLS: {
    call: string;
    waitBehind: (session: AgentFormSession<TestPayload>) => Promise<{
      naming: Awaited<ReturnType<typeof leaveOpenDraft>>;
      waiting: Promise<TestPayload>;
    }>;
  }[] = [
    {
      call: 'a queued call',
      waitBehind: async (session) => {
        const { naming, queued } = await queueBehindOpenDraft(session);
        return { naming, waiting: queued };
      },
    },
    {
      call: 'a re-send of a refused call',
      waitBehind: async (session) => ({
        naming: await refuseBehindOpenDraft(session),
        waiting: session.open(PLACEMENT_ARGS, null, live()),
      }),
    },
    {
      call: 'a fresh call',
      waitBehind: async (session) => ({
        naming: await leaveOpenDraft(session),
        waiting: session.open(PLACEMENT_ARGS, null, live()),
      }),
    },
  ];

  it.each(WAITING_CALLS)(
    'opens the form of $call once the user submits the open one',
    async ({ waitBehind }) => {
      const session = startSession();
      const { naming, waiting } = await waitBehind(session);

      presenter.submit(naming.formId, body('choice 1'));
      // Collected in the submit's own tick, before the woken call runs, so the
      // call opens its form instead of handing this one back.
      const collected = await session.collect(true, live());
      await vi.advanceTimersByTimeAsync(0);

      expect(collected.outcome).toBe('submitted');
      expect(presenter.shown).toHaveLength(2);
      expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
      presenter.submit(presenter.latest().formId, body('choice 2'));
      const answered = await waiting;
      expect(answered.outcome).toBe('submitted');
      expect(answered.earlier_heading).toBeUndefined();
      expect(answered.note).toBe('choice 2');
    },
  );

  it.each([
    { call: 'a re-send of a refused call', leaveOpen: refuseBehindOpenDraft },
    { call: 'a fresh call', leaveOpen: leaveOpenDraft },
  ])(
    'makes $call wait behind an open draft and return a not-shown draft at its deadline',
    async ({ leaveOpen }) => {
      const session = startSession();
      const naming = await leaveOpen(session);

      const waiting = session.open(PLACEMENT_ARGS, null, live());
      const settled = watch(waiting);
      await vi.advanceTimersByTimeAsync(1000);

      expect(settled.settled).toBe(false);
      expect(presenter.shown).toHaveLength(1);
      expect(presenter.closed).toEqual([]);
      expect(savedFile(naming.formId).outcome).toBe('open');
      await expireDeadline();
      const payload = await waiting;
      expect(payload.outcome).toBe('draft');
      expect(payload.notShown).toBe(true);
      expect(presenter.shown).toHaveLength(1);
      expect(presenter.closed).toEqual([]);
      expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
      expect(savedFile(naming.formId).outcome).toBe('open');
    },
  );

  it('hands back the open draft to a fresh call woken by its submit, then opens the fresh form on a re-send', async () => {
    const session = startSession();
    const naming = await leaveOpenDraft(session);
    const fresh = session.open(PLACEMENT_ARGS, null, live());

    presenter.submit(naming.formId, body('choice 1'));
    const handed = await fresh;

    expect(handed.outcome).toBe('submitted');
    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(presenter.shown).toHaveLength(1);
    expect(savedFile(naming.formId).returned).toBe(true);
    void session.open(PLACEMENT_ARGS, null, live());
    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
  });

  it('returns the open draft, not a not-shown draft, to a re-send of the open form whose deadline passes while queued', async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    const resent = session.open(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().formId, body('choice 2'));

    // Fires the open call's deadline and the re-send's in one step, so the
    // re-send's passes before the open call's turn ends.
    vi.advanceTimersByTime(DEFAULT_DEADLINE_SECONDS * 1000);
    const payload = await resent;

    expect(payload.outcome).toBe('draft');
    expect(payload).not.toHaveProperty('notShown');
    expect(payload.note).toBe('choice 2');
    expect(presenter.shown).toHaveLength(1);
  });

  it('opens at most one form when one submit wakes calls queued behind aborted ones', async () => {
    const TESTING_ARGS = {
      heading: 'Testing decisions',
      items: ['what covers it'],
    };
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    const hostB1 = new AbortController();
    const b1 = session.open(SCOPE_ARGS, null, hostB1.signal);
    const placement = session.open(PLACEMENT_ARGS, null, live());
    const hostB2 = new AbortController();
    const b2 = session.open(SCOPE_ARGS, null, hostB2.signal);
    const testing = session.open(TESTING_ARGS, null, live());
    const testingCall = watch(testing);

    hostB1.abort();
    hostB2.abort();
    await expect(b1).rejects.toThrow(/open_form/);
    await expect(b2).rejects.toThrow(/open_form/);
    presenter.submit(naming.formId, body('choice 1'));
    expect((await first).outcome).toBe('submitted');
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(2);
    expect(presenter.latest().form).toEqual(parse(PLACEMENT_ARGS));
    expect(testingCall.settled).toBe(false);
    expect(savedFile(naming.formId).returned).toBe(true);
    presenter.submit(presenter.latest().formId, body('choice 2'));
    expect((await placement).note).toBe('choice 2');
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.shown).toHaveLength(3);
    expect(presenter.latest().form).toEqual(parse(TESTING_ARGS));
    presenter.submit(presenter.latest().formId, body('choice 1'));
    const answered = await testing;
    expect(answered.outcome).toBe('submitted');
    expect(answered.earlier_heading).toBeUndefined();
  });

  it('makes a re-send wait when two queued calls were refused behind one open draft', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const naming = presenter.latest();
    const placement = session.open(PLACEMENT_ARGS, null, live());
    const scope = session.open(SCOPE_ARGS, null, live());
    await expireDeadline();
    expect((await first).outcome).toBe('draft');
    expect((await placement).notShown).toBe(true);
    expect((await scope).notShown).toBe(true);

    const resent = session.open(PLACEMENT_ARGS, null, live());
    const settled = watch(resent);
    await vi.advanceTimersByTimeAsync(1000);

    expect(settled.settled).toBe(false);
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(savedFile(naming.formId).outcome).toBe('open');
    await expireDeadline();
    expect((await resent).notShown).toBe(true);
    expect(presenter.closed).toEqual([]);
  });

  it('rejects and opens nothing once its session ends', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const queued = session.open(PLACEMENT_ARGS, null, live());
    const settled = watch(first);

    session.end();
    await expect(queued).rejects.toThrow(/open_form/);

    expect(settled.settled).toBe(true);
    expect(presenter.shown).toHaveLength(1);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });

  it('rejects and opens nothing once its signal aborts while queued', async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    const host = new AbortController();
    const queued = session.open(PLACEMENT_ARGS, null, host.signal);

    host.abort();
    await expect(queued).rejects.toThrow(/open_form/);

    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });

  it('rejects a call whose signal is already aborted and replaces nothing', async () => {
    const session = startSession();
    void session.open(NAMING_ARGS, null, live());
    await expireDeadline();
    const host = new AbortController();
    host.abort();

    await expect(
      session.open(PLACEMENT_ARGS, null, host.signal),
    ).rejects.toThrow(/open_form/);

    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
    expect(store.newestFor(PLACEMENT_FINGERPRINT)).toBeNull();
  });
});

describe('saved forms from an earlier app run', () => {
  it('pre-fills a re-sent form from its saved draft', () => {
    saveEarlier(NAMING_ARGS, 'open', HALF_BODY);

    void startSession().open(NAMING_ARGS, null, live());
    const shown = presenter.latest();

    expect(shown.draft).toEqual(HALF_BODY);
    expect(savedFile(shown.formId).body).toEqual(HALF_BODY);
  });

  it('pre-fills a fresh form from an older form already returned', () => {
    const earlier = saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);
    store.markReturned(earlier);

    void startSession().open(NAMING_ARGS, null, live());

    expect(presenter.latest().formId).not.toBe(earlier.id);
    expect(presenter.latest().draft).toEqual(body('finished: half done'));
  });

  it('returns the saved finished form to collect_last_form and marks it returned', async () => {
    const earlier = saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);
    const session = startSession();

    const first = await session.collect(true, live());
    const second = await session.collect(true, live());

    expect(first.outcome).toBe('submitted');
    expect(first.note).toBe('half done');
    expect(second).toEqual(first);
    expect(newestSaved(earlier.fingerprint).returned).toBe(true);
  });

  it('hands back the saved finished form to a new form', async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);

    const handed = await startSession().open(PLACEMENT_ARGS, null, live());

    expect(handed.earlier_heading).toBe('Naming decisions');
    expect(presenter.shown).toEqual([]);
  });

  it('returns the saved finished form plainly when that form is re-sent', async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);

    const payload = await startSession().open(NAMING_ARGS, null, live());

    expect(payload.outcome).toBe('submitted');
    expect(payload).not.toHaveProperty('earlier_heading');
    expect(presenter.shown).toEqual([]);
  });

  it("never returns another session's saved form", async () => {
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY, {
      sessionId: 'session-2',
      projectDir: '/work/wigley',
    });

    expect((await startSession().collect(true, live())).outcome).toBe(
      'no_form',
    );
  });

  it('hands back nothing without a session id or a project folder', async () => {
    const nobody = { sessionId: null, projectDir: null };
    saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY, nobody);

    const pending = startSession(nobody).open(PLACEMENT_ARGS, null, live());
    await expireDeadline();
    const payload = await pending;

    expect(payload.outcome).toBe('draft');
    expect(payload).not.toHaveProperty('earlier_heading');
    expect(presenter.shown).toHaveLength(1);
  });

  // Args the test type's parser rejects: an empty item list.
  const OLD_SHAPE_ARGS = { heading: 'Old review', items: [] };

  function saveUnparseable(): SavedAgentForm {
    const record = store.create(
      SESSION,
      'unparseable',
      OLD_SHAPE_ARGS,
      HALF_BODY,
      null,
    );
    store.finish(record, 'submitted', HALF_BODY);
    return record;
  }

  it('reports a saved form that no longer parses to collect_last_form and leaves it unreturned', async () => {
    const record = saveUnparseable();
    const session = startSession();

    const failed = session.collect(true, live());

    await expect(failed).rejects.toThrow(/Old review/);
    await expect(failed).rejects.toThrow(`${record.id}.json`);
    await expect(failed).rejects.toThrow(
      'items must be a non-empty array of strings',
    );
    expect(savedFile(record.id).returned).toBe(false);
  });

  it('passes over a reported unparseable form on the next call, still unreturned', async () => {
    const record = saveUnparseable();
    const session = startSession();
    await session.collect(true, live()).catch(() => {});

    const payload = await session.collect(true, live());

    expect(payload.outcome).toBe('no_form');
    expect(savedFile(record.id).returned).toBe(false);
  });

  it('returns an older readable form behind a reported unparseable one', async () => {
    const older = saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY);
    nowMs = 2_000_000;
    const unreadable = saveUnparseable();
    const session = startSession();
    await expect(session.collect(true, live())).rejects.toThrow(/Old review/);

    const payload = await session.collect(true, live());

    expect(payload.outcome).toBe('submitted');
    expect(payload.note).toBe('half done');
    expect(savedFile(older.id).returned).toBe(true);
    expect(savedFile(unreadable.id).returned).toBe(false);
  });

  it('reports an unparseable saved form to a new form, which opens once re-sent', async () => {
    const record = saveUnparseable();
    const session = startSession();

    await expect(session.open(NAMING_ARGS, null, live())).rejects.toThrow(
      /Old review/,
    );
    expect(presenter.shown).toEqual([]);
    void session.open(NAMING_ARGS, null, live());

    expect(presenter.shown).toHaveLength(1);
    expect(savedFile(record.id).returned).toBe(false);
  });
});

describe('pre-fill', () => {
  it('passes finished to prefill: true for a finished save, false for an open draft', () => {
    store.markReturned(saveEarlier(NAMING_ARGS, 'submitted', HALF_BODY));
    void startSession().open(NAMING_ARGS, null, live());
    expect(latestDraft()).toEqual(body('finished: half done'));

    saveEarlier(PLACEMENT_ARGS, 'open', HALF_BODY);
    void startSession({ sessionId: 'session-2' }).open(
      PLACEMENT_ARGS,
      null,
      live(),
    );
    expect(latestDraft()).toEqual(body('half done'));
  });
});

describe("the user's answers on disk", () => {
  it('saves drafts as they arrive, and marks the file returned only once a reply carries it', async () => {
    const session = startSession();
    const first = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await first;

    presenter.draft(shown.formId, body('half'));
    expect(savedFile(shown.formId)).toMatchObject({
      outcome: 'open',
      body: { note: 'half' },
    });

    presenter.submit(shown.formId, body('done'));
    expect(savedFile(shown.formId)).toMatchObject({
      outcome: 'submitted',
      returned: false,
      body: { note: 'done' },
    });

    await session.collect(true, live());
    expect(savedFile(shown.formId).returned).toBe(true);
  });

  it('keeps the first finish in both the answer and the file', async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    const shown = presenter.latest();

    presenter.submit(shown.formId, body('submit'));
    presenter.cancel(shown.formId, body('cancel'));
    const payload = await pending;

    expect(payload).toMatchObject({ outcome: 'submitted', note: 'submit' });
    expect(savedFile(shown.formId)).toMatchObject({
      outcome: 'submitted',
      body: { note: 'submit' },
    });
    expect(presenter.closed).toEqual([shown.formId]);
  });

  it("throws a draft's failed write to the caller and keeps the draft for the reply", async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    vi.spyOn(store, 'saveBody').mockImplementation(() => {
      throw new Error('could not save form r: EACCES');
    });

    expect(() => presenter.draft(shown.formId, body('half'))).toThrow(
      'could not save form r: EACCES',
    );
    await expireDeadline();

    expect(await pending).toMatchObject({ outcome: 'draft', note: 'half' });
  });

  it('drops a draft that arrives after the finish', async () => {
    const pending = startSession().open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    presenter.submit(shown.formId, body('done'));
    await pending;

    presenter.draft(shown.formId, body('late'));

    expect(savedFile(shown.formId)).toMatchObject({
      outcome: 'submitted',
      body: { note: 'done' },
    });
  });
});

describe('a session that ends', () => {
  // The open call of the row, which its `wait` may wait on.
  let opening: Promise<TestPayload>;

  it.each<{
    call: string;
    wait(session: AgentFormSession<TestPayload>): Promise<TestPayload>;
  }>([
    { call: 'the open call', wait: () => opening },
    {
      call: 'a collect call',
      wait: (session) => session.collect(true, live()),
    },
  ])(
    'closes its open form, keeps its answers and rejects $call naming the open tool',
    async ({ wait }) => {
      const session = startSession();
      opening = session.open(NAMING_ARGS, null, live());
      const settledOpening = expect(opening).rejects.toThrow(/open_form/);
      const shown = presenter.latest();
      presenter.draft(shown.formId, body('half'));
      const waiting = wait(session);

      session.end();

      expect(presenter.closed).toEqual([shown.formId]);
      await expect(waiting).rejects.toThrow(/open_form/);
      await settledOpening;
      expect(vi.getTimerCount()).toBe(0);
      expect(savedFile(shown.formId)).toMatchObject({
        outcome: 'open',
        body: { note: 'half' },
      });
    },
  );

  it('still returns the answers of a form the user finished just before it ended', async () => {
    const session = startSession();
    const waiting = session.open(NAMING_ARGS, null, live());
    presenter.submit(presenter.latest().formId, body('done'));

    session.end();

    expect(await waiting).toMatchObject({ outcome: 'submitted', note: 'done' });
  });

  it('rejects every later open call', async () => {
    const session = startSession();
    session.end();

    await expect(session.open(NAMING_ARGS, null, live())).rejects.toThrow(
      /open_form/,
    );
  });

  it('lets the next session re-send the form pre-filled', async () => {
    const session = startSession();
    const waiting = session.open(NAMING_ARGS, null, live());
    presenter.draft(presenter.latest().formId, body('half'));
    session.end();
    await expect(waiting).rejects.toThrow(/open_form/);

    void startSession().open(NAMING_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(body('half'));
  });

  it('closes nothing when no form is open', () => {
    startSession().end();

    expect(presenter.closed).toEqual([]);
  });
});

describe('a session moved to a new host id', () => {
  // A session whose host id `moveHost` changes in place, as `/clear` does.
  function startMovableSession() {
    const info: AgentFormOwnerInfo = { ...SESSION };
    const session = createAgentFormService({
      type: TEST_FORM_TYPE,
      presenter,
      store,
      wake,
      defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
      timers: globalTimers,
    }).startSession({ id: 'app-1', info });
    const moveHost = () => {
      info.sessionId = 'session-2';
    };
    return { session, moveHost };
  }

  it.each([
    {
      case: 'submitted after the move',
      finishBeforeMove: false,
    },
    {
      case: 'already returned before the move',
      finishBeforeMove: true,
    },
  ])(
    'never returns a form of the old host id to collect: $case',
    async ({ finishBeforeMove }) => {
      const { session, moveHost } = startMovableSession();
      const asking = session.open(NAMING_ARGS, null, live());
      const shown = presenter.latest();
      if (finishBeforeMove) {
        presenter.submit(shown.formId, body('choice 1'));
        await asking;
        moveHost();
      } else {
        await expireDeadline();
        await asking;
        moveHost();
        presenter.submit(shown.formId, body('choice 1'));
      }

      const collected = await session.collect(false, live());

      expect(collected.outcome).toBe('no_form');
      expect(savedFile(shown.formId)).toMatchObject({
        outcome: 'submitted',
        returned: finishBeforeMove,
        session_id: 'session-1',
      });
    },
  );

  it('opens a new form under the new id, leaving an unfinished old form open on disk', async () => {
    const { session, moveHost } = startMovableSession();
    const asking = session.open(NAMING_ARGS, null, live());
    const old = presenter.latest();
    presenter.draft(old.formId, body('half'));
    moveHost();

    void session.open(PLACEMENT_ARGS, null, live());

    expect((await asking).outcome).toBe('draft');
    await vi.advanceTimersByTimeAsync(0);
    expect(presenter.closed).toEqual([old.formId]);
    expect(savedFile(old.formId)).toMatchObject({
      outcome: 'open',
      session_id: 'session-1',
    });
    expect(savedFile(presenter.latest().formId)).toMatchObject({
      fingerprint: fingerprintOf(PLACEMENT_ARGS),
      session_id: 'session-2',
    });
  });

  it('does not wake the session for an old host id form submitted after the move', async () => {
    const { session, moveHost } = startMovableSession();
    const asking = session.open(NAMING_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();
    await asking;
    moveHost();

    presenter.submit(shown.formId, body('choice 1'));

    expect(wakes).toEqual([]);
  });

  it('rejects a call queued under the old id, opening nothing under the new one', async () => {
    const { session, moveHost } = startMovableSession();
    void session.open(NAMING_ARGS, null, live());
    const queued = session.open(PLACEMENT_ARGS, null, live());
    moveHost();

    void session.collect(false, live());

    await expect(queued).rejects.toThrow(/new host id.*open_form/);
    expect(presenter.shown).toHaveLength(1);
    expect(store.newestFor(fingerprintOf(PLACEMENT_ARGS))).toBeNull();
  });
});

describe('auto-answer', () => {
  let autoAnswerOn: boolean;

  const autoAnswer: AgentFormAutoAnswer<TestForm, TestBody, TestPayload> = {
    isOn: (sessionId) => autoAnswerOn && sessionId === 'app-1',
    body: (form) => body(`recommended for ${form.heading}`),
    payload: (form, answered) => ({
      outcome: 'auto_answered',
      heading: form.heading,
      note: answered.note,
    }),
  };

  // A session whose host id `moveHost` changes in place, as `/clear` does.
  function startAutoSession() {
    const info: AgentFormOwnerInfo = { ...SESSION };
    const session = createAgentFormService({
      type: TEST_FORM_TYPE,
      presenter,
      store,
      wake,
      defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
      timers: globalTimers,
      autoAnswer,
    }).startSession({ id: 'app-1', info });
    const moveHost = () => {
      info.sessionId = 'session-2';
    };
    return { session, moveHost };
  }

  function autoAnswered(args: unknown): TestPayload {
    const form = parse(args);
    return autoAnswer.payload(form, autoAnswer.body(form));
  }

  // Every saved form file, in id order.
  function savedFiles(): Record<string, unknown>[] {
    return readdirSync(formsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => savedFile(name.slice(0, -'.json'.length)));
  }

  beforeEach(() => {
    autoAnswerOn = true;
  });

  it('returns the auto-answered payload without showing a form, and saves one file answered and returned', async () => {
    const { session } = startAutoSession();

    const payload = await session.open(NAMING_ARGS, 'toolu_1', live());

    expect(payload).toEqual(autoAnswered(NAMING_ARGS));
    expect(presenter.shown).toEqual([]);
    expect(savedFiles()).toEqual([
      expect.objectContaining({
        fingerprint: fingerprintOf(NAMING_ARGS),
        body: body('recommended for Naming decisions'),
        outcome: 'submitted',
        returned: true,
        auto_answered: true,
        tool_use_id: 'toolu_1',
      }),
    ]);
  });

  it('rejects a malformed form with the args error and saves nothing', async () => {
    const { session } = startAutoSession();

    await expect(
      session.open({ heading: 'H' }, null, live()),
    ).rejects.toMatchObject({ name: TEST_FORM_ERROR_NAME });
    expect(savedFiles()).toEqual([]);
  });

  it('replays the auto-answered payload to collect, and to a re-send of the same form without a second file', async () => {
    const { session } = startAutoSession();
    await session.open(NAMING_ARGS, null, live());

    const collected = await session.collect(false, live());
    const resent = await session.open(NAMING_ARGS, null, live());

    expect(collected).toEqual(autoAnswered(NAMING_ARGS));
    expect(resent).toEqual(autoAnswered(NAMING_ARGS));
    expect(savedFiles()).toHaveLength(1);
  });

  it('opens the form for a re-send once auto-answer is off', async () => {
    const { session } = startAutoSession();
    await session.open(NAMING_ARGS, null, live());
    autoAnswerOn = false;

    void session.open(NAMING_ARGS, null, live());
    await vi.advanceTimersByTimeAsync(0);

    expect(presenter.shown).toHaveLength(1);
    expect(presenter.latest().form).toEqual(parse(NAMING_ARGS));
  });

  it('answers at once while another form is open, and leaves that form open', async () => {
    const { session } = startAutoSession();
    autoAnswerOn = false;
    void session.open(NAMING_ARGS, null, live());
    autoAnswerOn = true;

    const payload = await session.open(PLACEMENT_ARGS, null, live());

    expect(payload).toEqual(autoAnswered(PLACEMENT_ARGS));
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
  });

  it('collects the open form while one is open, and the auto-answered payload once none is', async () => {
    const { session } = startAutoSession();
    await session.open(PLACEMENT_ARGS, null, live());
    const beforeAnyForm = await session.collect(false, live());
    autoAnswerOn = false;
    const asking = session.open(NAMING_ARGS, null, live());
    autoAnswerOn = true;
    await session.open(PLACEMENT_ARGS, null, live());

    const whileOpen = await session.collect(false, live());
    presenter.submit(presenter.latest().formId, body('mine'));
    await asking;
    const afterSubmit = await session.collect(false, live());

    expect(beforeAnyForm).toEqual(autoAnswered(PLACEMENT_ARGS));
    expect(whileOpen).toMatchObject({
      outcome: 'draft',
      heading: 'Naming decisions',
    });
    expect(afterSubmit).toEqual(
      TEST_FORM_TYPE.payload(parse(NAMING_ARGS), 'submitted', body('mine')),
    );
  });

  it('writes a second file for the same form after the host moves', async () => {
    const { session, moveHost } = startAutoSession();
    await session.open(NAMING_ARGS, null, live());
    moveHost();

    const payload = await session.open(NAMING_ARGS, null, live());

    expect(payload).toEqual(autoAnswered(NAMING_ARGS));
    expect(savedFiles()).toEqual([
      expect.objectContaining({ auto_answered: true, session_id: 'session-1' }),
      expect.objectContaining({ auto_answered: true, session_id: 'session-2' }),
    ]);
  });

  it.each([
    {
      case: 'session ended',
      call: (session: AgentFormSession<TestPayload>) => {
        session.end();
        return session.open(NAMING_ARGS, null, live());
      },
      error: 'The session ended before this open_form ran.',
    },
    {
      case: 'signal already aborted',
      call: (session: AgentFormSession<TestPayload>) => {
        const aborted = new AbortController();
        aborted.abort();
        return session.open(NAMING_ARGS, null, aborted.signal);
      },
      error: 'open_form was cancelled before it ran.',
    },
  ])(
    'rejects a call from an ended session or with an aborted signal, and saves nothing: $case',
    async ({ call, error }) => {
      const { session } = startAutoSession();

      await expect(call(session)).rejects.toThrow(error);
      expect(savedFiles()).toEqual([]);
    },
  );
});
