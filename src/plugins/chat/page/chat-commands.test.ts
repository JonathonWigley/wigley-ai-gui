import { describe, expect, it } from 'vitest';
import type {
  ChatEntry,
  ChatImage,
  SessionControl,
} from '../../../contracts/agent';
import type { ScrollStep, TextEditor } from '../../../contracts/editor';
import type { ChatSessionState, SlashCommandContext } from '../contract';
import { createAttachments } from './attachments';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
import {
  type ChatCommandDeps,
  chatCommandHandlers,
  fillComposer,
  putBack,
  sendQueuedNow,
} from './chat-commands';
import type { ChatSession, ChatTabs, PermissionActions } from './chat-view';
import type { ListStop } from './activity-runs';
import type { EntryListStop, TranscriptScroll } from './entry-list';
import type { ImageViewer } from './image-viewer';
import type { Picker, PickerRequest } from './picker';
import type { SignInDialog } from './sign-in-dialog';
import { createSlashCommands, type SlashCommands } from './slash-commands';

const mode: SessionControl = {
  id: 'mode',
  label: 'Mode',
  choices: [
    { value: 'auto', label: 'Auto' },
    { value: 'plan', label: 'Plan' },
  ],
  value: 'auto',
};

const userEntry: ChatEntry = {
  id: 'entry-1',
  at: 1000,
  kind: 'user',
  text: 'hi',
  images: [],
  raw: [],
};

const activityStop: ListStop = {
  kind: 'activity',
  runId: 'activity:tool-1',
  steps: [
    {
      id: 'tool-1',
      at: 1000,
      kind: 'tool',
      toolUseId: 'use-1',
      name: 'Read',
      input: {},
      summary: 'a.ts',
      result: null,
      raw: [],
    },
  ],
};

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const jpeg: ChatImage = { mediaType: 'image/jpeg', data: 'anBn' };
const gif: ChatImage = { mediaType: 'image/gif', data: 'Z2lm' };

// `scrollBy` records each step and direction in `scrolls` and answers with
// `scroll`; `latest` counts each call in `latest`.
function session(
  running: boolean,
  scroll: TranscriptScroll = { moved: true, atEnd: false, following: false },
) {
  const counts = {
    scrolls: [] as [ScrollStep, 1 | -1][],
    latest: 0,
  };
  const state: ChatSessionState = {
    sessionId: 'row-1',
    projectDir: '/Users/u/dev/app',
    profile: 'work',
    entries: [],
    controls: [mode],
    activity: 'working',
    commands: [],
    running,
    queued: [],
    repo: 'app',
    branch: 'main',
  };
  const entries = {
    scrollBy(step: ScrollStep, direction: 1 | -1) {
      counts.scrolls.push([step, direction]);
      return scroll;
    },
    latest() {
      counts.latest += 1;
    },
  } as ChatSession['entries'];
  const shown: ChatSession = {
    sessionId: 'row-1',
    name: 'app',
    state,
    running,
    box: {} as TextEditor,
    isBoxFocused: () => false,
    attachments: createAttachments(),
    entries,
    enterStop: () => null,
  };
  return Object.assign(shown, { counts });
}

// Entries focused on `entry`'s stop, as `focusedOnStop`.
function focusedOn(entry: ChatEntry) {
  return focusedOnStop({ kind: 'entry', entry });
}

// Entries focused on `stop`: `focused` and `move` answer with it, and
// `toggleFocused` counts each call in `toggles` and answers that it expanded
// `stop`.
function focusedOnStop(stop: EntryListStop) {
  const counts = { toggles: 0 };
  const entries = {
    focused: () => stop,
    move: () => stop,
    toggleFocused() {
      counts.toggles++;
      return { stop, result: 'expanded' as const };
    },
  } as Partial<ChatSession['entries']> as ChatSession['entries'];
  return Object.assign(entries, { counts });
}

// Lets a settled invoke's handlers run.
async function flush() {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

// A message box holding `text`, which `setText` replaces.
function box(text: string) {
  const held = { text };
  const editor = {
    text: () => held.text,
    setText: (next: string) => {
      held.text = next;
    },
  } as unknown as TextEditor;
  return Object.assign(editor, { held });
}

// The handlers over one shown session, and the `deps` they run with;
// `invoked` records each call to chat main, `opened` each picker request,
// `viewed` each image viewer opening, `revealed` each session the tabs
// reveal, `marked` each session the tabs mark sent, `toasts` each toast and
// `toastTones` its tone. Every invoke
// resolves, or rejects with `refusal` when one is given. With `visible`
// false no Chat tab is the visible tab. `slashCommands` holds the app slash
// commands send matches. `close` removes the session from the tabs.
function setUp(
  shown: ChatSession,
  refusal?: Error,
  visible = true,
  slashCommands: SlashCommands = createSlashCommands(),
) {
  const invoked: unknown[][] = [];
  const opened: PickerRequest<unknown>[] = [];
  const logs: string[] = [];
  const toasts: string[] = [];
  const toastTones: string[] = [];
  const viewed: { images: readonly ChatImage[]; index: number }[] = [];
  const revealed: string[] = [];
  const marked: string[] = [];
  let isOpen = true;
  const tabs = {
    reveal: (sessionId: string) => revealed.push(sessionId),
    markSent: (sessionId: string) => marked.push(sessionId),
    visibleSessionId: () => (visible ? shown.sessionId : null),
    session: (sessionId: string) =>
      isOpen && sessionId === shown.sessionId ? shown : undefined,
    sessionOfEditor: () => undefined,
  } as unknown as ChatTabs;
  const picker = {
    open<T>(request: PickerRequest<T>) {
      opened.push(request as PickerRequest<unknown>);
    },
  } as Picker;
  const deps: ChatCommandDeps = {
    tabs,
    channel: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return refusal === undefined
          ? Promise.resolve()
          : Promise.reject(refusal);
      },
    } as unknown as ChatCommandDeps['channel'],
    permissions: {} as PermissionActions,
    reasonBox: {} as ReasonBox,
    confirm: {} as CloseConfirm,
    picker,
    signIn: {} as SignInDialog,
    slashCommands,
    viewer: {
      open(images: readonly ChatImage[], index: number) {
        viewed.push({ images, index });
      },
    } as ImageViewer,
    toast: (text, tone) => {
      toasts.push(text);
      toastTones.push(tone);
    },
    log: (source, message) => logs.push(`[${source}] ${message}`),
  };
  return {
    handlers: chatCommandHandlers(deps),
    deps,
    invoked,
    revealed,
    marked,
    opened,
    logs,
    toasts,
    toastTones,
    viewed,
    close: () => {
      isOpen = false;
    },
  };
}

describe('chat commands', () => {
  it.each(['interrupt', 'pickMode', 'pickControl'] as const)(
    '%s on a resting session opens no picker and reaches no process',
    (command) => {
      const run = setUp(session(false));

      run.handlers[command]({});

      expect(run.opened).toEqual([]);
      expect(run.invoked).toEqual([]);
      expect(run.logs).toEqual([expect.stringContaining('no running process')]);
    },
  );

  it('openPreview_Rejects_ToastsError', async () => {
    const run = setUp(session(true), new Error('host id taken'));

    run.handlers.openPreview({});
    await flush();

    expect(run.invoked).toEqual([['openPreview']]);
    expect(run.toasts).toEqual(['Chat preview not opened: host id taken']);
    expect(run.toastTones).toEqual(['error']);
  });

  it('interrupt_runningWorkingSession_interruptsIt', () => {
    const run = setUp(session(true));

    run.handlers.interrupt({});

    expect(run.invoked).toEqual([['interrupt', 'row-1']]);
  });

  it('pickMode_runningSession_sessionBoundPickerSetsTheChoice', () => {
    const run = setUp(session(true));

    run.handlers.pickMode({});
    const [request] = run.opened;
    request.picked(mode.choices[1]);

    expect(request.sessionBound).toBe(true);
    expect(run.invoked).toEqual([['setControl', 'row-1', 'mode', 'plan']]);
  });

  it('pickMode_mainApplies_logsTheChangeOnceMainAnswers', async () => {
    const run = setUp(session(true));

    run.handlers.pickMode({});
    run.opened[0].picked(mode.choices[1]);
    const beforeAnswer = [...run.logs];
    await flush();

    expect(beforeAnswer).toEqual([]);
    expect(run.logs).toEqual([expect.stringContaining('plan')]);
  });

  it('pickMode_mainRefuses_logsAndToastsTheFailureOnly', async () => {
    const run = setUp(
      session(true),
      new Error('session row-1 has no running process'),
    );

    run.handlers.pickMode({});
    run.opened[0].picked(mode.choices[1]);
    await flush();

    expect(run.logs).toEqual([expect.stringContaining('row-1')]);
    expect(run.toasts).toEqual([expect.stringContaining('row-1')]);
  });

  it('pickControl_runningSession_sessionBoundPickerOpensChoices', () => {
    const run = setUp(session(true));

    run.handlers.pickControl({});
    const [controls] = run.opened;
    controls.picked(mode);
    const [, choices] = run.opened;

    expect(controls.sessionBound).toBe(true);
    expect(choices.sessionBound).toBe(true);
    expect(choices.title).toBe('Mode');
  });

  it('toggleEntry_userEntryWithImages_opensViewerAtFirstAndTogglesNothing', () => {
    const entries = focusedOn({ ...userEntry, images: [png, jpeg] });
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({});

    expect(run.viewed).toEqual([{ images: [png, jpeg], index: 0 }]);
    expect(entries.counts.toggles).toBe(0);
  });

  it('toggleEntry_userEntryWithoutImages_togglesAndOpensNoViewer', () => {
    const entries = focusedOn(userEntry);
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({});

    expect(entries.counts.toggles).toBe(1);
    expect(run.viewed).toEqual([]);
  });

  it('toggleEntry_activityLine_logsExpandedActivityLine', () => {
    const entries = focusedOnStop(activityStop);
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({});

    expect(entries.counts.toggles).toBe(1);
    expect(run.logs).toEqual(['[chat] expanded activity line']);
  });

  it('toggleEntry_pendingRow_pullsItBack', () => {
    const entries = focusedOnStop({
      kind: 'queued',
      message: { id: 'q-2', text: 'later', images: [], sentEntryId: null },
    });
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({});

    expect(run.invoked).toEqual([['pullBack', 'row-1', 'q-2']]);
    expect(entries.counts.toggles).toBe(0);
  });

  it.each([
    {
      given: 'two unsent queued',
      queued: [
        { id: 'q-1', sentEntryId: null },
        { id: 'q-2', sentEntryId: null },
      ],
      invoked: [['pullBack', 'row-1', 'q-2']],
      logs: ['[chat] pulling back a pending message in app'],
    },
    {
      given: 'the newest sent, the older unsent',
      queued: [
        { id: 'q-1', sentEntryId: null },
        { id: 'q-2', sentEntryId: 'entry-7' },
      ],
      invoked: [['pullBack', 'row-1', 'q-1']],
      logs: ['[chat] pulling back a pending message in app'],
    },
    {
      given: 'every queued sent',
      queued: [
        { id: 'q-1', sentEntryId: 'entry-6' },
        { id: 'q-2', sentEntryId: 'entry-7' },
      ],
      invoked: [],
      logs: ['[chat] no pending message in app'],
    },
    {
      given: 'none queued',
      queued: [],
      invoked: [],
      logs: ['[chat] no pending message in app'],
    },
  ])(
    'pullBackQueued given $given pulls back the newest unsent',
    ({ queued, invoked, logs }) => {
      const shown = session(true);
      const state = {
        ...shown.state,
        queued: queued.map((row) => ({ ...row, text: row.id, images: [] })),
      };
      const run = setUp(Object.assign(shown, { state }));

      run.handlers.pullBackQueued({});

      expect(run.invoked).toEqual(invoked);
      expect(run.logs).toEqual(logs);
    },
  );

  const pendingStop: EntryListStop = {
    kind: 'queued',
    message: { id: 'q-2', text: 'later', images: [], sentEntryId: null },
  };

  it.each([
    {
      given: 'a pending row focused, the box unfocused',
      focused: pendingStop,
      boxFocused: false,
      typed: 'draft',
      invoked: [['sendNow', 'row-1', 'q-2']],
      left: 'draft',
      marked: [],
    },
    {
      given: 'a pending row focused, text in the focused box',
      focused: pendingStop,
      boxFocused: true,
      typed: 'now',
      invoked: [['sendAllNow', 'row-1', { text: 'now', images: [] }]],
      left: '',
      marked: ['row-1'],
    },
    {
      given: 'a pending row focused, the focused box empty',
      focused: pendingStop,
      boxFocused: true,
      typed: '',
      invoked: [['sendAllNow', 'row-1', null]],
      left: '',
      marked: [],
    },
    {
      given: 'an entry focused, text in the unfocused box',
      focused: { kind: 'entry', entry: userEntry } as EntryListStop,
      boxFocused: false,
      typed: 'now',
      invoked: [['sendAllNow', 'row-1', { text: 'now', images: [] }]],
      left: '',
      marked: ['row-1'],
    },
    {
      given: 'an app slash command in the focused box',
      focused: pendingStop,
      boxFocused: true,
      typed: '/status',
      invoked: [],
      left: '',
      marked: ['row-1'],
    },
  ])(
    'sendNow given $given sends the row or the box',
    async ({ focused, boxFocused, typed, invoked, left, marked }) => {
      const commands = createSlashCommands();
      commands.add({ name: 'status', description: 'Show', run: () => {} });
      const message = box(typed);
      const entries = focusedOnStop(focused);
      const shown = Object.assign(session(true), {
        box: message,
        entries: Object.assign(entries, { latest: () => undefined }),
        isBoxFocused: () => boxFocused,
      });
      const run = setUp(shown, undefined, true, commands);

      run.handlers.sendNow({});
      await flush();

      expect(run.invoked).toEqual(invoked);
      expect(message.held.text).toBe(left);
      expect(run.marked).toEqual(marked);
    },
  );

  it('sendQueuedNow_MainRejects_LogsTheFailure', async () => {
    const run = setUp(session(true), new Error('session gone'));

    sendQueuedNow(run.deps, { sessionId: 'row-1', name: 'app' }, 'q-2');
    await flush();

    expect(run.logs).toEqual([
      '[chat] sending a pending message now in app',
      '[chat] sendNow failed: session gone',
    ]);
  });

  it.each([
    {
      case: 'at the last stop, a stop takes it',
      atLastStop: true,
      takenBy: 'agent-strip.strip',
      offered: 1,
      moves: 0,
      logs: [],
    },
    {
      case: 'at the last stop, none takes it',
      atLastStop: true,
      takenBy: null,
      offered: 1,
      moves: 1,
      logs: ['[chat] focused activity line'],
    },
    {
      case: 'not at the last stop',
      atLastStop: false,
      takenBy: 'agent-strip.strip',
      offered: 0,
      moves: 1,
      logs: ['[chat] focused activity line'],
    },
  ])('nextEntry_$case', ({ atLastStop, takenBy, offered, moves, logs }) => {
    const counts = { offered: 0, moves: 0 };
    const entries = {
      isAtLastStop: () => atLastStop,
      move() {
        counts.moves++;
        return activityStop;
      },
    } as Partial<ChatSession['entries']> as ChatSession['entries'];
    const shown = Object.assign(session(true), {
      entries,
      enterStop() {
        counts.offered++;
        return takenBy;
      },
    });
    const run = setUp(shown);

    run.handlers.nextEntry({});

    expect(counts).toEqual({ offered, moves });
    expect(run.logs).toEqual(logs);
  });

  it.each([
    {
      command: 'halfPageDown',
      scroll: { moved: true, atEnd: true, following: true },
      step: ['halfPage', 1],
    },
    {
      command: 'halfPageUp',
      scroll: { moved: true, atEnd: false, following: false },
      step: ['halfPage', -1],
    },
    {
      command: 'halfPageDown',
      scroll: { moved: false, atEnd: true, following: true },
      step: ['halfPage', 1],
    },
    {
      command: 'lineUp',
      scroll: { moved: true, atEnd: false, following: false },
      step: ['line', -1],
    },
    {
      command: 'lineDown',
      scroll: { moved: true, atEnd: true, following: true },
      step: ['line', 1],
    },
  ] as const)(
    '$command over $scroll scrolls the transcript',
    ({ command, scroll, step }) => {
      const shown = session(true, scroll);
      const run = setUp(shown);

      run.handlers[command]({});

      expect(shown.counts.scrolls).toEqual([step]);
    },
  );

  it('halfPageDown_noChatTabShown_scrollsNothingAndLogsIt', () => {
    const shown = session(true);
    const run = setUp(shown, undefined, false);

    run.handlers.halfPageDown({});
    run.handlers.halfPageUp({});
    run.handlers.lineDown({});

    expect(shown.counts.scrolls).toEqual([]);
    expect(run.logs).toHaveLength(3);
  });

  it('send_AppCommand_RunsAndClearsBox', () => {
    const ran: SlashCommandContext[] = [];
    const commands = createSlashCommands();
    commands.add({
      name: 'login',
      description: 'Sign in',
      run: (context) => {
        ran.push(context);
      },
    });
    const message = box('  /login  ');
    const shown = Object.assign(session(true), { box: message });
    const run = setUp(shown, undefined, true, commands);

    run.handlers.send({});

    expect(ran).toEqual([{ sessionId: 'row-1', profile: 'work', args: '' }]);
    expect(run.invoked).toEqual([]);
    expect(message.held.text).toBe('');
    expect(run.marked).toEqual(['row-1']);
  });

  it('send_AppCommandRejects_Toasts', async () => {
    const commands = createSlashCommands();
    commands.add({
      name: 'logout',
      description: 'Sign out',
      run: () => Promise.reject(new Error('no network')),
    });
    const shown = Object.assign(session(true), { box: box('/logout') });
    const run = setUp(shown, undefined, true, commands);

    run.handlers.send({});
    await flush();

    expect(run.toasts).toEqual([expect.stringContaining('no network')]);
    expect(run.invoked).toEqual([]);
  });

  it('send_UnregisteredSlash_SendsToTheAgent', () => {
    const shown = Object.assign(session(true), { box: box('/model opus') });
    const run = setUp(shown);

    run.handlers.send({});

    expect(run.invoked).toEqual([
      ['send', 'row-1', { text: '/model opus', images: [] }],
    ]);
  });

  it.each([
    {
      given: 'nothing new in the box',
      handler: 'send' as const,
      method: 'send',
      closedSince: false,
      typedSince: '',
      attachedSince: [],
      text: 'hi',
      images: [png],
    },
    {
      given: 'text and an image added since',
      handler: 'send' as const,
      method: 'send',
      closedSince: false,
      typedSince: 'more',
      attachedSince: [jpeg],
      text: 'hi\nmore',
      images: [png, jpeg],
    },
    {
      given: 'the session closed since',
      handler: 'send' as const,
      method: 'send',
      closedSince: true,
      typedSince: 'more',
      attachedSince: [jpeg],
      text: 'more',
      images: [jpeg],
    },
    {
      given: 'sent now from the focused box, nothing new in it',
      handler: 'sendNow' as const,
      method: 'sendAllNow',
      closedSince: false,
      typedSince: '',
      attachedSince: [],
      text: 'hi',
      images: [png],
    },
  ])(
    'send_MainRejects_ToastsAndPutsTheMessageBack given $given',
    async ({
      handler,
      method,
      closedSince,
      typedSince,
      attachedSince,
      text,
      images,
    }) => {
      const message = box('hi');
      const entries = focusedOnStop({ kind: 'entry', entry: userEntry });
      const shown = Object.assign(session(false), {
        box: message,
        entries: Object.assign(entries, { latest: () => undefined }),
        isBoxFocused: () => true,
      });
      shown.attachments.add(png);
      const run = setUp(shown, new Error('profile gone'));

      run.handlers[handler]({});
      message.held.text = typedSince;
      for (const image of attachedSince) {
        shown.attachments.add(image);
      }
      if (closedSince) {
        run.close();
      }
      await flush();

      expect(run.toasts).toEqual(['Message not sent: profile gone']);
      expect(run.logs).toContainEqual(`[chat] ${method} failed: profile gone`);
      expect(message.held.text).toBe(text);
      expect(shown.attachments.images()).toEqual(images);
      expect(run.marked).toEqual([]);
    },
  );

  it('send_ImagesOnly_Sends', async () => {
    const shown = Object.assign(session(true), { box: box('') });
    shown.attachments.add(png);
    const run = setUp(shown);

    run.handlers.send({});
    await flush();

    expect(run.invoked).toEqual([
      ['send', 'row-1', { text: '', images: [png] }],
    ]);
    expect(run.marked).toEqual(['row-1']);
  });

  it('putBack_TwoReturnedOverADraft_OldestOnTopImagesAheadOfAttached', () => {
    const message = box('draft');
    const shown = Object.assign(session(true), { box: message });
    shown.attachments.add(jpeg);
    const tabs = { session: () => shown } as unknown as ChatTabs;

    const took = putBack({ tabs }, shown, [
      { text: 'one', images: [png] },
      { text: 'two', images: [gif] },
    ]);

    expect(took).toBe(true);
    expect(message.held.text).toBe('one\ntwo\ndraft');
    expect(shown.attachments.images()).toEqual([png, gif, jpeg]);
  });

  it.each([
    {
      case: 'held session',
      sessionId: 'row-1',
      text: '/wigley:feature ',
      box: '/wigley:feature ',
      revealed: ['row-1'],
      logged: [],
    },
    {
      case: 'unknown session',
      sessionId: 'other',
      text: 'x',
      box: 'draft',
      revealed: [],
      logged: ['[chat] fillComposer for unknown session other ignored'],
    },
  ])(
    'fillComposer_$case',
    ({ sessionId, text, box: expected, revealed, logged }) => {
      const message = box('draft');
      const shown = Object.assign(session(true), { box: message });
      shown.attachments.add(png);
      const run = setUp(shown);

      fillComposer(run.deps, sessionId, text);

      expect(message.held.text).toBe(expected);
      expect(shown.attachments.images()).toEqual([png]);
      expect(run.revealed).toEqual(revealed);
      expect(run.logs).toEqual(logged);
    },
  );

  it.each([{ running: true }, { running: false }])(
    'send with images, running $running, sends to main, clears attachments and marks the row once main accepts',
    async ({ running }) => {
      const shown = Object.assign(session(running), { box: box('hi') });
      shown.attachments.add(png);
      shown.attachments.add(jpeg);
      const run = setUp(shown);

      run.handlers.send({});
      expect(run.marked).toEqual([]);
      await flush();

      expect(run.invoked).toEqual([
        ['send', 'row-1', { text: 'hi', images: [png, jpeg] }],
      ]);
      expect(shown.attachments.images()).toEqual([]);
      expect(shown.counts.latest).toBe(1);
      expect(run.marked).toEqual(['row-1']);
    },
  );

  it('send_AppCommand_KeepsAttachments', () => {
    const commands = createSlashCommands();
    commands.add({ name: 'status', description: 'Show', run: () => undefined });
    const shown = Object.assign(session(true), { box: box('/status') });
    shown.attachments.add(png);
    const run = setUp(shown, undefined, true, commands);

    run.handlers.send({});

    expect(run.invoked).toEqual([]);
    expect(shown.attachments.images()).toEqual([png]);
  });
});
