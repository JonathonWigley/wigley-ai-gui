import { describe, expect, it, vi } from 'vitest';
import type {
  AgentFormListener,
  AgentFormPresenter,
  PresentedAgentForm,
} from '../../../contracts/agent-forms';
import type { Disposable, Registrations } from '../../../contracts/disposable';
import type { MainPart } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  fakeChat,
  fakeEndedEvent,
  fakeSessions,
  previewSessions,
  SUBMITTED,
} from '../../agent-form-fakes.test-support';
import {
  type AgentSession,
  type SessionsMainExports,
  sessionsMainKey,
  textResult,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import { sessionsMainPart } from '../../sessions/main/start';
import {
  type ConfirmRequest,
  type FormBody,
  formsConfirmsSlot,
  type FormsMainExports,
  type Round,
  SAVED_ROUNDS_FOLDER,
} from '../contract';
import { findingOrigins } from '../finding-origins';
import type { formsManifest } from '../manifest';
import { pollKind } from './kinds/poll-kind.test-support';
import {
  addDriveActions,
  formsMainPart,
  registerLayoutsAfter,
  withShownWaits,
} from './start';

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
        rowId: null,
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

// Sessions faked so a test starts forms' tool session for an app session, as
// a connecting session does: `connect(id)` runs the start forms contributed
// and returns its tool session.
function toolSessions() {
  let start: ((session: AgentSession) => ToolSession) | null = null;
  const dependency = fakeDependency(
    sessionsMainKey,
    (consumer) =>
      ({
        contributeTools: (
          _tools: unknown,
          contributed: (session: AgentSession) => ToolSession,
        ) => {
          start = contributed;
          return consumer.track({ dispose() {} });
        },
        addCloseGuard: () => consumer.track({ dispose() {} }),
        mark() {},
        label: () => null,
        release() {},
      }) as unknown as SessionsMainExports,
  );
  return {
    dependency,
    connect(id: string): ToolSession {
      if (start === null) {
        throw new Error('forms contributed no tools');
      }
      return start({
        id,
        info: {
          sessionId: `host-${id}`,
          projectDir: '/work',
          harness: 'claude',
          rowId: null,
        },
      });
    },
  };
}

// Forms over `toolSessions`, with the main exports a dependent gets.
function startWithToolSessions() {
  const sessions = toolSessions();
  const harness = startMainPart(formsMainPart, {
    dependencies: [fakeChat(), sessions.dependency],
    services: {
      homeDir: '/home/user',
      alerts: { setOpenCount() {} },
      git: { originRepoName: () => Promise.resolve(null) } as never,
    },
  });
  const forms = harness
    .started()
    .exports?.(createRegistrations()) as FormsMainExports;
  return { harness, sessions, forms };
}

const CONFIRM_REQUEST: ConfirmRequest = {
  title: 'Trash notes.md',
  detail: 'Moves docs/notes.md to the trash.',
  subject: { toolName: 'app command docs.trash', input: 'notes.md' },
};

// The confirm round's one question answered Allow.
const ALLOW_BODY: FormBody = {
  note: '',
  answers: [
    {
      index: 1,
      choice: 1,
      not_applicable: false,
      notes: '',
      dont_ask: false,
      dont_ask_reason: '',
    },
  ],
  finding_answers: [],
  notice_comments: [],
};

// The confirm round's one question answered Deny.
const DENY_BODY: FormBody = {
  ...ALLOW_BODY,
  answers: ALLOW_BODY.answers.map((answer) => ({ ...answer, choice: 2 })),
};

// An agent round of one question, opened ahead of a confirm.
const FIRST_ROUND_ARGS = {
  heading: 'Pick a name',
  overview: 'The file needs a name.',
  questions: [
    {
      title: 'Name',
      summary: 'Which name the file takes.',
      context: 'Two names fit.',
      choices: ['notes.md', 'log.md'],
      recommend: 1,
      rationale: 'It says what the file holds.',
    },
  ],
};

// What a confirmsSlot row's `end` ends the confirm's round with.
interface ConfirmEnd {
  harness: ReturnType<typeof startWithToolSessions>['harness'];
  formId: string;
  abort: AbortController;
  toolSession: ToolSession;
}

function shownRounds(
  sent: readonly { message: string; data: unknown }[],
): PresentedAgentForm<Round, FormBody>[] {
  return sent
    .filter((each) => each.message === 'formShown')
    .map((each) => each.data as PresentedAgentForm<Round, FormBody>);
}

function live(): AbortSignal {
  return new AbortController().signal;
}

describe('forms main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(formsMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
    });
    await flush();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    // The real sessions part throws on a tool name still contributed.
    await harness.restart();
    await harness.stop();
  });

  it('a start that throws after registering the built-in origins takes them back out', () => {
    const { dependency } = previewSessions();
    const refusing = {
      ...dependency,
      exports: (consumer: Registrations) => ({
        ...(dependency.exports(consumer) as SessionsMainExports),
        contributeTools: () => {
          throw new Error('tools refused');
        },
      }),
    };

    expect(() =>
      startMainPart(formsMainPart, { dependencies: [fakeChat(), refusing] }),
    ).toThrow('tools refused');
    expect(findingOrigins.list()).toEqual([]);
  });

  it("stop ends the open preview's session", async () => {
    const sessions = previewSessions();
    const harness = startMainPart(formsMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
    });
    harness.invoke('openPreview');

    await harness.stop();

    expect(sessions.end).toHaveBeenCalledTimes(1);
  });

  it('contributes ask_round with its offline answer and leaves collect_last_round out', async () => {
    const sessions = previewSessions();
    const harness = startMainPart(formsMainPart, {
      dependencies: [fakeChat(), sessions.dependency],
    });

    const contribution = sessions.contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === 'ask_round'),
    );

    expect(contribution?.options).toEqual({
      offline: {
        ask_round: {
          result: textResult(
            "The app is closed, so no round was shown. Take each item's recommended pick and list every pick as a Decided notice in your reply.",
          ),
          replay: false,
        },
      },
    });
    expect(contribution?.options?.offline).not.toHaveProperty(
      'collect_last_round',
    );
    await harness.stop();
  });

  it('stop closes each open round, releases its row and settles its call with the error', async () => {
    const homeDir = '/home/user';
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
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    const answers = harness.drive?.actions.get('answers');
    await harness.drive?.run('openRound', { sessionId: 'a' });
    await harness.drive?.run('openRound', { sessionId: 'b' });
    await flush();
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
  });

  // Breaks if the quit does not wait for the queued write.
  it('a quit leaves each open round open on disk and in the window, for the relay to send again', async () => {
    const homeDir = '/home/user';
    const harness = startMainPart(formsMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    const roundsDir = posixPaths.join(homeDir, SAVED_ROUNDS_FOLDER);
    const held = Promise.withResolvers<void>();
    const write = harness.files.write;
    vi.spyOn(harness.files, 'write').mockImplementation(async (path, text) => {
      if (path.startsWith(roundsDir)) {
        await held.promise;
      }
      await write(path, text);
    });
    await harness.drive?.run('openRound', { sessionId: 'a' });
    await flush();

    let isStopped = false;
    const stopped = harness.stop('quit').then(() => {
      isStopped = true;
    });
    await flush();
    expect(isStopped).toBe(false);
    held.resolve();
    await stopped;

    const outcomes = await Promise.all(
      (await harness.files.list(roundsDir)).map(
        async (entry) =>
          JSON.parse(
            await harness.files.read(posixPaths.join(roundsDir, entry.path)),
          ).outcome,
      ),
    );
    expect(outcomes).toEqual(['open']);
    expect(
      harness.sent.filter((sent) => sent.message === 'formClosed'),
    ).toEqual([]);
  });

  it('mayStop names the open round until it resolves', async () => {
    const homeDir = '/home/user';
    const harness = startMainPart(formsMainPart, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    await harness.drive?.run('openRound', { sessionId: 'a' });
    await flush();
    const [shown] = harness.sent
      .filter((sent) => sent.message === 'formShown')
      .map((sent) => sent.data as { formId: string; label: string });

    expect(harness.started().mayStop?.()).toBe(
      `Finish or cancel ${shown.label}'s round first`,
    );
    harness.invoke('finish', shown.formId, { kind: 'cancelled', body: {} });
    expect(harness.started().mayStop?.()).toBeNull();

    await harness.stop();
  });

  it("headlessChat_AutoAnswersItsSessionsRounds_ButNotThePreview's", async () => {
    const homeDir = '/home/user';
    const asked: string[] = [];
    const harness = startMainPart(formsMainPart, {
      parts: [sessionsMainPart],
      dependencies: [
        fakeChat((sessionId) => {
          asked.push(sessionId);
          return true;
        }),
      ],
      drive: true,
      services: {
        homeDir,
        alerts: { setOpenCount() {} },
        git: { originRepoName: () => Promise.resolve(null) } as never,
      },
    });
    const shownCount = () =>
      harness.sent.filter((sent) => sent.message === 'formShown').length;

    const opened = (await harness.drive?.run('openRound', {
      sessionId: 'a',
    })) as { rowId: string };
    await flush();
    const answers = (await harness.drive?.run('answers', {
      sessionId: 'a',
    })) as { content: { text: string }[] };

    expect(asked).toEqual([opened.rowId]);
    expect(JSON.parse(answers.content[0]?.text ?? '{}')).toMatchObject({
      outcome: 'auto_answered',
    });
    expect(shownCount()).toBe(0);

    harness.invoke('openPreview');
    await flush();

    expect(shownCount()).toBe(1);
    expect(asked).toEqual([opened.rowId]);
    await harness.stop();
  });

  it("puts a kind registered through its exports in the ask_round schema, and takes it out with the consumer's registrations", async () => {
    const contributed: ToolDefinition[][] = [];
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
                  contributeTools(
                    ...args: Parameters<typeof provided.contributeTools>
                  ) {
                    contributed.push(args[0]);
                    return provided.contributeTools(...args);
                  },
                }
              : provided;
          }) as typeof api.dependency,
        }),
    };
    const harness = startMainPart(spied, {
      parts: [sessionsMainPart],
      dependencies: [fakeChat()],
    });
    const handles: Disposable[] = [];
    const consumer: Registrations = {
      track: (handle) => {
        handles.push(handle);
        return handle;
      },
    };
    const askRoundFields = () => {
      const askRound = contributed
        .at(-1)
        ?.find((each) => each.name === 'ask_round');
      return Object.keys(
        askRound?.inputSchema.properties as Record<string, unknown>,
      );
    };
    const exports = harness.started().exports?.(consumer) as FormsMainExports;

    exports.registerKind(pollKind);
    expect(askRoundFields()).toContain('polls');

    for (const handle of handles) {
      handle.dispose();
    }
    expect(askRoundFields()).not.toContain('polls');
    await harness.stop();
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
      dependencies: [fakeChat()],
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

  it.each([
    {
      case: "the caller's own of two sessions",
      connects: ['app-a', 'app-b'],
      endsFirst: false,
      sessionId: 'app-b',
    },
    {
      case: "a newer tool session's, after the older one ended",
      connects: ['app-a', 'app-a'],
      endsFirst: true,
      sessionId: 'app-a',
    },
  ])(
    "confirm opens the round in the caller's live forms session: $case",
    async ({ connects, endsFirst, sessionId }) => {
      const { harness, sessions, forms } = startWithToolSessions();
      const [first] = connects.map((id) => sessions.connect(id));
      if (endsFirst) {
        first?.end();
      }

      const allowed = forms.confirm(sessionId, CONFIRM_REQUEST, live(), null);
      await flush();
      const shown = shownRounds(harness.sent);
      expect(shown.map((round) => round.sessionId)).toEqual([sessionId]);
      expect(shown[0]?.form.heading).toBe(CONFIRM_REQUEST.title);
      harness.invoke('finish', shown[0]?.formId, {
        kind: 'submitted',
        body: ALLOW_BODY,
      });

      await expect(allowed).resolves.toBe(true);
      await harness.stop();
    },
  );

  it.each([
    { case: 'an unknown id', sessionId: 'app-unknown', endsFirst: false },
    {
      case: 'an id after its tool session ended',
      sessionId: 'app-a',
      endsFirst: true,
    },
  ])(
    'confirm rejects for a session with no tool session: $case',
    async ({ sessionId, endsFirst }) => {
      const { harness, sessions, forms } = startWithToolSessions();
      const toolSession = sessions.connect('app-a');
      if (endsFirst) {
        toolSession.end();
      }

      await expect(
        forms.confirm(sessionId, CONFIRM_REQUEST, live(), null),
      ).rejects.toThrow(`no forms session for ${sessionId}`);
      await harness.stop();
    },
  );

  // Breaks if the confirm's round matches an earlier one: the service would
  // hand back the Allow at once, or pre-pick it in the new round's draft.
  it('a second identical confirm after an Allow opens a fresh round with no pre-picked choice', async () => {
    const { harness, sessions, forms } = startWithToolSessions();
    sessions.connect('app-a');
    const first = forms.confirm('app-a', CONFIRM_REQUEST, live(), null);
    await flush();
    harness.invoke('finish', shownRounds(harness.sent)[0]?.formId, {
      kind: 'submitted',
      body: ALLOW_BODY,
    });
    await expect(first).resolves.toBe(true);

    const abort = new AbortController();
    let isSettled = false;
    const second = forms
      .confirm('app-a', CONFIRM_REQUEST, abort.signal, null)
      .finally(() => {
        isSettled = true;
      });
    await flush();

    const shown = shownRounds(harness.sent);
    expect(shown).toHaveLength(2);
    expect(isSettled).toBe(false);
    expect(shown[1]?.draft?.answers[0]?.choice ?? 0).toBe(0);
    abort.abort();
    await expect(second).resolves.toBe(false);
    await harness.stop();
  });

  // Breaks if a key outlives its round, or if the key is not the page's round
  // id.
  it.each([
    {
      case: 'submitted Allow',
      end: ({ harness, formId }: ConfirmEnd) =>
        harness.invoke('finish', formId, {
          kind: 'submitted',
          body: ALLOW_BODY,
        }),
    },
    {
      case: 'submitted Deny',
      end: ({ harness, formId }: ConfirmEnd) =>
        harness.invoke('finish', formId, {
          kind: 'submitted',
          body: DENY_BODY,
        }),
    },
    {
      case: 'cancelled',
      end: ({ harness, formId }: ConfirmEnd) =>
        harness.invoke('finish', formId, {
          kind: 'cancelled',
          body: ALLOW_BODY,
        }),
    },
    { case: 'aborted', end: ({ abort }: ConfirmEnd) => abort.abort() },
    {
      case: 'failed',
      end: ({ toolSession }: ConfirmEnd) => toolSession.end(),
    },
  ])(
    'confirmsSlot_HoldsTheRoundWhileOpen_ThenDeletesIt: $case',
    async ({ end }) => {
      const { harness, sessions, forms } = startWithToolSessions();
      const toolSession = sessions.connect('app-a');
      const confirms = harness.state.read(formsConfirmsSlot, 'test');
      const abort = new AbortController();

      const confirmed = forms.confirm(
        'app-a',
        CONFIRM_REQUEST,
        abort.signal,
        null,
      );
      await flush();
      const formId = shownRounds(harness.sent)[0]?.formId ?? '';
      expect(confirms.get(formId)).toEqual({
        sessionId: 'app-a',
        subject: CONFIRM_REQUEST.subject,
      });

      end({ harness, formId, abort, toolSession });
      await Promise.allSettled([confirmed]);

      expect(confirms.all().size).toBe(0);
      await harness.stop();
    },
  );

  it.each([
    {
      case: 'a null subject',
      ask: (forms: FormsMainExports, signal: AbortSignal) =>
        forms.confirm(
          'app-a',
          { ...CONFIRM_REQUEST, subject: null },
          signal,
          null,
        ),
    },
    {
      case: 'confirmSample',
      ask: (forms: FormsMainExports, signal: AbortSignal) =>
        forms.confirmSample('app-a', CONFIRM_REQUEST, signal),
    },
  ])('confirmsSlot_HoldsNothing: $case', async ({ ask }) => {
    const { harness, sessions, forms } = startWithToolSessions();
    sessions.connect('app-a');
    const abort = new AbortController();

    const confirmed = ask(forms, abort.signal);
    await flush();

    expect(shownRounds(harness.sent)).toHaveLength(1);
    expect(harness.state.read(formsConfirmsSlot, 'test').all().size).toBe(0);
    abort.abort();
    await confirmed;
    await harness.stop();
  });

  // Breaks if the key is set when `confirm` is called rather than when its
  // round shows, or if the tracker's presenter stops forwarding `show`.
  it('confirmsSlot_QueuedConfirm_HoldsNoKeyUntilItShows', async () => {
    const { harness, sessions, forms } = startWithToolSessions();
    const toolSession = sessions.connect('app-a');
    const confirms = harness.state.read(formsConfirmsSlot, 'test');
    void toolSession.call('ask_round', FIRST_ROUND_ARGS, {
      toolUseId: null,
      signal: live(),
    });
    await flush();
    const abort = new AbortController();

    const confirmed = forms.confirm(
      'app-a',
      CONFIRM_REQUEST,
      abort.signal,
      null,
    );
    await flush();
    expect(confirms.all().size).toBe(0);

    harness.invoke('finish', shownRounds(harness.sent)[0]?.formId, {
      kind: 'cancelled',
      body: {},
    });
    await flush();
    const shown = shownRounds(harness.sent);
    expect(shown).toHaveLength(2);
    expect([...confirms.all()]).toEqual([
      [
        shown[1]?.formId,
        { sessionId: 'app-a', subject: CONFIRM_REQUEST.subject },
      ],
    ]);

    abort.abort();
    await confirmed;
    await harness.stop();
  });

  // Breaks if start stops clearing the keys an earlier start left: that start's
  // writer no longer writes, so nothing else would delete them and the page
  // would draw a verdict for a round that is gone.
  it('confirmsSlot_OpenConfirmAcrossARestart_StartClearsItsKey', async () => {
    const { harness, sessions, forms } = startWithToolSessions();
    sessions.connect('app-a');
    const confirms = harness.state.read(formsConfirmsSlot, 'test');
    const abort = new AbortController();
    const confirmed = forms.confirm(
      'app-a',
      CONFIRM_REQUEST,
      abort.signal,
      null,
    );
    await flush();
    expect(confirms.all().size).toBe(1);

    // Stopping does not settle the open confirm, so the test settles it once
    // the part is down; the key stays standing.
    await harness.stop();
    abort.abort();
    await Promise.allSettled([confirmed]);
    expect(confirms.all().size).toBe(1);

    await harness.restart();
    expect(confirms.all().size).toBe(0);
    await harness.stop();
  });

  it('confirmsSlot_NoFormsSession_PublishesNothing', async () => {
    const { harness, forms } = startWithToolSessions();

    await expect(
      forms.confirm('app-z', CONFIRM_REQUEST, live(), null),
    ).rejects.toThrow('no forms session for app-z');
    expect(harness.state.read(formsConfirmsSlot, 'test').all().size).toBe(0);
    await harness.stop();
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

// A presenter that records the ids of the forms it shows and closes.
function recordingPresenter() {
  const shownIds: string[] = [];
  const closedIds: string[] = [];
  const presenter: AgentFormPresenter<string, string> = {
    show: (form) => shownIds.push(form.formId),
    close: (formId) => closedIds.push(formId),
  };
  return { presenter, shownIds, closedIds };
}

const NO_LISTENER: AgentFormListener<string> = {
  draft: () => Promise.resolve(),
  finish: () => undefined,
  cancel: () => undefined,
};

function formOf(sessionId: string, formId: string) {
  return { formId, sessionId, label: 'label', form: 'form', draft: null };
}

describe('withShownWaits', () => {
  it.each([
    {
      case: 'a form of the session shows',
      shows: 'a',
      aborts: false,
      settles: true,
    },
    {
      case: 'only another session shows',
      shows: 'b',
      aborts: false,
      settles: false,
    },
    {
      case: 'the wait aborted before the show',
      shows: 'a',
      aborts: true,
      settles: false,
    },
  ])(
    'shownSettles_Is_$settles when $case',
    async ({ shows, aborts, settles }) => {
      const waits = withShownWaits(recordingPresenter().presenter);
      const abort = new AbortController();
      let didSettle = false;
      void waits.shown('a', abort.signal).then(() => {
        didSettle = true;
      });

      if (aborts) {
        abort.abort();
      }
      waits.presenter.show(formOf(shows, 'f1'), NO_LISTENER);
      await flush();

      expect(didSettle).toBe(settles);
    },
  );

  it('show_ForwardsToThePresenter', () => {
    const { presenter, shownIds } = recordingPresenter();

    withShownWaits(presenter).presenter.show(formOf('a', 'f1'), NO_LISTENER);

    expect(shownIds).toEqual(['f1']);
  });

  it('close_ForwardsToThePresenter', () => {
    const { presenter, closedIds } = recordingPresenter();

    withShownWaits(presenter).presenter.close('f1');

    expect(closedIds).toEqual(['f1']);
  });
});
