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
import { type ChatCommandDeps, chatCommandHandlers } from './chat-commands';
import type { ChatSession, ChatTabs, PermissionActions } from './chat-view';
import type { TranscriptScroll } from './entry-list';
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
  kind: 'user',
  text: 'hi',
  images: [],
  raw: [],
};

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const jpeg: ChatImage = { mediaType: 'image/jpeg', data: 'anBn' };

// `scrollBy` records each step and direction in `scrolls` and answers with
// `scroll`.
function session(
  running: boolean,
  scroll: TranscriptScroll = { moved: true, atEnd: false, following: false },
) {
  const counts = {
    scrolls: [] as [ScrollStep, 1 | -1][],
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
  };
  const entries = {
    scrollBy(step: ScrollStep, direction: 1 | -1) {
      counts.scrolls.push([step, direction]);
      return scroll;
    },
  } as ChatSession['entries'];
  const shown: ChatSession = {
    sessionId: 'row-1',
    name: 'app',
    state,
    running,
    box: {} as TextEditor,
    attachments: createAttachments(),
    entries,
  };
  return Object.assign(shown, { counts });
}

// Entries focused on `entry`: `focused` answers with it, and `toggleFocused`
// counts each call in `toggles` and answers that it expanded `entry`.
function focusedOn(entry: ChatEntry) {
  const counts = { toggles: 0 };
  const entries = {
    focused: () => entry,
    toggleFocused() {
      counts.toggles++;
      return { entry, result: 'expanded' as const };
    },
  } as ChatSession['entries'];
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

// The handlers over one shown session; `invoked` records each call to chat
// main, `opened` each picker request, `viewed` each image viewer opening,
// `toasts` each toast and `toastTones` its tone. Every invoke
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
  let isOpen = true;
  const tabs = {
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
    invoked,
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
      closedSince: false,
      typedSince: '',
      attachedSince: [],
      text: 'hi',
      images: [png],
    },
    {
      given: 'text and an image added since',
      closedSince: false,
      typedSince: 'more',
      attachedSince: [jpeg],
      text: 'hi\nmore',
      images: [png, jpeg],
    },
    {
      given: 'the session closed since',
      closedSince: true,
      typedSince: 'more',
      attachedSince: [jpeg],
      text: 'more',
      images: [jpeg],
    },
  ])(
    'send_MainRejects_ToastsAndPutsTheMessageBack given $given',
    async ({ closedSince, typedSince, attachedSince, text, images }) => {
      const message = box('hi');
      const shown = Object.assign(session(false), { box: message });
      shown.attachments.add(png);
      const run = setUp(shown, new Error('profile gone'));

      run.handlers.send({});
      message.held.text = typedSince;
      for (const image of attachedSince) {
        shown.attachments.add(image);
      }
      if (closedSince) {
        run.close();
      }
      await flush();

      expect(run.toasts).toEqual(['Message not sent: profile gone']);
      expect(run.logs).toContainEqual(expect.stringContaining('profile gone'));
      expect(message.held.text).toBe(text);
      expect(shown.attachments.images()).toEqual(images);
    },
  );

  it('send_ImagesOnly_Sends', () => {
    const shown = Object.assign(session(true), { box: box('') });
    shown.attachments.add(png);
    const run = setUp(shown);

    run.handlers.send({});

    expect(run.invoked).toEqual([
      ['send', 'row-1', { text: '', images: [png] }],
    ]);
  });

  it.each([{ running: true }, { running: false }])(
    'send with images, running $running, sends to main and clears attachments',
    ({ running }) => {
      const shown = Object.assign(session(running), { box: box('hi') });
      shown.attachments.add(png);
      shown.attachments.add(jpeg);
      const run = setUp(shown);

      run.handlers.send({});

      expect(run.invoked).toEqual([
        ['send', 'row-1', { text: 'hi', images: [png, jpeg] }],
      ]);
      expect(shown.attachments.images()).toEqual([]);
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
