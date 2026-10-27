import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentSession,
  ConnectedSession,
  SessionInfo,
} from '../../../sessions/contract';
import type {
  AnswersPayload,
  FormsService,
  FormsSession,
  Outcome,
} from '../../contract';
import { createLayoutPreview } from './layout-preview';
import { PREVIEW_ROUND_ARGS } from './preview-round';

interface Call {
  method: 'open' | 'collect';
  args: unknown;
  signal: AbortSignal;
  settle(outcome: Outcome): void;
  fail(error: Error): void;
}

const FIRST_SAVED = {
  heading: 'First saved',
  notices: [{ title: 'One', context: 'One line.' }],
};
const SECOND_SAVED = {
  heading: 'Second saved',
  notices: [{ title: 'Two', context: 'One line.' }],
};
const UNPARSEABLE = { heading: 'Broken', notices: [] };
const NAMING_GONE = { ...FIRST_SAVED, layout: 'gone' };

let connects: SessionInfo[];
let activated: string[];
let connectedEnds: number;
let formsEnds: number;
let calls: Call[];
let logLines: string[];
let saved: unknown[];
let layoutNames: readonly string[];

function payload(outcome: Outcome): AnswersPayload {
  return {
    outcome,
    summary: '',
    next: '',
    answers: [],
    findings: [],
    notices: [],
  };
}

function record(
  method: Call['method'],
  args: unknown,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  return new Promise((resolve, reject) => {
    calls.push({
      method,
      args,
      signal,
      settle: (outcome) => resolve(payload(outcome)),
      fail: reject,
    });
  });
}

const fakeFormsSession: FormsSession = {
  open: (args, _toolUseId, signal) => record('open', args, signal),
  collect: (_wait, signal) => record('collect', undefined, signal),
  end: () => {
    formsEnds++;
  },
};

const fakeForms: FormsService = { startSession: () => fakeFormsSession };

function connect(info: SessionInfo): ConnectedSession {
  connects.push(info);
  const session: AgentSession = { id: 'preview-row', info };
  return {
    session,
    call: () => Promise.reject(new Error('the preview calls no tool')),
    end: () => {
      connectedEnds++;
    },
  };
}

function preview() {
  return createLayoutPreview({
    sessions: {
      connect,
      activate: (sessionId) => activated.push(sessionId),
    },
    forms: fakeForms,
    savedArgs: () => saved,
    layoutNames: () => layoutNames,
    log: (source, message) => logLines.push(`[${source}] ${message}`),
  });
}

// Lets the settled promise's handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  connects = [];
  activated = [];
  connectedEnds = 0;
  formsEnds = 0;
  calls = [];
  logLines = [];
  saved = [FIRST_SAVED, SECOND_SAVED];
  layoutNames = ['default'];
});

describe('open', () => {
  it('open_First_ConnectsAndAsksSample', () => {
    preview().open();

    expect(connects).toEqual([
      {
        sessionId: 'layout-preview',
        projectDir: 'Layout preview',
        deadlineSeconds: null,
        harness: null,
      },
    ]);
    expect(calls.map((call) => call.args)).toEqual([PREVIEW_ROUND_ARGS]);
  });

  it('open_Again_AbortsAndAsksNewestSaved', () => {
    const subject = preview();
    subject.open();

    subject.open();
    subject.open();

    expect(calls.map((call) => call.args)).toEqual([
      PREVIEW_ROUND_ARGS,
      FIRST_SAVED,
      SECOND_SAVED,
    ]);
    expect(calls.map((call) => call.signal.aborted)).toEqual([
      true,
      true,
      false,
    ]);
    expect(connects).toHaveLength(1);
  });

  it('open_EveryPress_ActivatesPreviewRow', () => {
    const subject = preview();

    subject.open();
    subject.open();

    expect(activated).toEqual(['preview-row', 'preview-row']);
  });

  it('open_PastLastSaved_WrapsToSample', () => {
    const subject = preview();
    subject.open();
    subject.open();
    subject.open();

    subject.open();

    expect(calls.at(-1)?.args).toBe(PREVIEW_ROUND_ARGS);
  });

  it('open_SavedArgsUnparseable_SkipsAndLogs', () => {
    saved = [UNPARSEABLE, SECOND_SAVED];
    const subject = preview();
    subject.open();

    subject.open();

    expect(calls.at(-1)?.args).toBe(SECOND_SAVED);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatch(/^\[forms\] /);
  });

  it('open_SavedArgsNameMissingLayout_SkipsAndLogs', () => {
    saved = [NAMING_GONE, SECOND_SAVED];
    layoutNames = ['default'];
    const subject = preview();
    subject.open();

    subject.open();

    expect(calls.at(-1)?.args).toBe(SECOND_SAVED);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatch(/^\[forms\] /);
  });

  it('open_NoSavedArgsParse_AsksSampleAgain', () => {
    saved = [UNPARSEABLE];
    const subject = preview();
    subject.open();

    subject.open();

    expect(calls.map((call) => call.args)).toEqual([
      PREVIEW_ROUND_ARGS,
      PREVIEW_ROUND_ARGS,
    ]);
  });
});

describe('settle', () => {
  it('submit_EndsSession', async () => {
    preview().open();

    calls[0].settle('submitted');
    await flush();

    expect(formsEnds).toBe(1);
    expect(connectedEnds).toBe(1);
  });

  it('submit_ThenOpen_ConnectsAgainWithSample', async () => {
    const subject = preview();
    subject.open();
    subject.open();
    calls[1].settle('cancelled');
    await flush();

    subject.open();

    expect(connects).toHaveLength(2);
    expect(calls.at(-1)?.args).toBe(PREVIEW_ROUND_ARGS);
  });

  it('abortedAsk_Settles_IsIgnored', async () => {
    const subject = preview();
    subject.open();
    subject.open();

    calls[0].settle('cancelled');
    await flush();

    expect(connectedEnds).toBe(0);
  });

  it('askRejects_LogsAndEndsSession', async () => {
    preview().open();

    calls[0].fail(new Error('store write failed'));
    await flush();

    expect(logLines).toEqual([expect.stringContaining('store write failed')]);
    expect(formsEnds).toBe(1);
    expect(connectedEnds).toBe(1);
  });

  it('abortedAsk_Rejects_IsIgnored', async () => {
    const subject = preview();
    subject.open();
    subject.open();

    calls[0].fail(new Error('aborted'));
    await flush();

    expect(logLines).toEqual([]);
    expect(formsEnds).toBe(0);
    expect(connectedEnds).toBe(0);
  });

  it('draftOutcome_RewaitsWithCollectLastRound', async () => {
    preview().open();

    calls[0].settle('draft');
    await flush();

    expect(calls[1].method).toBe('collect');
    expect(calls[1].signal).toBe(calls[0].signal);
    expect(connectedEnds).toBe(0);

    calls[1].settle('submitted');
    await flush();

    expect(connectedEnds).toBe(1);
  });
});
