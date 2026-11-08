import { describe, expect, it } from 'vitest';
import {
  type ChatEntry,
  type ChatImage,
  MAIN_AGENT_ID,
  type SessionControl,
} from '../../../contracts/agent';
import type { CommandArgShape, CommandKey } from '../../../contracts/commands';
import type { ScrollStep, TextEditor } from '../../../contracts/editor';
import type { CommandDecl } from '../../../contracts/plugin';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { checkCommandArg } from '../../../shared/command-args';
import { defaultKeymap } from '../../keymap';
import {
  chatAllowEntryCommand,
  chatDenyEntryCommand,
  chatMoveFocusCommand,
  chatOpenImageCommand,
  chatPullBackMessageCommand,
  chatRemoveImageAtCommand,
  type ChatSessionState,
  chatToggleExpanderCommand,
  chatToggleRunCommand,
  chatToggleSectionCommand,
  type SlashCommandContext,
} from '../contract';
import { chatManifest } from '../manifest';
import { createAttachments } from './attachments';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
import {
  type ChatCommandDeps,
  chatCommandHandlers,
  fillComposer,
  putBack,
  sendQueuedNow,
} from './chat-commands';
import type { ChatSession, ChatTabs } from './chat-view';
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
  delivery: null,
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
      agentId: MAIN_AGENT_ID,
      toolUseId: 'use-1',
      name: 'Read',
      input: {},
      summary: 'a.ts',
      result: null,
      raw: [],
    },
  ],
};

const pendingPermission: ChatEntry = {
  id: 'permission-1',
  at: 1000,
  kind: 'permission',
  toolName: 'Bash',
  input: {},
  answer: null,
  raw: [],
};

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const jpeg: ChatImage = { mediaType: 'image/jpeg', data: 'anBn' };
const gif: ChatImage = { mediaType: 'image/gif', data: 'Z2lm' };

// `scrollBy` records each step and direction in `scrolls` and answers with
// `scroll`; `latest` counts each call in `latest`; `boxChanged` records the
// box's text in `drafts`. `stateFields` replace the session state's.
function session(
  running: boolean,
  scroll: TranscriptScroll = { moved: true, atEnd: false, following: false },
  stateFields: Partial<ChatSessionState> = {},
) {
  const counts = {
    scrolls: [] as [ScrollStep, 1 | -1][],
    latest: 0,
    drafts: [] as string[],
  };
  const state: ChatSessionState = {
    sessionId: 'row-1',
    projectDir: '/Users/u/dev/app',
    profile: 'work',
    entries: [],
    controls: [mode],
    activity: 'working',
    background: 0,
    activeTime: NO_ACTIVE_TIME,
    commands: [],
    running,
    queued: [],
    compaction: null,
    returned: [],
    repo: 'app',
    branch: 'main',
    ...stateFields,
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
    boxChanged: () => counts.drafts.push(shown.box.text()),
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
// `toastTones` its tone, `allowed` each permission entry allowed,
// `answered` each allow or deny with its session and entry, and `clipboard`
// each clipboard write. Every invoke
// resolves, or rejects with `refusal` when one is given. With `visible`
// false no Chat tab is the visible tab. `slashCommands` holds the app slash
// commands send matches. Every clipboard write rejects with `clipboardFailure`
// when one is given. `others` are held sessions whose tabs are not visible.
// `close` removes the shown session from the tabs.
function setUp(
  shown: ChatSession,
  refusal?: Error,
  visible = true,
  slashCommands: SlashCommands = createSlashCommands(),
  clipboardFailure?: Error,
  others: readonly ChatSession[] = [],
) {
  const allowed: string[] = [];
  const answered: [string, string, string][] = [];
  const clipboard: string[] = [];
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
      isOpen && sessionId === shown.sessionId
        ? shown
        : others.find((other) => other.sessionId === sessionId),
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
    permissions: {
      allow: (answeredIn, entry) => {
        allowed.push(entry.id);
        answered.push(['allow', answeredIn.sessionId, entry.id]);
      },
      deny: (answeredIn, entry) => {
        answered.push(['deny', answeredIn.sessionId, entry.id]);
      },
    },
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
    writeClipboard(text) {
      clipboard.push(text);
      return clipboardFailure === undefined
        ? Promise.resolve()
        : Promise.reject(clipboardFailure);
    },
    toast: (text, tone) => {
      toasts.push(text);
      toastTones.push(tone);
    },
    log: (message) => logs.push(message),
  };
  return {
    handlers: chatCommandHandlers(deps),
    deps,
    allowed,
    answered,
    clipboard,
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

      run.handlers[command]({ arg: undefined });

      expect(run.opened).toEqual([]);
      expect(run.invoked).toEqual([]);
      expect(run.logs).toEqual([expect.stringContaining('no running process')]);
    },
  );

  it('openPreview_Rejects_ToastsError', async () => {
    const run = setUp(session(true), new Error('host id taken'));

    run.handlers.openPreview({ arg: undefined });
    await flush();

    expect(run.invoked).toEqual([['openPreview']]);
    expect(run.toasts).toEqual(['Chat preview not opened: host id taken']);
    expect(run.toastTones).toEqual(['error']);
  });

  it('stopAll_InvokesMain', async () => {
    const run = setUp(session(true));

    run.handlers.stopAll({ arg: undefined });
    await flush();

    expect(run.invoked).toEqual([['stopAll']]);
    expect(run.logs).toEqual(['stopping every session']);
  });

  it('stopAll_Rejects_ToastsError', async () => {
    const run = setUp(session(true), new Error('host gone'));

    run.handlers.stopAll({ arg: undefined });
    await flush();

    expect(run.invoked).toEqual([['stopAll']]);
    expect(run.toasts).toEqual(['Sessions not stopped: host gone']);
    expect(run.toastTones).toEqual(['error']);
  });

  it.each([
    {
      given: 'idle with nothing up',
      fields: { activity: 'idle' },
      invoked: [],
      logs: ['nothing to interrupt in app'],
    },
    {
      given: 'idle with a compaction up',
      fields: {
        activity: 'idle',
        compaction: { trigger: 'app', reason: 'a', startedAt: 1 },
      },
      invoked: [['interrupt', 'row-1']],
      logs: ['interrupted app'],
    },
    {
      given: 'idle with a held row',
      fields: {
        activity: 'idle',
        queued: [
          {
            id: 'q-1',
            text: 'held',
            images: [],
            sentEntryId: null,
            holdReason: 'a',
          },
        ],
      },
      invoked: [['interrupt', 'row-1']],
      logs: ['interrupted app'],
    },
    {
      given: 'idle with background work running',
      fields: { activity: 'idle', background: 1 },
      invoked: [['interrupt', 'row-1']],
      logs: ['interrupted app'],
    },
    {
      given: 'working',
      fields: { activity: 'working' },
      invoked: [['interrupt', 'row-1']],
      logs: ['interrupted app'],
    },
  ] satisfies {
    given: string;
    fields: Partial<ChatSessionState>;
    invoked: string[][];
    logs: string[];
  }[])(
    'interrupt_IdleActivity_InterruptsOnlyWithSomethingRunning: $given',
    ({ fields, invoked, logs }) => {
      const run = setUp(session(true, undefined, fields));

      run.handlers.interrupt({ arg: undefined });

      expect(run.invoked).toEqual(invoked);
      expect(run.logs).toEqual(logs);
    },
  );

  it('pickMode_runningSession_sessionBoundPickerSetsTheChoice', () => {
    const run = setUp(session(true));

    run.handlers.pickMode({ arg: undefined });
    const [request] = run.opened;
    request.picked(mode.choices[1]);

    expect(request.sessionBound).toBe(true);
    expect(run.invoked).toEqual([['setControl', 'row-1', 'mode', 'plan']]);
  });

  it('pickMode_mainApplies_logsTheChangeOnceMainAnswers', async () => {
    const run = setUp(session(true));

    run.handlers.pickMode({ arg: undefined });
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

    run.handlers.pickMode({ arg: undefined });
    run.opened[0].picked(mode.choices[1]);
    await flush();

    expect(run.logs).toEqual([expect.stringContaining('row-1')]);
    expect(run.toasts).toEqual([expect.stringContaining('row-1')]);
  });

  it('pickControl_runningSession_sessionBoundPickerOpensChoices', () => {
    const run = setUp(session(true));

    run.handlers.pickControl({ arg: undefined });
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

    run.handlers.toggleEntry({ arg: undefined });

    expect(run.viewed).toEqual([{ images: [png, jpeg], index: 0 }]);
    expect(entries.counts.toggles).toBe(0);
  });

  it('toggleEntry_userEntryWithoutImages_togglesAndOpensNoViewer', () => {
    const entries = focusedOn(userEntry);
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({ arg: undefined });

    expect(entries.counts.toggles).toBe(1);
    expect(run.viewed).toEqual([]);
  });

  it('toggleEntry_activityLine_logsExpandedActivityLine', () => {
    const entries = focusedOnStop(activityStop);
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({ arg: undefined });

    expect(entries.counts.toggles).toBe(1);
    expect(run.logs).toEqual(['expanded activity line']);
  });

  it('toggleEntry_pendingRow_pullsItBack', () => {
    const entries = focusedOnStop({
      kind: 'queued',
      message: {
        id: 'q-2',
        text: 'later',
        images: [],
        sentEntryId: null,
        holdReason: null,
      },
    });
    const shown = Object.assign(session(true), { entries });
    const run = setUp(shown);

    run.handlers.toggleEntry({ arg: undefined });

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
      logs: ['pulling back a pending message in app'],
    },
    {
      given: 'the newest sent, the older unsent',
      queued: [
        { id: 'q-1', sentEntryId: null },
        { id: 'q-2', sentEntryId: 'entry-7' },
      ],
      invoked: [['pullBack', 'row-1', 'q-1']],
      logs: ['pulling back a pending message in app'],
    },
    {
      given: 'every queued sent',
      queued: [
        { id: 'q-1', sentEntryId: 'entry-6' },
        { id: 'q-2', sentEntryId: 'entry-7' },
      ],
      invoked: [],
      logs: ['no pending message in app'],
    },
    {
      given: 'none queued',
      queued: [],
      invoked: [],
      logs: ['no pending message in app'],
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

      run.handlers.pullBackQueued({ arg: undefined });

      expect(run.invoked).toEqual(invoked);
      expect(run.logs).toEqual(logs);
    },
  );

  const pendingStop: EntryListStop = {
    kind: 'queued',
    message: {
      id: 'q-2',
      text: 'later',
      images: [],
      sentEntryId: null,
      holdReason: null,
    },
  };

  const unsentRow = { ...pendingStop.message };
  const sentRow = { ...pendingStop.message, id: 'q-1', sentEntryId: 'e-1' };

  it.each([
    {
      given: 'a pending row focused, the box unfocused',
      focused: pendingStop,
      boxFocused: false,
      typed: 'draft',
      queued: [unsentRow],
      invoked: [['sendNow', 'row-1', 'q-2']],
      left: 'draft',
      marked: [],
      latests: 0,
      logs: ['sending a pending message now in app'],
    },
    {
      given: 'a pending row focused, text in the focused box',
      focused: pendingStop,
      boxFocused: true,
      typed: 'now',
      queued: [unsentRow],
      invoked: [['sendAllNow', 'row-1', { text: 'now', images: [] }]],
      left: '',
      marked: ['row-1'],
      latests: 1,
      logs: ['sending now in app'],
    },
    {
      given: 'a pending row focused and unsent, the focused box empty',
      focused: pendingStop,
      boxFocused: true,
      typed: '',
      queued: [unsentRow],
      invoked: [['sendAllNow', 'row-1', null]],
      left: '',
      marked: [],
      latests: 0,
      logs: ['sending now in app'],
    },
    {
      given: 'only a sent row, the focused box empty',
      focused: { kind: 'entry', entry: userEntry } as EntryListStop,
      boxFocused: true,
      typed: '',
      queued: [sentRow],
      invoked: [],
      left: '',
      marked: [],
      latests: 0,
      logs: ['nothing to send'],
    },
    {
      given: 'an entry focused, text in the unfocused box',
      focused: { kind: 'entry', entry: userEntry } as EntryListStop,
      boxFocused: false,
      typed: 'now',
      queued: [],
      invoked: [['sendAllNow', 'row-1', { text: 'now', images: [] }]],
      left: '',
      marked: ['row-1'],
      latests: 1,
      logs: ['sending now in app'],
    },
    {
      given: 'an app slash command in the focused box',
      focused: pendingStop,
      boxFocused: true,
      typed: '/status',
      queued: [unsentRow],
      invoked: [],
      left: '',
      marked: ['row-1'],
      latests: 0,
      logs: ['ran /status in app'],
    },
  ])(
    'sendNow given $given sends the row or the box',
    async ({
      focused,
      boxFocused,
      typed,
      queued,
      invoked,
      left,
      marked,
      latests,
      logs,
    }) => {
      const commands = createSlashCommands();
      commands.add({ name: 'status', description: 'Show', run: () => {} });
      const message = box(typed);
      const entries = focusedOnStop(focused);
      let latestCalls = 0;
      const shown = session(true);
      Object.assign(shown, {
        state: { ...shown.state, queued },
        box: message,
        entries: Object.assign(entries, {
          latest: () => {
            latestCalls++;
          },
        }),
        isBoxFocused: () => boxFocused,
      });
      const run = setUp(shown, undefined, true, commands);

      run.handlers.sendNow({ arg: undefined });
      await flush();

      expect(run.invoked).toEqual(invoked);
      expect(message.held.text).toBe(left);
      expect(run.marked).toEqual(marked);
      expect(latestCalls).toBe(latests);
      expect(run.logs).toEqual(logs);
    },
  );

  it('sendQueuedNow_MainRejects_LogsTheFailure', async () => {
    const run = setUp(session(true), new Error('session gone'));

    sendQueuedNow(run.deps, { sessionId: 'row-1', name: 'app' }, 'q-2');
    await flush();

    expect(run.logs).toEqual([
      'sending a pending message now in app',
      'sendNow failed: session gone',
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
      logs: ['focused activity line'],
    },
    {
      case: 'not at the last stop',
      atLastStop: false,
      takenBy: 'agent-strip.strip',
      offered: 0,
      moves: 1,
      logs: ['focused activity line'],
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

    run.handlers.nextEntry({ arg: undefined });

    expect(counts).toEqual({ offered, moves });
    expect(run.logs).toEqual(logs);
  });

  it.each([
    {
      command: 'nextMessage',
      calls: ['moveToMessage 1'],
      hasStop: true,
      logs: ['focused activity line'],
    },
    {
      command: 'prevMessage',
      calls: ['moveToMessage -1'],
      hasStop: true,
      logs: ['focused activity line'],
    },
    {
      command: 'toggleRange',
      calls: ['toggleRange'],
      hasStop: true,
      logs: ['toggled the range'],
    },
    {
      command: 'toggleRange',
      calls: ['toggleRange'],
      hasStop: false,
      logs: ['no entries in app'],
    },
  ] as const)(
    '$command calls the list',
    ({ command, calls, hasStop, logs }) => {
      const called: string[] = [];
      const entries = {
        isAtLastStop: () => true,
        moveToMessage(step: 1 | -1) {
          called.push(`moveToMessage ${step}`);
          return activityStop;
        },
        toggleRange() {
          called.push('toggleRange');
          return hasStop;
        },
      } as Partial<ChatSession['entries']> as ChatSession['entries'];
      const shown = Object.assign(session(true), {
        entries,
        enterStop() {
          called.push('enterStop');
          return 'agent-strip.strip';
        },
      });
      const run = setUp(shown);

      run.handlers[command]({ arg: undefined });

      expect(called).toEqual(calls);
      expect(run.logs).toEqual(logs);
    },
  );

  it.each([
    {
      given: 'an open range',
      isOpen: true,
      logs: ['cancelled the range'],
    },
    {
      given: 'no open range',
      isOpen: false,
      logs: ['no range to cancel in app'],
    },
  ])('cancelRange_$given', ({ isOpen, logs }) => {
    const called: string[] = [];
    const entries = {
      cancelRange() {
        called.push('cancelRange');
        return isOpen;
      },
    } as Partial<ChatSession['entries']> as ChatSession['entries'];
    const run = setUp(Object.assign(session(true), { entries }));

    run.handlers.cancelRange({ arg: undefined });

    expect(called).toEqual(['cancelRange']);
    expect(run.logs).toEqual(logs);
    expect(run.toasts).toEqual([]);
  });

  it.each([
    {
      given: 'a pending permission',
      stateEntries: [pendingPermission],
      isRangeOpen: false,
      selected: { text: 'kept', blockCount: 1 },
      failure: undefined,
      allowed: ['permission-1'],
      clipboard: [],
      toasts: [],
      tones: [],
      cancels: 0,
      logs: [],
    },
    {
      given: 'a pending permission and an open range',
      stateEntries: [pendingPermission],
      isRangeOpen: true,
      selected: { text: 'a\n\nb', blockCount: 2 },
      failure: undefined,
      allowed: [],
      clipboard: ['a\n\nb'],
      toasts: ['Copied 2 blocks'],
      tones: ['success'],
      cancels: 1,
      logs: ['copied 2 blocks in app'],
    },
    {
      given: 'no pending permission and a cursor block',
      stateEntries: [],
      isRangeOpen: false,
      selected: { text: 'one block', blockCount: 1 },
      failure: undefined,
      allowed: [],
      clipboard: ['one block'],
      toasts: ['Copied 1 block'],
      tones: ['success'],
      cancels: 1,
      logs: ['copied 1 block in app'],
    },
    {
      given: 'an open range of three blocks',
      stateEntries: [],
      isRangeOpen: true,
      selected: { text: 'a\n\nb\n\nc', blockCount: 3 },
      failure: undefined,
      allowed: [],
      clipboard: ['a\n\nb\n\nc'],
      toasts: ['Copied 3 blocks'],
      tones: ['success'],
      cancels: 1,
      logs: ['copied 3 blocks in app'],
    },
    {
      given: 'an open range and a clipboard write that fails',
      stateEntries: [],
      isRangeOpen: true,
      selected: { text: 'a\n\nb', blockCount: 2 },
      failure: new Error('denied'),
      allowed: [],
      clipboard: ['a\n\nb'],
      toasts: ['Copy failed'],
      tones: ['error'],
      cancels: 0,
      logs: ['copy failed: denied'],
    },
    {
      given: 'a pending permission and an open range with nothing to copy',
      stateEntries: [pendingPermission],
      isRangeOpen: true,
      selected: null,
      failure: undefined,
      allowed: [],
      clipboard: [],
      toasts: ['Nothing to copy'],
      tones: ['info'],
      cancels: 0,
      logs: ['nothing to copy'],
    },
    {
      given: 'a stop with nothing to copy',
      stateEntries: [],
      isRangeOpen: false,
      selected: null,
      failure: undefined,
      allowed: [],
      clipboard: [],
      toasts: [],
      tones: [],
      cancels: 0,
      logs: ['nothing to copy'],
    },
  ])(
    'allowOrCopy_$given',
    async ({
      stateEntries,
      isRangeOpen,
      selected,
      failure,
      allowed,
      clipboard,
      toasts,
      tones,
      cancels,
      logs,
    }) => {
      let cancelled = 0;
      const entries = {
        isRangeOpen: () => isRangeOpen,
        selectedSource: () => selected,
        cancelRange() {
          cancelled++;
          return true;
        },
      } as Partial<ChatSession['entries']> as ChatSession['entries'];
      const shown = Object.assign(
        session(true, undefined, { entries: stateEntries }),
        { entries },
      );
      const run = setUp(shown, undefined, true, undefined, failure);

      run.handlers.allowOrCopy({ arg: undefined });
      await flush();

      expect(run.allowed).toEqual(allowed);
      expect(run.clipboard).toEqual(clipboard);
      expect(run.toasts).toEqual(toasts);
      expect(run.toastTones).toEqual(tones);
      expect(cancelled).toBe(cancels);
      expect(run.logs).toEqual(logs);
    },
  );

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

      run.handlers[command]({ arg: undefined });

      expect(shown.counts.scrolls).toEqual([step]);
    },
  );

  it('halfPageDown_noChatTabShown_scrollsNothingAndLogsIt', () => {
    const shown = session(true);
    const run = setUp(shown, undefined, false);

    run.handlers.halfPageDown({ arg: undefined });
    run.handlers.halfPageUp({ arg: undefined });
    run.handlers.lineDown({ arg: undefined });

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

    run.handlers.send({ arg: undefined });

    expect(ran).toEqual([{ sessionId: 'row-1', profile: 'work', args: '' }]);
    expect(run.invoked).toEqual([]);
    expect(message.held.text).toBe('');
    expect(run.marked).toEqual(['row-1']);
  });

  it.each([
    { message: 'an app command', text: '/login', isAppCommand: true },
    { message: 'a message to the agent', text: 'hello', isAppCommand: false },
  ])('send_clears_the_saved_draft ($message)', async ({ text }) => {
    const commands = createSlashCommands();
    commands.add({ name: 'login', description: 'Sign in', run: () => {} });
    const shown = Object.assign(session(true), { box: box(text) });
    const run = setUp(shown, undefined, true, commands);

    run.handlers.send({ arg: undefined });
    await flush();

    expect(shown.counts.drafts.at(-1)).toBe('');
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

    run.handlers.send({ arg: undefined });
    await flush();

    expect(run.toasts).toEqual([expect.stringContaining('no network')]);
    expect(run.invoked).toEqual([]);
  });

  it('send_UnregisteredSlash_SendsToTheAgent', () => {
    const shown = Object.assign(session(true), { box: box('/model opus') });
    const run = setUp(shown);

    run.handlers.send({ arg: undefined });

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

      run.handlers[handler]({ arg: undefined });
      message.held.text = typedSince;
      for (const image of attachedSince) {
        shown.attachments.add(image);
      }
      if (closedSince) {
        run.close();
      }
      await flush();

      expect(run.toasts).toEqual(['Message not sent: profile gone']);
      expect(run.logs).toContainEqual(`${method} failed: profile gone`);
      expect(message.held.text).toBe(text);
      expect(shown.attachments.images()).toEqual(images);
      expect(run.marked).toEqual([]);
    },
  );

  it('send_ImagesOnly_Sends', async () => {
    const shown = Object.assign(session(true), { box: box('') });
    shown.attachments.add(png);
    const run = setUp(shown);

    run.handlers.send({ arg: undefined });
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
      logged: ['fillComposer for unknown session other ignored'],
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

      run.handlers.send({ arg: undefined });
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

    run.handlers.send({ arg: undefined });

    expect(run.invoked).toEqual([]);
    expect(shown.attachments.images()).toEqual([png]);
  });
  // A held session other than the shown one, whose tab is not visible; its
  // entries record each `moveFocusTo` in `moved`.
  function otherSession(stateFields: Partial<ChatSessionState> = {}) {
    const other = session(true, undefined, {
      sessionId: 'row-2',
      ...stateFields,
    });
    const moved: string[] = [];
    Object.assign(other.entries, {
      moveFocusTo: (stopId: string) => moved.push(stopId) > 0,
    });
    return Object.assign(other, { sessionId: 'row-2', name: 'other', moved });
  }

  const userWithImages = { ...userEntry, images: [png, jpeg, gif] };

  it.each<{
    command: string;
    fields: Partial<ChatSessionState>;
    act(handlers: ReturnType<typeof setUp>['handlers']): unknown;
    effect(
      run: ReturnType<typeof setUp>,
      other: ReturnType<typeof otherSession>,
    ): unknown;
    expected: unknown;
  }>([
    {
      command: 'allowEntry',
      fields: { entries: [pendingPermission] },
      act: (handlers) =>
        handlers.allowEntry({
          arg: { sessionId: 'row-2', entryId: 'permission-1' },
        }),
      effect: (run) => run.answered,
      expected: [['allow', 'row-2', 'permission-1']],
    },
    {
      command: 'denyEntry',
      fields: { entries: [pendingPermission] },
      act: (handlers) =>
        handlers.denyEntry({
          arg: { sessionId: 'row-2', entryId: 'permission-1' },
        }),
      effect: (run) => run.answered,
      expected: [['deny', 'row-2', 'permission-1']],
    },
    {
      command: 'removeImageAt',
      fields: {},
      act: (handlers) =>
        handlers.removeImageAt({ arg: { sessionId: 'row-2', index: 0 } }),
      effect: (_run, other) => other.attachments.images(),
      expected: [jpeg],
    },
    {
      command: 'pullBackMessage',
      fields: {},
      act: (handlers) =>
        handlers.pullBackMessage({
          arg: { sessionId: 'row-2', queuedId: 'q-1' },
        }),
      effect: (run) => run.invoked,
      expected: [['pullBack', 'row-2', 'q-1']],
    },
    {
      command: 'openImage',
      fields: { entries: [userWithImages] },
      act: (handlers) =>
        handlers.openImage({
          arg: { sessionId: 'row-2', entryId: 'entry-1', index: 2 },
        }),
      effect: (run) => run.viewed,
      expected: [{ images: [png, jpeg, gif], index: 2 }],
    },
    {
      command: 'moveFocus',
      fields: {},
      act: (handlers) =>
        handlers.moveFocus({ arg: { sessionId: 'row-2', stopId: 'stop-1' } }),
      effect: (_run, other) => other.moved,
      expected: ['stop-1'],
    },
  ])(
    'clickCommand_ArgNamesAnotherSession_ActsOnThatSession: $command',
    ({ fields, act, effect, expected }) => {
      const other = otherSession(fields);
      other.attachments.add(png);
      other.attachments.add(jpeg);
      const shown = session(true, undefined, { entries: [pendingPermission] });
      shown.attachments.add(gif);
      const run = setUp(shown, undefined, true, undefined, undefined, [other]);

      act(run.handlers);

      expect(effect(run, other)).toEqual(expected);
      expect(shown.attachments.images()).toEqual([gif]);
    },
  );

  it('allowEntry_RangeOpen_AllowsThatEntryAndCopiesNothing', async () => {
    const shown = session(true, undefined, { entries: [pendingPermission] });
    Object.assign(shown.entries, {
      isRangeOpen: () => true,
      selectedSource: () => ({ text: 'copied', blockCount: 1 }),
    });
    const run = setUp(shown);

    run.handlers.allowEntry({
      arg: { sessionId: 'row-1', entryId: 'permission-1' },
    });
    await flush();

    expect(run.allowed).toEqual(['permission-1']);
    expect(run.clipboard).toEqual([]);
  });

  it('denyEntry_NewerOfTwoPending_OpensTheReasonBoxForIt', () => {
    const newer = { ...pendingPermission, id: 'permission-2', at: 2000 };
    const shown = session(true, undefined, {
      entries: [pendingPermission, newer],
    });
    const run = setUp(shown);

    run.handlers.denyEntry({
      arg: { sessionId: 'row-1', entryId: 'permission-2' },
    });

    expect(run.answered).toEqual([['deny', 'row-1', 'permission-2']]);
  });

  it('openImage_UserEntry_OpensItsImagesAtTheIndex', () => {
    const shown = session(true, undefined, { entries: [userWithImages] });
    const run = setUp(shown);

    run.handlers.openImage({
      arg: { sessionId: 'row-1', entryId: 'entry-1', index: 1 },
    });

    expect(run.viewed).toEqual([{ images: [png, jpeg, gif], index: 1 }]);
  });

  const answeredPermission: ChatEntry = {
    ...pendingPermission,
    answer: { allowed: true, reason: null },
  };

  it.each<{
    case: string;
    entries: ChatEntry[];
    act(handlers: ReturnType<typeof setUp>['handlers']): unknown;
    logs: string[];
  }>([
    {
      case: 'unknown session',
      entries: [pendingPermission],
      act: (handlers) =>
        handlers.allowEntry({
          arg: { sessionId: 'gone', entryId: 'permission-1' },
        }),
      logs: ['allowEntry for unknown session gone ignored'],
    },
    {
      case: 'answered permission',
      entries: [answeredPermission],
      act: (handlers) =>
        handlers.allowEntry({
          arg: { sessionId: 'row-1', entryId: 'permission-1' },
        }),
      logs: ['no pending permission permission-1 in app'],
    },
    {
      case: 'entry not a permission',
      entries: [userEntry],
      act: (handlers) =>
        handlers.denyEntry({ arg: { sessionId: 'row-1', entryId: 'entry-1' } }),
      logs: ['no pending permission entry-1 in app'],
    },
    {
      case: 'entry not a user entry',
      entries: [pendingPermission],
      act: (handlers) =>
        handlers.openImage({
          arg: { sessionId: 'row-1', entryId: 'permission-1', index: 0 },
        }),
      logs: ['no image 0 in entry permission-1'],
    },
    {
      case: 'no image at the index',
      entries: [{ ...userEntry, images: [png] }],
      act: (handlers) =>
        handlers.openImage({
          arg: { sessionId: 'row-1', entryId: 'entry-1', index: 1 },
        }),
      logs: ['no image 1 in entry entry-1'],
    },
  ])(
    'clickCommand_TargetGone_LogsAndActsOnNothing: $case',
    ({ entries, act, logs }) => {
      const run = setUp(session(true, undefined, { entries }));

      act(run.handlers);

      expect(run.logs).toEqual(logs);
      expect(run.answered).toEqual([]);
      expect(run.viewed).toEqual([]);
    },
  );
});

// A click command's row: its key, the arg shape its manifest declares, an arg
// of the key's type and a value the shape refuses.
function row<A>(
  key: CommandKey<A>,
  shape: CommandArgShape,
  valid: A,
  invalid: unknown,
) {
  return { id: key.id, shape, valid, invalid };
}

describe('chat click commands', () => {
  it.each([
    row(
      chatAllowEntryCommand,
      { sessionId: 'string', entryId: 'string' },
      { sessionId: 's', entryId: 'e' },
      { sessionId: 's' },
    ),
    row(
      chatDenyEntryCommand,
      { sessionId: 'string', entryId: 'string' },
      { sessionId: 's', entryId: 'e' },
      { sessionId: 's', entryId: 1 },
    ),
    row(
      chatRemoveImageAtCommand,
      { sessionId: 'string', index: 'number' },
      { sessionId: 's', index: 1 },
      { sessionId: 's', index: '1' },
    ),
    row(
      chatToggleRunCommand,
      { sessionId: 'string', runId: 'string' },
      { sessionId: 's', runId: 'r' },
      'r',
    ),
    row(
      chatToggleExpanderCommand,
      { sessionId: 'string', entryId: 'string', place: 'number' },
      { sessionId: 's', entryId: 'e', place: 1 },
      { sessionId: 's', entryId: 'e' },
    ),
    row(
      chatPullBackMessageCommand,
      { sessionId: 'string', queuedId: 'string' },
      { sessionId: 's', queuedId: 'q' },
      { queuedId: 'q' },
    ),
    row(chatToggleSectionCommand, 'string', 'part', 1),
    row(
      chatOpenImageCommand,
      { sessionId: 'string', entryId: 'string', index: 'number' },
      { sessionId: 's', entryId: 'e', index: 0 },
      { sessionId: 's', entryId: 'e', index: '0' },
    ),
    row(
      chatMoveFocusCommand,
      { sessionId: 'string', stopId: 'string' },
      { sessionId: 's', stopId: 'x' },
      undefined,
    ),
  ])(
    'clickCommands_Manifest_DeclareTheirArgAndNoBind: $id',
    ({ id, shape, valid, invalid }) => {
      const declarations = new Map<string, CommandDecl>(
        Object.entries(chatManifest.commands),
      );
      const declared = declarations.get(id.slice('chat.'.length))?.arg;

      expect(declared).toEqual(shape);
      expect(checkCommandArg(id, declared, valid)).toBeNull();
      expect(checkCommandArg(id, declared, invalid)).not.toBeNull();
      expect(defaultKeymap.binds.filter((bind) => bind.command === id)).toEqual(
        [],
      );
    },
  );
});
