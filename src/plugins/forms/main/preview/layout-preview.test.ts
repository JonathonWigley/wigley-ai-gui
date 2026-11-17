import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
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
let calls: Call[];
let connectionEnd: Mock<() => void>;
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
  end: () => undefined,
};

const fakeForms: FormsService = {
  startSession: () => fakeFormsSession,
  detach: () => undefined,
};

function connect(info: SessionInfo): ConnectedSession {
  connects.push(info);
  const session: AgentSession = { id: 'preview-row', info };
  return {
    session,
    call: () => Promise.reject(new Error('the preview calls no tool')),
    end: connectionEnd,
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
    log: (message: string) => logLines.push(message),
  });
}

// Lets the settled promise's handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  connects = [];
  activated = [];
  calls = [];
  connectionEnd = vi.fn();
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
        projectDir: null,
        harness: null,
        rowId: null,
        label: 'Layout preview',
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
    expect(logLines[0]).toMatch(/preview skipped a saved round/);
  });

  it('open_SavedArgsNameMissingLayout_SkipsAndLogs', () => {
    saved = [NAMING_GONE, SECOND_SAVED];
    layoutNames = ['default'];
    const subject = preview();
    subject.open();

    subject.open();

    expect(calls.at(-1)?.args).toBe(SECOND_SAVED);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatch(/preview skipped a saved round/);
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
});

describe('dispose', () => {
  it.each([
    { state: 'opened, disposed', opens: 1, disposes: 1, ends: 1 },
    { state: 'opened, disposed twice', opens: 1, disposes: 2, ends: 1 },
    { state: 'never opened, disposed', opens: 0, disposes: 1, ends: 0 },
  ])(
    'dispose ends the connection the preview holds, once ($state)',
    ({ opens, disposes, ends }) => {
      const subject = preview();
      for (let open = 0; open < opens; open++) {
        subject.open();
      }

      for (let dispose = 0; dispose < disposes; dispose++) {
        subject.dispose();
      }

      expect(connectionEnd).toHaveBeenCalledTimes(ends);
    },
  );
});
