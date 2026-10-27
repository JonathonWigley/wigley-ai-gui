import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentFormService,
  AgentFormSession,
} from '../../../../contracts/agent-forms';
import type {
  AgentSession,
  ConnectedSession,
  SessionInfo,
} from '../../../sessions/contract';
import type { PrimerOutcome, PrimerPayload } from '../../contract';
import { PREVIEW_PRIMER_ARGS } from './preview-primer';
import { createPrimerPreview } from './primer-preview';

interface Call {
  method: 'open' | 'collect';
  args: unknown;
  signal: AbortSignal;
  settle(outcome: PrimerOutcome): void;
  fail(error: Error): void;
}

let connects: SessionInfo[];
let activated: string[];
let connectedEnds: number;
let primerEnds: number;
let calls: Call[];
let logLines: string[];

function record(
  method: Call['method'],
  args: unknown,
  signal: AbortSignal,
): Promise<PrimerPayload> {
  return new Promise((resolve, reject) => {
    calls.push({
      method,
      args,
      signal,
      settle: (outcome) => resolve({ outcome, summary: '', next: '' }),
      fail: reject,
    });
  });
}

const fakePrimerSession: AgentFormSession<PrimerPayload> = {
  open: (args, _toolUseId, signal) => record('open', args, signal),
  collect: (_wait, signal) => record('collect', undefined, signal),
  end: () => {
    primerEnds++;
  },
};

const fakePrimer: AgentFormService<PrimerPayload> = {
  startSession: () => fakePrimerSession,
};

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
  return createPrimerPreview({
    sessions: {
      connect,
      activate: (sessionId) => activated.push(sessionId),
    },
    primer: fakePrimer,
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
  primerEnds = 0;
  calls = [];
  logLines = [];
});

describe('open', () => {
  it('open_First_ConnectsActivatesAndOpensSample', () => {
    preview().open();

    expect(connects).toEqual([
      {
        sessionId: 'primer-preview',
        projectDir: 'Primer preview',
        deadlineSeconds: null,
        harness: null,
      },
    ]);
    expect(activated).toEqual(['preview-row']);
    expect(calls.map((call) => [call.method, call.args])).toEqual([
      ['open', PREVIEW_PRIMER_ARGS],
    ]);
  });

  it('open_Again_ActivatesOnlyAndOpensNothing', () => {
    const subject = preview();
    subject.open();

    subject.open();

    expect(connects).toHaveLength(1);
    expect(activated).toEqual(['preview-row', 'preview-row']);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);
  });
});

describe('settle', () => {
  it.each<PrimerOutcome>(['submitted', 'cancelled'])(
    'submitOrCancel_EndsSession (%s)',
    async (outcome) => {
      preview().open();

      calls[0].settle(outcome);
      await flush();

      expect(primerEnds).toBe(1);
      expect(connectedEnds).toBe(1);
    },
  );

  it('submit_ThenOpen_ConnectsAgain', async () => {
    const subject = preview();
    subject.open();
    calls[0].settle('submitted');
    await flush();

    subject.open();

    expect(connects).toHaveLength(2);
    expect(calls.map((call) => call.args)).toEqual([
      PREVIEW_PRIMER_ARGS,
      PREVIEW_PRIMER_ARGS,
    ]);
  });

  it('draftOutcome_WaitsAgainWithCollect', async () => {
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

  it('openRejects_LogsAndEndsSession', async () => {
    preview().open();

    calls[0].fail(new Error('store write failed'));
    await flush();

    expect(logLines).toEqual([
      expect.stringMatching(/^\[primer\] .*store write failed/),
    ]);
    expect(primerEnds).toBe(1);
    expect(connectedEnds).toBe(1);
  });
});
