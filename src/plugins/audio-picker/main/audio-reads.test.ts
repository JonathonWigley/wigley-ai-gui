import { describe, expect, it, vi } from 'vitest';
import type {
  AgentFormListener,
  AgentFormToolResult,
  AgentFormToolSession,
} from '../../../contracts/agent-forms';
import type { Files } from '../../../contracts/files';
import { ScriptedFormPresenter } from '../../../shared/agent-forms/scripted-presenter';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  type AudioPickerBody,
  type AudioPickerForm,
  type AudioPosition,
  COLLECT_AUDIO_PICKER_TOOL,
  OPEN_AUDIO_PICKER_TOOL,
} from '../contract';
import { createAudioReads, withAudioFileCheck } from './audio-reads';
import { parseAudioPicker } from './picker';

const SESSION_ID = 'app-1';
const COIN = '/sounds/coin.wav';
const CHIME = '/sounds/chime.mp3';

// One moment whose candidates are Coin and Chime, one file each.
const PICKER_ARGS = {
  heading: 'Shop sounds',
  moments: [
    {
      title: 'Coin pickup',
      reason: 'Plays when a coin is collected.',
      recommend: 1,
      candidates: [
        {
          name: 'Coin',
          library: 'Kit A',
          files: [COIN],
          play: 'one-shot',
          volume: 0.8,
        },
        {
          name: 'Chime',
          library: 'Kit A',
          files: [CHIME],
          play: 'one-shot',
          volume: 0.6,
        },
      ],
    },
  ],
};

const LISTENER: AgentFormListener<AudioPickerBody> = {
  draft: () => Promise.resolve(),
  finish() {},
  cancel() {},
};

const OK: AgentFormToolResult = { content: [{ type: 'text', text: 'ok' }] };

function parse(args: unknown): AudioPickerForm {
  return parseAudioPicker(args, posixPaths);
}

// Reads over memory files holding Coin's and Chime's bytes, and the watched
// presenter showing or closing the picker as `opened` and `closed` say.
async function readsWith(options: {
  maxBytes?: number;
  opened?: boolean;
  closed?: boolean;
}) {
  const files = createMemoryFiles();
  await files.writeBytes(COIN, new Uint8Array([1, 2, 3]));
  await files.writeBytes(CHIME, new Uint8Array([4, 5, 6, 7]));
  const readBytes = vi.spyOn(files, 'readBytes');
  const reads = createAudioReads({ files, maxBytes: options.maxBytes ?? 64 });
  const presenter = reads.watch(new ScriptedFormPresenter());
  if (options.opened ?? true) {
    presenter.show(
      {
        formId: 'form-1',
        sessionId: SESSION_ID,
        label: 'game · Shop sounds',
        form: parse(PICKER_ARGS),
        draft: null,
      },
      LISTENER,
    );
  }
  if (options.closed ?? false) {
    presenter.close('form-1');
  }
  return { files, reads, readBytes };
}

function fakeInner() {
  return {
    call: vi.fn<AgentFormToolSession['call']>(() => Promise.resolve(OK)),
    end: vi.fn(),
  };
}

function live(): AbortSignal {
  return new AbortController().signal;
}

describe('createAudioReads', () => {
  it("serves the bytes of a file the session's open picker lists", async () => {
    const { reads } = await readsWith({});

    const bytes = await reads.readAudio(SESSION_ID, {
      moment: 0,
      candidate: 1,
      file: 0,
    });

    expect([...bytes]).toEqual([4, 5, 6, 7]);
  });

  const AT: AudioPosition = { moment: 0, candidate: 0, file: 0 };

  it.each([
    {
      name: 'a session with no picker',
      opened: false,
      sessionId: SESSION_ID,
      at: AT,
    },
    { name: "another session's id", sessionId: 'app-2', at: AT },
    {
      name: 'moment out of range',
      sessionId: SESSION_ID,
      at: { ...AT, moment: 1 },
    },
    {
      name: 'candidate out of range',
      sessionId: SESSION_ID,
      at: { ...AT, candidate: 2 },
    },
    {
      name: 'file out of range',
      sessionId: SESSION_ID,
      at: { ...AT, file: 1 },
    },
    {
      name: 'the form after close',
      closed: true,
      sessionId: SESSION_ID,
      at: AT,
    },
  ])(
    'refuses a read the open picker does not list ($name)',
    async ({ opened, closed, sessionId, at }) => {
      const { reads, readBytes } = await readsWith({ opened, closed });

      await expect(reads.readAudio(sessionId, at)).rejects.toThrow(Error);
      expect(readBytes).not.toHaveBeenCalled();
    },
  );

  it('refuses a file longer than maxBytes', async () => {
    const { files, reads } = await readsWith({ maxBytes: 8 });
    await files.writeBytes(COIN, new Uint8Array(8));
    await files.writeBytes(CHIME, new Uint8Array(9));

    const atLimit = await reads.readAudio(SESSION_ID, {
      moment: 0,
      candidate: 0,
      file: 0,
    });
    const overLimit = reads.readAudio(SESSION_ID, {
      moment: 0,
      candidate: 1,
      file: 0,
    });

    expect(atLimit).toHaveLength(8);
    await expect(overLimit).rejects.toThrow(CHIME);
  });
});

describe('withAudioFileCheck', () => {
  // The picker with Coin alone.
  const ONE_FILE_ARGS = {
    ...PICKER_ARGS,
    moments: [
      {
        ...PICKER_ARGS.moments[0],
        candidates: [PICKER_ARGS.moments[0].candidates[0]],
      },
    ],
  };

  const unreadable = Object.assign(
    new Error(`EACCES: permission denied, stat '${COIN}'`),
    { code: 'EACCES' },
  );

  it.each([
    {
      name: 'missing',
      files: async (): Promise<Pick<Files, 'stat'>> => createMemoryFiles(),
      holds: [] as string[],
    },
    {
      name: 'a folder',
      files: async (): Promise<Pick<Files, 'stat'>> => {
        const files = createMemoryFiles();
        await files.makeFolder(COIN);
        return files;
      },
      holds: [] as string[],
    },
    {
      name: 'unreadable',
      files: async (): Promise<Pick<Files, 'stat'>> => ({
        stat: () => Promise.reject(unreadable),
      }),
      holds: ['EACCES'],
    },
  ])(
    'returns an error naming the path for a file that is missing or a folder ($name)',
    async ({ files, holds }) => {
      const inner = fakeInner();
      const session = withAudioFileCheck(inner, parse, await files());

      const result = await session.call(OPEN_AUDIO_PICKER_TOOL, ONE_FILE_ARGS, {
        toolUseId: null,
        signal: live(),
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(
        text.startsWith(
          `moments[1].candidates[1].files[1] '${COIN}' is not a file`,
        ),
      ).toBe(true);
      for (const part of holds) {
        expect(text).toContain(part);
      }
      expect(inner.call).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: 'every file present',
      tool: OPEN_AUDIO_PICKER_TOOL,
      args: ONE_FILE_ARGS,
      aborted: false,
      stats: 1,
    },
    {
      name: 'malformed args',
      tool: OPEN_AUDIO_PICKER_TOOL,
      args: { heading: 'Shop sounds', moments: [] },
      aborted: false,
      stats: 0,
    },
    {
      name: 'collect_last_audio_picker',
      tool: COLLECT_AUDIO_PICKER_TOOL,
      args: { wait: false },
      aborted: false,
      stats: 0,
    },
    {
      name: 'a signal aborted before the call',
      tool: OPEN_AUDIO_PICKER_TOOL,
      args: ONE_FILE_ARGS,
      aborted: true,
      stats: 0,
    },
  ])(
    'hands the call to inner unchanged ($name)',
    async ({ tool, args, aborted, stats }) => {
      const files = createMemoryFiles();
      await files.writeBytes(COIN, new Uint8Array([1]));
      const stat = vi.spyOn(files, 'stat');
      const inner = fakeInner();
      const controller = new AbortController();
      if (aborted) {
        controller.abort();
      }
      const context = { toolUseId: 'use-1', signal: controller.signal };

      const result = await withAudioFileCheck(inner, parse, files).call(
        tool,
        args,
        context,
      );

      expect(result).toBe(OK);
      expect(inner.call).toHaveBeenCalledWith(tool, args, context);
      expect(stat).toHaveBeenCalledTimes(stats);
    },
  );

  it("a later call waits for an earlier open to finish its check before reaching inner, but not for inner's answer to it", async () => {
    const files = createMemoryFiles();
    await files.writeBytes(COIN, new Uint8Array([1]));
    const statted = Promise.withResolvers<void>();
    const checked = {
      stat: (path: string) => statted.promise.then(() => files.stat(path)),
    };
    const inner = fakeInner();
    // The open's answer never comes, as a picker waiting on the user's send.
    inner.call.mockImplementationOnce(() => new Promise(() => {}));
    const session = withAudioFileCheck(inner, parse, checked);
    const context = { toolUseId: null, signal: live() };

    void session.call(OPEN_AUDIO_PICKER_TOOL, ONE_FILE_ARGS, context);
    const collected = session.call(
      COLLECT_AUDIO_PICKER_TOOL,
      { wait: false },
      context,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(inner.call).not.toHaveBeenCalled();
    statted.resolve();

    await expect(collected).resolves.toBe(OK);
    expect(inner.call.mock.calls.map(([name]) => name)).toEqual([
      OPEN_AUDIO_PICKER_TOOL,
      COLLECT_AUDIO_PICKER_TOOL,
    ]);
  });

  it('end() ends inner once', () => {
    const inner = fakeInner();

    withAudioFileCheck(inner, parse, createMemoryFiles()).end();

    expect(inner.end).toHaveBeenCalledTimes(1);
  });
});
