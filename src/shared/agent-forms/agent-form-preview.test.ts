import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentFormOwner,
  AgentFormService,
  AgentFormSession,
} from '../../contracts/agent-forms';
import {
  type AgentFormPreview,
  createAgentFormPreview,
  type PreviewConnection,
} from './agent-form-preview';

interface Payload {
  outcome: string;
}

interface Call {
  method: 'open' | 'collect';
  args: unknown;
  signal: AbortSignal;
  settle(outcome: string): void;
  fail(error: Error): void;
}

interface Info {
  label: string;
}

const PREVIEW_INFO: Info = { label: 'Sample preview' };

let connects: Info[];
let activated: string[];
let connectedEnds: number;
let formEnds: number;
let calls: Call[];
let logLines: string[];

function record(
  method: Call['method'],
  args: unknown,
  signal: AbortSignal,
): Promise<Payload> {
  return new Promise((resolve, reject) => {
    calls.push({
      method,
      args,
      signal,
      settle: (outcome) => resolve({ outcome }),
      fail: reject,
    });
  });
}

const fakeFormSession: AgentFormSession<Payload> = {
  open: (args, _toolUseId, signal) => record('open', args, signal),
  collect: (_wait, signal) => record('collect', undefined, signal),
  end: () => {
    formEnds++;
  },
};

const fakeForms: AgentFormService<Payload> = {
  startSession: () => fakeFormSession,
};

function connect(info: Info): PreviewConnection {
  connects.push(info);
  const session: AgentFormOwner = {
    id: 'preview-row',
    info: { sessionId: null, projectDir: null, deadlineSeconds: null },
  };
  return {
    session,
    end: () => {
      connectedEnds++;
    },
  };
}

function preview(): AgentFormPreview {
  return createAgentFormPreview({
    session: PREVIEW_INFO,
    sessions: {
      connect,
      activate: (sessionId) => activated.push(sessionId),
    },
    forms: fakeForms,
    log: (message: string) => logLines.push(message),
    noun: 'form',
  });
}

// A preview shown and asked `args` once.
function asked(args: unknown = 'first'): AgentFormPreview {
  const subject = preview();
  subject.show();
  subject.ask(args);
  return subject;
}

// Lets the settled promise's handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  connects = [];
  activated = [];
  connectedEnds = 0;
  formEnds = 0;
  calls = [];
  logLines = [];
});

describe('show', () => {
  it('show_EveryCall_ConnectsOnceAndActivatesTheRow', () => {
    const subject = preview();

    const shown = [subject.show(), subject.show()];

    expect(shown).toEqual([true, false]);
    expect(connects).toEqual([PREVIEW_INFO]);
    expect(activated).toEqual(['preview-row', 'preview-row']);
  });

  it('show_AfterTheFormEnded_ConnectsAgain', async () => {
    const subject = asked();
    calls[0].settle('submitted');
    await flush();

    expect(subject.show()).toBe(true);
    expect(connects).toHaveLength(2);
  });
});

describe('dispose', () => {
  it.each([
    {
      case: 'WhileShown_AbortsTheAskAndEndsTheSession',
      run: () => asked().dispose(),
      ends: [1, 1],
    },
    {
      case: 'NeverShown_EndsNothing',
      run: () => preview().dispose(),
      ends: [0, 0],
    },
    {
      case: 'Twice_EndsOnce',
      run: () => {
        const subject = asked();
        subject.dispose();
        subject.dispose();
      },
      ends: [1, 1],
    },
  ])('dispose_$case', ({ run, ends }) => {
    run();

    expect([formEnds, connectedEnds]).toEqual(ends);
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
  });
});

describe('ask', () => {
  it('ask_BeforeShow_Throws', () => {
    expect(() => preview().ask('first')).toThrow('before show');
  });

  it('ask_Again_AbortsTheFormTheLastAskOpened', () => {
    const subject = asked('first');

    subject.ask('second');

    expect(calls.map((call) => [call.args, call.signal.aborted])).toEqual([
      ['first', true],
      ['second', false],
    ]);
  });

  it.each([
    { case: 'settles', answer: (call: Call) => call.settle('cancelled') },
    { case: 'rejects', answer: (call: Call) => call.fail(new Error('gone')) },
  ])('ask_AbortedForm_IsIgnored when it $case', async ({ answer }) => {
    const subject = asked('first');
    subject.ask('second');

    answer(calls[0]);
    await flush();

    expect([formEnds, connectedEnds, logLines]).toEqual([0, 0, []]);
  });
});

describe('settle', () => {
  it.each(['submitted', 'cancelled'])(
    'outcome_%s_EndsTheSession',
    async (outcome) => {
      asked();

      calls[0].settle(outcome);
      await flush();

      expect([formEnds, connectedEnds]).toEqual([1, 1]);
    },
  );

  it('draftOutcome_WaitsAgainWithCollect', async () => {
    asked();

    calls[0].settle('draft');
    await flush();

    expect(calls[1].method).toBe('collect');
    expect(calls[1].signal).toBe(calls[0].signal);
    expect(connectedEnds).toBe(0);

    calls[1].settle('submitted');
    await flush();

    expect(connectedEnds).toBe(1);
  });

  it('openRejects_LogsAndEndsTheSession', async () => {
    asked();

    calls[0].fail(new Error('store write failed'));
    await flush();

    expect(logLines).toEqual([expect.stringMatching(/store write failed/)]);
    expect([formEnds, connectedEnds]).toEqual([1, 1]);
  });
});
