import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
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
}

let connects: SessionInfo[];
let activated: string[];
let calls: Call[];
let connectionEnd: Mock<() => void>;

function record(
  method: Call['method'],
  args: unknown,
  signal: AbortSignal,
): Promise<PrimerPayload> {
  return new Promise((resolve) => {
    calls.push({
      method,
      args,
      signal,
      settle: (outcome) => resolve({ outcome, summary: '', next: '' }),
    });
  });
}

const fakePrimerSession: AgentFormSession<PrimerPayload> = {
  open: (args, _toolUseId, signal) => record('open', args, signal),
  collect: (_wait, signal) => record('collect', undefined, signal),
  end: () => undefined,
};

const fakePrimer: AgentFormService<PrimerPayload> = {
  startSession: () => fakePrimerSession,
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
  return createPrimerPreview({
    sessions: {
      connect,
      activate: (sessionId) => activated.push(sessionId),
    },
    primer: fakePrimer,
    log: () => undefined,
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
});

describe('open', () => {
  it('open_First_ConnectsActivatesAndOpensSample', () => {
    preview().open();

    expect(connects).toEqual([
      {
        sessionId: 'primer-preview',
        projectDir: null,
        harness: null,
        label: 'Primer preview',
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
  it('submit_ThenOpen_ConnectsAgainWithSample', async () => {
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
