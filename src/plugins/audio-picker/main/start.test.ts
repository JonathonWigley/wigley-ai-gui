import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  fakeChat,
  fakeEndedEvent,
  fakeSessions,
  previewSessions,
  SUBMITTED,
} from '../../agent-form-fakes.test-support';
import {
  type SessionsMainExports,
  sessionsMainKey,
  textResult,
  type ToolResult,
} from '../../sessions/contract';
import { sessionsMainPart } from '../../sessions/main/start';
import {
  type AudioPickerPayload,
  OPEN_AUDIO_PICKER_TOOL,
  type PresentedAudioPicker,
  SAVED_PICKERS_FOLDER,
} from '../contract';
import { type SamplePickerArgs, samplePickerArgs, sineWav } from './fixtures';
import { createAudioPickerType } from './picker-type';
import { addDriveActions, audioPickerMainPart } from './start';

// Where start.ts writes the sample sounds in the harness's data folder for
// the plugin, `/data/audio-picker`.
const SOUNDS_DIR = '/data/audio-picker/sample-sounds';

// While `gate` is set, the sample write waits on it before writing: start
// writes through `api.data`, which the harness builds over its own memory
// files, so a replaced `services.files` cannot hold the write back.
const sampleWrite = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
}));

vi.mock('./fixtures', async (importOriginal) => {
  const original = await importOriginal<typeof import('./fixtures')>();
  return {
    ...original,
    writeSampleSounds: async (
      data: Parameters<typeof original.writeSampleSounds>[0],
    ) => {
      await sampleWrite.gate;
      return original.writeSampleSounds(data);
    },
  };
});

// The real sessions part, so a drive action's open reaches the contributed
// tool. `homeDir` holds the picker folder.
function startWithSessions(options: {
  homeDir: string;
  isHeadless?: (sessionId: string) => boolean;
}) {
  return startMainPart(audioPickerMainPart, {
    parts: [sessionsMainPart],
    dependencies: [fakeChat(options.isHeadless)],
    drive: true,
    services: {
      homeDir: options.homeDir,
      alerts: { setOpenCount() {} },
      git: { originRepoName: () => Promise.resolve(null) } as never,
    },
  });
}

type Harness = ReturnType<typeof startWithSessions>;

// Sessions whose tool calls are kept in `calls` and never answered.
function recordingSessions() {
  const sessions = fakeSessions();
  const dependency = fakeDependency(
    sessionsMainKey,
    (consumer) =>
      ({
        contributeTools: () => consumer.track({ dispose() {} }),
        addCloseGuard: () => consumer.track({ dispose() {} }),
        connect: sessions.connect,
      }) as unknown as SessionsMainExports,
  );
  return { calls: sessions.calls, dependency };
}

function listedFiles(args: SamplePickerArgs): string[] {
  return createAudioPickerType(posixPaths)
    .parse(args)
    .moments.flatMap((moment) =>
      moment.candidates.flatMap((candidate) => candidate.files),
    );
}

function shownPickers(harness: Harness): PresentedAudioPicker[] {
  return harness.sent
    .filter((sent) => sent.message === 'formShown')
    .map((sent) => sent.data as PresentedAudioPicker);
}

// The drive actions are added once the sample sounds are written.
async function driveActionsAdded(harness: Harness): Promise<void> {
  await vi.waitFor(() =>
    expect(harness.drive?.actions.has('openPicker')).toBe(true),
  );
}

async function openedPicker(harness: Harness): Promise<PresentedAudioPicker> {
  await driveActionsAdded(harness);
  await harness.drive?.run('openPicker', { sessionId: 'a' });
  return vi.waitFor(() => {
    const [shown] = shownPickers(harness);
    expect(shown).toBeDefined();
    return shown;
  });
}

// The latest picker's tool result once it is no longer pending.
function answered(harness: Harness, sessionId: string): Promise<ToolResult> {
  return vi.waitFor(async () => {
    const answer = await harness.drive?.run('answers', { sessionId });
    expect(answer).not.toEqual({ pending: true });
    return answer as ToolResult;
  });
}

// Lets the settled promises' handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('audio-picker drive actions', () => {
  it('openPicker connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(
      drive.host,
      sessions,
      fakeEndedEvent().on,
      samplePickerArgs('/sounds', posixPaths),
    );

    expect(await drive.run('openPicker')).toEqual({
      sessionId: 'drive-audio-picker-1',
      rowId: 'row-drive-audio-picker-1',
    });
    expect(sessions.calls).toEqual([
      [OPEN_AUDIO_PICKER_TOOL, samplePickerArgs('/sounds', posixPaths)],
    ]);
  });

  it('answers is pending until the picker resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(
      drive.host,
      sessions,
      fakeEndedEvent().on,
      samplePickerArgs('/sounds', posixPaths),
    );
    await drive.run('openPicker', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
  });
});

describe('audio-picker main part', () => {
  const homeDir = '/home/user';
  afterEach(() => {
    sampleWrite.gate = null;
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(audioPickerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      services: { homeDir },
    });
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    // The real sessions part throws on a tool name still contributed.
    await harness.restart();
    await harness.stop();
  });

  it("openPicker opens the sample picker from the plugin's data folder, whose files exist", async () => {
    const sessions = recordingSessions();
    const harness = startMainPart(audioPickerMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
      drive: true,
      services: { homeDir },
    });
    await driveActionsAdded(harness);

    await harness.drive?.run('openPicker');

    const args = samplePickerArgs(SOUNDS_DIR, posixPaths);
    expect(sessions.calls[0]).toEqual([OPEN_AUDIO_PICKER_TOOL, args]);
    const stats = await Promise.all(
      listedFiles(args).map((file) => harness.files.stat(file)),
    );
    expect(stats.map((stat) => stat?.isFolder)).toEqual(stats.map(() => false));
    await harness.stop();
  });

  it('a candidate file missing from disk makes the open call an error', async () => {
    const harness = startWithSessions({ homeDir });
    await driveActionsAdded(harness);
    const picker = {
      heading: 'Missing file',
      moments: [
        {
          title: 'Button tap',
          reason: 'A click.',
          recommend: 1,
          candidates: [
            {
              name: 'gone',
              library: 'Sample library',
              files: ['/home/missing.wav'],
              play: 'one-shot',
              volume: 1,
            },
          ],
        },
      ],
    };

    await harness.drive?.run('openPicker', { sessionId: 'm', picker });
    const result = await answered(harness, 'm');

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('/home/missing.wav');
    expect(shownPickers(harness)).toEqual([]);
    await harness.stop();
  });

  it("readAudio serves an open picker's file and refuses after finish", async () => {
    const harness = startWithSessions({ homeDir });
    const shown = await openedPicker(harness);
    const readFirst = () =>
      harness.invoke('readAudio', shown.sessionId, {
        moment: 0,
        candidate: 0,
        file: 0,
      }) as Promise<Uint8Array>;

    await expect(readFirst()).resolves.toEqual(sineWav(880, 0.15));

    harness.invoke('finish', shown.formId, { kind: 'cancelled', body: {} });
    await vi.waitFor(() => expect(readFirst()).rejects.toThrow());
    await harness.stop();
  });

  it.each([
    { name: 'added once it lands', stopsFirst: false, added: true },
    {
      name: 'none after a stop before it lands',
      stopsFirst: true,
      added: false,
    },
  ])(
    'drive actions wait on the sample write ($name)',
    async ({ stopsFirst, added }) => {
      const written = Promise.withResolvers<void>();
      sampleWrite.gate = written.promise;
      const harness = startMainPart(audioPickerMainPart, {
        parts: [sessionsMainPart],
        dependencies: [fakeChat()],
        drive: true,
        services: { homeDir },
      });
      await flush();
      expect(harness.drive?.actions.has('openPicker')).toBe(false);

      if (stopsFirst) {
        await harness.stop();
      }
      written.resolve();
      await flush();

      expect(harness.drive?.actions.has('openPicker')).toBe(added);
      if (!stopsFirst) {
        await harness.stop();
      }
    },
  );

  it("a headless session's picker comes back auto_answered and shows nothing", async () => {
    const harness = startWithSessions({ homeDir, isHeadless: () => true });
    const files = listedFiles(samplePickerArgs(SOUNDS_DIR, posixPaths));
    await vi.waitFor(async () => {
      const stats = await Promise.all(
        files.map((file) => harness.files.stat(file)),
      );
      expect(stats.every((stat) => stat !== null)).toBe(true);
    });
    await driveActionsAdded(harness);

    await harness.drive?.run('openPicker', { sessionId: 'h' });
    const result = await answered(harness, 'h');

    const payload = result.structuredContent as unknown as AudioPickerPayload;
    expect(payload.outcome).toBe('auto_answered');
    expect(
      payload.picks?.map((pick) => [
        pick.moment,
        pick.choice,
        pick.candidate?.name,
      ]),
    ).toEqual([
      ['Button tap', 1, 'tap_a'],
      ['Room hum', 1, 'hum'],
    ]);
    expect(shownPickers(harness)).toEqual([]);
    await harness.stop();
  });

  it('mayStop names the open picker until it resolves', async () => {
    const harness = startWithSessions({ homeDir });
    const shown = await openedPicker(harness);

    expect(harness.started().mayStop?.()).toBe(
      `Finish or cancel ${shown.label}'s audio picker first`,
    );
    harness.invoke('finish', shown.formId, { kind: 'cancelled', body: {} });
    expect(harness.started().mayStop?.()).toBeNull();

    await harness.stop();
  });

  // Breaks if the quit does not wait for the queued write.
  it('a quit leaves the open picker open on disk and on the page, for the agent to send again', async () => {
    const harness = startWithSessions({ homeDir });
    const pickersDir = posixPaths.join(homeDir, SAVED_PICKERS_FOLDER);
    const held = Promise.withResolvers<void>();
    const write = harness.files.write;
    vi.spyOn(harness.files, 'write').mockImplementation(async (path, text) => {
      if (path.startsWith(pickersDir)) {
        await held.promise;
      }
      await write(path, text);
    });
    await openedPicker(harness);

    let isStopped = false;
    const stopped = harness.stop('quit').then(() => {
      isStopped = true;
    });
    await flush();
    expect(isStopped).toBe(false);
    held.resolve();
    await stopped;

    const outcomes = await Promise.all(
      (await harness.files.list(pickersDir)).map(
        async (entry) =>
          JSON.parse(
            await harness.files.read(posixPaths.join(pickersDir, entry.path)),
          ).outcome,
      ),
    );
    expect(outcomes).toEqual(['open']);
    expect(
      harness.sent.filter((sent) => sent.message === 'formClosed'),
    ).toEqual([]);
  });

  // Breaks if the sample write settling after the stop still adds drive
  // actions to the stopped part.
  it('a stop before the sample write settles adds no drive actions', async () => {
    const written = Promise.withResolvers<void>();
    sampleWrite.gate = written.promise;
    const harness = startWithSessions({ homeDir });
    await harness.stop();

    written.resolve();
    await flush();

    expect(harness.drive?.actions.has('openPicker')).toBe(false);
  });

  // Breaks if a preview that refuses to end is swallowed on a quit.
  it('a quit whose preview refuses to end still rejects once stopped', async () => {
    const sessions = previewSessions();
    sessions.end.mockImplementation(() => {
      throw new Error('end refused');
    });
    const harness = startMainPart(audioPickerMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
      services: { homeDir },
    });
    harness.invoke('openPreview');

    await expect(harness.stop('quit')).rejects.toThrow('end refused');

    expect(sessions.end).toHaveBeenCalledTimes(1);
  });

  it("stop ends the open preview's session", async () => {
    const sessions = previewSessions();
    const harness = startMainPart(audioPickerMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
      services: { homeDir },
    });
    harness.invoke('openPreview');

    await harness.stop();

    expect(sessions.end).toHaveBeenCalledTimes(1);
  });

  it('contributes open_audio_picker with its offline answer and leaves collect_last_audio_picker out', async () => {
    const sessions = previewSessions();
    const harness = startMainPart(audioPickerMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
      services: { homeDir },
    });

    const contribution = sessions.contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === OPEN_AUDIO_PICKER_TOOL),
    );

    expect(contribution?.options).toEqual({
      offline: {
        open_audio_picker: {
          result: textResult(
            "The app is closed, so no audio picker was shown. Take each moment's recommended candidate, wire it as its play, volume and pitch say, and list every pick as a Decided notice in your reply.",
          ),
          replay: false,
        },
      },
    });
    expect(contribution?.options?.offline).not.toHaveProperty(
      'collect_last_audio_picker',
    );
    await harness.stop();
  });
});
