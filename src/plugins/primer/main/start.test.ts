import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
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
import { sessionsMainPart } from '../../sessions/main/start';
import { SAVED_PRIMERS_FOLDER } from '../contract';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import { addDriveActions, primerMainPart } from './start';

describe('primer drive actions', () => {
  it('openPrimer connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    expect(await drive.run('openPrimer')).toEqual({
      sessionId: 'drive-primer-1',
      rowId: 'row-drive-primer-1',
    });
    expect(sessions.connectedInfo).toEqual([
      {
        sessionId: 'drive-primer-1',
        projectDir: 'drive',
        harness: 'claude',
      },
    ]);
    expect(sessions.calls).toEqual([['open_primer', SAMPLE_PRIMER_ARGS]]);
  });

  it('openPrimer keeps an explicit null projectDir', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await drive.run('openPrimer', { projectDir: null });

    expect(sessions.connectedInfo[0]?.projectDir).toBeNull();
  });

  it('openPrimer reuses a live session and connects a fresh one once it ended', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    addDriveActions(drive.host, sessions, ended.on);
    await drive.run('openPrimer', { sessionId: 's' });
    await drive.run('openPrimer', { sessionId: 's' });
    expect(sessions.connectedInfo).toHaveLength(1);

    ended.emit('row-s');
    await drive.run('openPrimer', { sessionId: 's' });

    expect(sessions.connectedInfo).toHaveLength(2);
  });

  it('openPrimer rejects a field of the wrong type', async () => {
    const drive = fakeDriveHost();
    addDriveActions(drive.host, fakeSessions(), fakeEndedEvent().on);

    await expect(drive.run('openPrimer', { sessionId: 1 })).rejects.toThrow(
      'sessionId',
    );
    await expect(drive.run('openPrimer', 'x')).rejects.toThrow('args');
  });

  it('answers is pending until the primer resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openPrimer', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
    await expect(drive.run('answers', {})).rejects.toThrow('sessionId');
  });
});

// Lets an open run once the primer folder's first read settles.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('primer main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(primerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
    });
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    // The real sessions part throws on a tool name still contributed.
    await harness.restart();
    await harness.stop();
  });

  it('stop removes the drive actions and settles each open primer with the error', async () => {
    const homeDir = '/home/user';
    const harness = startMainPart(primerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    const answers = harness.drive?.actions.get('answers');
    await harness.drive?.run('openPrimer', { sessionId: 'a' });
    await harness.drive?.run('openPrimer', { sessionId: 'b' });
    await flush();

    await harness.stop();

    expect(
      harness.sent.filter((sent) => sent.message === 'formClosed'),
    ).toHaveLength(2);
    expect([...(harness.drive?.actions.keys() ?? [])]).toEqual([]);
    await expect(answers?.run({ sessionId: 'a' })).rejects.toThrow(
      /open_primer/,
    );
    await expect(answers?.run({ sessionId: 'b' })).rejects.toThrow(
      /open_primer/,
    );
  });

  // Breaks if the quit does not wait for the queued write.
  it('a quit leaves each open primer open on disk and in the window, for the relay to send again', async () => {
    const homeDir = '/home/user';
    const harness = startMainPart(primerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    await harness.drive?.run('openPrimer', { sessionId: 'a' });
    await flush();
    const primersDir = posixPaths.join(homeDir, SAVED_PRIMERS_FOLDER);

    await harness.stop('quit');

    const outcomes = await Promise.all(
      (await harness.files.list(primersDir)).map(
        async (entry) =>
          JSON.parse(
            await harness.files.read(posixPaths.join(primersDir, entry.path)),
          ).outcome,
      ),
    );
    expect(outcomes).toEqual(['open']);
    expect(
      harness.sent.filter((sent) => sent.message === 'formClosed'),
    ).toEqual([]);
  });

  it('mayStop names the open primer until it resolves', async () => {
    const homeDir = '/home/user';
    const harness = startMainPart(primerMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    await harness.drive?.run('openPrimer', { sessionId: 'a' });
    await flush();
    const [shown] = harness.sent
      .filter((sent) => sent.message === 'formShown')
      .map((sent) => sent.data as { formId: string; label: string });

    expect(harness.started().mayStop?.()).toBe(
      `Finish or cancel ${shown.label}'s primer first`,
    );
    harness.invoke('finish', shown.formId, { kind: 'cancelled', body: {} });
    expect(harness.started().mayStop?.()).toBeNull();

    await harness.stop();
  });

  it("stop ends the open preview's session", async () => {
    const sessions = previewSessions();
    const harness = startMainPart(primerMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
    });
    harness.invoke('openPreview');

    await harness.stop();

    expect(sessions.end).toHaveBeenCalledTimes(1);
  });
});
