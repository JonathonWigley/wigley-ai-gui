import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentFormOwnerInfo,
  AgentFormSession,
} from '../../../contracts/agent-forms';
import { NO_FORM_WAKE } from '../../../shared/agent-forms/chat-wake';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import type { AgentFormStore } from '../../../shared/agent-forms/form-store';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { ScriptedFormPresenter } from '../../../shared/agent-forms/scripted-presenter';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { Primer, PrimerBody, PrimerPayload } from '../contract';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import { parsePrimer, primerFingerprint, readPrimerBody } from './primer';
import { PrimerError } from './primer-error';
import { primerType } from './primer-type';

const DEFAULT_DEADLINE_SECONDS = 240;

const SESSION: AgentFormOwnerInfo = {
  sessionId: 'session-1',
  projectDir: '/work/wigley',
};

// A second primer for another feature, with entries of its own.
const OTHER_PRIMER_ARGS = {
  feature: { name: 'Other feature', slug: 'other-feature' },
  entries: [{ id: '1', task: 'Data model', need: 'no', items: ['Nothing'] }],
};

let nowMs: number;
let hexCount: number;
let presenter: ScriptedFormPresenter<Primer, PrimerBody>;
let store: AgentFormStore;

function startSession(): AgentFormSession<PrimerPayload> {
  return createAgentFormService({
    type: primerType,
    presenter,
    store,
    wake: NO_FORM_WAKE,
    defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
    timers: globalTimers,
  }).startSession({ id: 'app-1', info: SESSION });
}

function live(): AbortSignal {
  return new AbortController().signal;
}

async function expireDeadline() {
  await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000);
}

// The sample primer's body with entry 2 set to yes and commented.
function answeredBody(): PrimerBody {
  const body = readPrimerBody(parsePrimer(SAMPLE_PRIMER_ARGS), {});
  body.entries[1].need = 'yes';
  body.entries[1].comment = 'Only the main screen.';
  return body;
}

beforeEach(() => {
  vi.useFakeTimers();
  nowMs = 1_000_000;
  hexCount = 0;
  presenter = new ScriptedFormPresenter();
  store = createMemoryFormStore(
    { now: () => nowMs },
    () => (++hexCount).toString(16).padStart(8, '0'),
    posixPaths,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('primerType through the agent form service', () => {
  it("returns the user's submitted primer as feature and entries", async () => {
    const pending = startSession().open(SAMPLE_PRIMER_ARGS, null, live());
    const shown = presenter.latest();
    presenter.submit(shown.formId, answeredBody());

    const payload = await pending;

    expect(shown.label).toContain('Sample feature');
    expect(payload.outcome).toBe('submitted');
    expect(payload.next).toBe('');
    expect(payload.feature?.name).toBe('Sample feature');
    expect(payload.entries?.[1]).toMatchObject({
      id: '2',
      need: 'yes',
      comment: 'Only the main screen.',
    });
  });

  it('returns a draft at the deadline and the submitted primer to collect_last_primer', async () => {
    const session = startSession();
    const pending = session.open(SAMPLE_PRIMER_ARGS, null, live());
    const shown = presenter.latest();
    await expireDeadline();

    const draft = await pending;
    presenter.submit(shown.formId, answeredBody());
    const collected = await session.collect(true, live());

    expect(draft.outcome).toBe('draft');
    expect(draft.next).toContain('collect_last_primer');
    expect(collected.outcome).toBe('submitted');
    expect(collected.entries?.[1].comment).toBe('Only the main screen.');
  });

  it('rejects a malformed open_primer with its PrimerError and shows nothing', async () => {
    const rejection = startSession().open(
      { feature: SAMPLE_PRIMER_ARGS.feature, entries: [] },
      null,
      live(),
    );

    await expect(rejection).rejects.toBeInstanceOf(PrimerError);
    await expect(rejection).rejects.toThrow("'entries'");
    expect(presenter.shown).toEqual([]);
  });

  it("pre-fills a re-sent primer with the user's saved answers", () => {
    const saved = answeredBody();
    store.create(
      SESSION,
      primerFingerprint(parsePrimer(SAMPLE_PRIMER_ARGS)),
      SAMPLE_PRIMER_ARGS,
      saved,
      null,
    );

    void startSession().open(SAMPLE_PRIMER_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(saved);
  });

  it('answers collect_last_primer with no_primer when nothing is open', async () => {
    const payload = await startSession().collect(true, live());

    expect(payload.outcome).toBe('no_primer');
    expect(payload).not.toHaveProperty('feature');
    expect(payload).not.toHaveProperty('entries');
  });

  it('waits behind an open primer and returns a not-shown draft at its deadline', async () => {
    const session = startSession();
    const first = session.open(OTHER_PRIMER_ARGS, null, live());
    await expireDeadline();
    await first;

    const queued = session.open(SAMPLE_PRIMER_ARGS, null, live());
    let settled = false;
    void queued.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    await expireDeadline();
    const payload = await queued;

    expect(payload.outcome).toBe('draft');
    expect(payload.summary).toContain("'Sample feature'");
    expect(payload.summary).toContain("'Other feature'");
    expect(presenter.shown).toHaveLength(1);
    expect(presenter.closed).toEqual([]);
  });
});

describe('primerType through its tool session', () => {
  it("returns a malformed open_primer's message as its tool error text", async () => {
    const session: AgentFormSession<PrimerPayload> = {
      open: async (args) => {
        primerType.parse(args);
        throw new Error('the primer parsed');
      },
      collect: () => Promise.reject(new Error('collect is not called here')),
      end: () => {},
    };

    const result = await createAgentFormToolSession(session, primerType).call(
      'open_primer',
      { feature: SAMPLE_PRIMER_ARGS.feature, entries: [] },
      { toolUseId: null, signal: new AbortController().signal },
    );

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: "'entries' must be a non-empty array: the primer rows, then the standing tasks.",
        },
      ],
      isError: true,
    });
  });
});
