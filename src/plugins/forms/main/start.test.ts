import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MainPart } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type ConnectedSession,
  type SessionInfo,
  type SessionsMainExports,
  sessionsMainKey,
  type ToolResult,
} from '../../sessions/contract';
import { sessionsMainPart } from '../../sessions/main/start';
import type { formsManifest } from '../manifest';
import { addDriveActions, formsMainPart, registerLayoutsAfter } from './start';

// Sessions whose `ask_round` calls wait until the test answers them.
function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const answers: ((result: ToolResult) => void)[] = [];
  return {
    connectedInfo,
    answers,
    connect(info: SessionInfo): ConnectedSession {
      connectedInfo.push(info);
      const id = `row-${String(info.sessionId)}`;
      return {
        session: { id, info },
        call: () =>
          new Promise<ToolResult>((resolve) => {
            answers.push(resolve);
          }),
        end: () => undefined,
      };
    },
  };
}

// The sessions plugin's ended event, which the test emits by row id.
function fakeEndedEvent() {
  const listeners: ((rowId: string) => void)[] = [];
  return {
    on: (listener: (rowId: string) => void) => listeners.push(listener),
    emit: (rowId: string) => {
      for (const listener of listeners) {
        listener(rowId);
      }
    },
  };
}

const SUBMITTED: ToolResult = { content: [{ type: 'text', text: 'done' }] };

describe('forms drive actions', () => {
  it('openRound connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    expect(await drive.run('openRound')).toEqual({
      sessionId: 'drive-forms-1',
      rowId: 'row-drive-forms-1',
    });
    expect(sessions.connectedInfo).toEqual([
      {
        sessionId: 'drive-forms-1',
        projectDir: 'drive',
        harness: 'claude',
        deadlineSeconds: null,
      },
    ]);
  });

  it('openRound keeps an explicit null projectDir', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await drive.run('openRound', { projectDir: null });

    expect(sessions.connectedInfo[0]?.projectDir).toBeNull();
  });

  it('openRound reuses a live session and connects a fresh one once it ended', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    addDriveActions(drive.host, sessions, ended.on);
    await drive.run('openRound', { sessionId: 's' });
    await drive.run('openRound', { sessionId: 's' });
    expect(sessions.connectedInfo).toHaveLength(1);

    ended.emit('row-s');
    await drive.run('openRound', { sessionId: 's' });

    expect(sessions.connectedInfo).toHaveLength(2);
  });

  it('openRound rejects a field of the wrong type', async () => {
    const drive = fakeDriveHost();
    addDriveActions(drive.host, fakeSessions(), fakeEndedEvent().on);

    await expect(drive.run('openRound', { sessionId: 1 })).rejects.toThrow(
      'sessionId',
    );
    await expect(drive.run('openRound', 'x')).rejects.toThrow('args');
  });

  it('answers is pending until the round resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openRound', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
    await expect(drive.run('answers', {})).rejects.toThrow('sessionId');
  });

});

// A write the test lands or fails, a register that records each registration
// and its dispose (or throws when `failure` is set), and the log.
function registrationSetup(failure: Error | null = null) {
  let land: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const written = new Promise<void>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  const events: string[] = [];
  const logLines: string[] = [];
  const layouts = registerLayoutsAfter(
    written,
    () => {
      if (failure !== null) {
        throw failure;
      }
      events.push('registered');
      return { dispose: () => events.push('disposed') };
    },
    (message) => logLines.push(message),
  );
  return { land, fail, layouts, events, logLines };
}

// Lets the settled promises' handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const fakeChat = fakeDependency(
  chatMainKey,
  () => ({ profileOf: () => null }) as unknown as ChatMainExports,
);

// Sessions faked so a test sees the `end` of the connection the preview holds.
function previewSessions() {
  const end = vi.fn();
  const dependency = fakeDependency(
    sessionsMainKey,
    (consumer) =>
      ({
        contributeTools: () => consumer.track({ dispose() {} }),
        addCloseGuard: () => consumer.track({ dispose() {} }),
        activate() {},
        connect: (info: SessionInfo): ConnectedSession => ({
          session: { id: 'preview-row', info },
          call: () => Promise.reject(new Error('the preview calls no tool')),
          end,
        }),
      }) as unknown as SessionsMainExports,
  );
  return { end, dependency };
}

describe('forms main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(formsMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat],
    });
    await flush();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });

    // The real sessions part throws on a tool name still contributed.
    await harness.restart();
    await harness.stop();
  });

  it("stop ends the open preview's session", async () => {
    const sessions = previewSessions();
    const harness = startMainPart(formsMainPart, {
      dependencies: [fakeChat, sessions.dependency],
    });
    harness.invoke('openPreview');

    await harness.stop();

    expect(sessions.end).toHaveBeenCalledTimes(1);
  });

  it('stop closes each open round, releases its row and settles its call with the error', async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'wigley-forms-stop-'));
    const released: string[] = [];
    const spied: MainPart<typeof formsManifest> = {
      manifest: formsMainPart.manifest,
      start: (api) =>
        formsMainPart.start({
          ...api,
          dependency: ((key: typeof sessionsMainKey) => {
            const provided = api.dependency(key);
            return key === sessionsMainKey
              ? {
                  ...provided,
                  release(sessionId: string) {
                    released.push(sessionId);
                    provided.release(sessionId);
                  },
                }
              : provided;
          }) as typeof api.dependency,
        }),
    };
    const harness = startMainPart(spied, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat],
      drive: true,
      services: {
        homeDir,
        alerts: { announce() {}, setOpenCount() {} },
      },
    });
    const answers = harness.drive?.actions.get('answers');
    await harness.drive?.run('openRound', { sessionId: 'a' });
    await harness.drive?.run('openRound', { sessionId: 'b' });
    const shown = harness.sent
      .filter((sent) => sent.message === 'formShown')
      .map((sent) => sent.data as { formId: string; sessionId: string });
    expect(shown).toHaveLength(2);

    await harness.stop();

    expect(
      harness.sent.filter((sent) => sent.message === 'formClosed'),
    ).toEqual(
      expect.arrayContaining(
        shown.map(({ formId }) => ({
          message: 'formClosed',
          data: { formId, byFinish: false },
        })),
      ),
    );
    expect([...released].sort()).toEqual(
      shown.map(({ sessionId }) => sessionId).sort(),
    );
    expect([...(harness.drive?.actions.keys() ?? [])]).toEqual([]);
    await expect(answers?.run({ sessionId: 'a' })).rejects.toThrow(/ask_round/);
    await expect(answers?.run({ sessionId: 'b' })).rejects.toThrow(/ask_round/);
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('stop before the fixture write lands registers no layout', async () => {
    let land: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      land = resolve;
    });
    const register = vi.fn();
    const spied: MainPart<typeof formsManifest> = {
      manifest: formsMainPart.manifest,
      start: (api) =>
        formsMainPart.start({
          ...api,
          layouts: {
            ...api.layouts,
            register(options) {
              register();
              return api.layouts.register(options);
            },
          },
        }),
    };
    const harness = startMainPart(spied, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat],
      services: { files: { ...createMemoryFiles(), write: () => written } },
    });

    let isStopped = false;
    const stopping = harness.stop().then(() => {
      isStopped = true;
    });
    await flush();
    expect(isStopped).toBe(false);
    land();
    await stopping;

    expect(register).not.toHaveBeenCalled();
    expect(harness.counts().registrations).toBe(0);
    expect(harness.sent).toEqual([]);
  });
});

describe('forms layouts registration', () => {
  it('writeLands_ThenDispose_RegistersThenDisposesIt', async () => {
    const { land, layouts, events } = registrationSetup();

    land();
    await flush();
    await layouts.dispose();

    expect(events).toEqual(['registered', 'disposed']);
  });

  it('disposeBeforeTheWriteLands_RegistersNothing', async () => {
    const { land, layouts, events } = registrationSetup();

    const disposed = layouts.dispose();
    land();
    await disposed;

    expect(events).toEqual([]);
  });

  it.each([
    {
      case: 'the register throws',
      setup: () => registrationSetup(new Error('bad types')),
      settle: (setup: ReturnType<typeof registrationSetup>) => setup.land(),
      reason: 'bad types',
    },
    {
      case: 'the write fails',
      setup: () => registrationSetup(),
      settle: (setup: ReturnType<typeof registrationSetup>) =>
        setup.fail(new Error('disk full')),
      reason: 'disk full',
    },
  ])('logsAndDisposeSettles when $case', async ({ setup, settle, reason }) => {
    const subject = setup();

    settle(subject);
    await flush();

    expect(subject.logLines).toEqual([expect.stringContaining(reason)]);
    await expect(subject.layouts.dispose()).resolves.toBeUndefined();
  });
});
