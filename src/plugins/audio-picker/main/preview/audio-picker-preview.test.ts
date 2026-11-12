import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type {
  AgentFormService,
  AgentFormSession,
} from '../../../../contracts/agent-forms';
import { posixPaths } from '../../../../shared/paths/posix-paths';
import type {
  AgentSession,
  ConnectedSession,
  SessionInfo,
} from '../../../sessions/contract';
import type { AudioPickerOutcome, AudioPickerPayload } from '../../contract';
import { samplePickerArgs } from '../fixtures';
import { createAudioPickerPreview } from './audio-picker-preview';

interface Call {
  args: unknown;
  signal: AbortSignal;
  settle(outcome: AudioPickerOutcome): void;
}

const ARGS = samplePickerArgs('/home/sounds', posixPaths);

// What the preview did, in order: `connect`, `activate`, `write` and `ask`.
let steps: string[];
let calls: Call[];
let logs: string[];
let connectionEnd: Mock<() => void>;
let writeSounds: () => Promise<void>;

const fakePickerSession: AgentFormSession<AudioPickerPayload> = {
  open: (args, _toolUseId, signal) =>
    new Promise((resolve) => {
      steps.push('ask');
      calls.push({
        args,
        signal,
        settle: (outcome) => resolve({ outcome, summary: '', next: '' }),
      });
    }),
  collect: () => new Promise(() => undefined),
  end: () => undefined,
};

const fakePicker: AgentFormService<AudioPickerPayload> = {
  startSession: () => fakePickerSession,
  detach: () => undefined,
};

function connect(info: SessionInfo): ConnectedSession {
  steps.push('connect');
  const session: AgentSession = { id: 'preview-row', info };
  return {
    session,
    call: () => Promise.reject(new Error('the preview calls no tool')),
    end: connectionEnd,
  };
}

function preview() {
  return createAudioPickerPreview({
    sessions: {
      connect,
      activate: () => steps.push('activate'),
    },
    picker: fakePicker,
    writeSounds: () => writeSounds(),
    args: ARGS,
    log: (message) => logs.push(message),
  });
}

// Lets the settled promises' handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  steps = [];
  calls = [];
  logs = [];
  connectionEnd = vi.fn();
  writeSounds = () => {
    steps.push('write');
    return Promise.resolve();
  };
});

describe('open', () => {
  it('open first connects and activates, then writes the sounds, then opens the sample', async () => {
    preview().open();
    await flush();

    expect(steps).toEqual(['connect', 'activate', 'write', 'ask']);
    expect(calls.map((call) => call.args)).toEqual([ARGS]);
  });

  it('open again activates only, and writes and opens nothing', async () => {
    const subject = preview();
    subject.open();
    await flush();

    subject.open();
    await flush();

    expect(steps).toEqual(['connect', 'activate', 'write', 'ask', 'activate']);
    expect(calls[0].signal.aborted).toBe(false);
  });

  it('dispose during the write asks nothing and throws nothing', async () => {
    const write = Promise.withResolvers<void>();
    writeSounds = () => write.promise;
    const subject = preview();
    subject.open();

    subject.dispose();
    write.resolve();
    await flush();

    expect(calls).toEqual([]);
    expect(logs).toEqual([]);
    expect(connectionEnd).toHaveBeenCalledTimes(1);
  });

  it('a failed write opens nothing and logs the reason', async () => {
    writeSounds = () => Promise.reject(new Error('disk full'));
    const subject = preview();

    subject.open();
    await flush();

    expect(calls).toEqual([]);
    expect(logs).toEqual(['preview sounds not written: disk full']);
    // Ended, so the next open connects and writes again.
    expect(connectionEnd).toHaveBeenCalledTimes(1);
  });
});

describe('settle', () => {
  it('submit, then open, connects again with the sample', async () => {
    const subject = preview();
    subject.open();
    await flush();
    calls[0].settle('submitted');
    await flush();

    subject.open();
    await flush();

    expect(steps.filter((step) => step === 'connect')).toHaveLength(2);
    expect(calls.map((call) => call.args)).toEqual([ARGS, ARGS]);
  });
});

describe('dispose', () => {
  it.each([
    { state: 'opened, disposed', opens: 1, disposes: 1, ends: 1 },
    { state: 'opened, disposed twice', opens: 1, disposes: 2, ends: 1 },
    { state: 'never opened, disposed', opens: 0, disposes: 1, ends: 0 },
  ])(
    "dispose ends the open preview's session, once ($state)",
    async ({ opens, disposes, ends }) => {
      const subject = preview();
      for (let open = 0; open < opens; open++) {
        subject.open();
      }
      await flush();

      for (let dispose = 0; dispose < disposes; dispose++) {
        subject.dispose();
      }

      expect(connectionEnd).toHaveBeenCalledTimes(ends);
    },
  );
});
