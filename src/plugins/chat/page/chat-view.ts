import type { Clock, Timers } from '../../../contracts/ambient';
import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import type {
  EditorHost,
  TextEditor,
  VimMode,
} from '../../../contracts/editor';
import type { ChatEntryKind } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type {
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import type { ChatChannel, ChatSessionState } from '../contract';
import {
  type Attachments,
  createAttachments,
  listenForImages,
} from './attachments';
import { blurFocusedElement, type CloseConfirm } from './chat-dialogs';
import type { ChatLayouts, SurfaceKitDeps } from './chat-layouts';
import {
  applyEntry,
  changedControls,
  folderName,
  isWorking,
  type PermissionEntry,
  tabStatus,
  valueLabel,
} from './chat-state';
import { composerInputOf } from './composer-input';
import { type ComposerSurface, createComposerSurface } from './composer-kit';
import { createEntryList, type EntryList } from './entry-list';
import type { ImageViewer } from './image-viewer';
import { completionWords } from './slash-commands';

export interface ChatView {
  // Shows the session's Chat tab: activates the session (Sessions mode shows),
  // selects the tab, and focuses its box in insert mode with the cursor at
  // the end the next time the tab is the visible tab (at once when it is). A
  // session with no Chat tab yet gets this the moment its tab is added.
  reveal(sessionId: string): void;
  // The session whose Chat tab is the visible tab.
  visibleSessionId(): string | null;
}

// A session as a log line and a call to main name it.
export interface SessionRef {
  sessionId: string;
  name: string;
}

// One held chat session as the commands act on it: its state as chat main
// last sent it, whether its process runs, its message box, the images
// attached to its next message and its entries.
export interface ChatSession extends SessionRef {
  readonly state: ChatSessionState;
  readonly running: boolean;
  box: TextEditor;
  attachments: Attachments;
  entries: Pick<
    EntryList,
    'move' | 'latest' | 'first' | 'focused' | 'toggleFocused' | 'scrollBy'
  >;
}

// The Chat view with what the commands read: the session a box belongs to,
// and a held session by id.
export interface ChatTabs extends ChatView {
  session(sessionId: string): ChatSession | undefined;
  sessionOfEditor(editor: TextEditor): ChatSession | undefined;
}

// `allow` answers a permission entry allowed; `deny` asks for the reason
// first.
export interface PermissionActions {
  allow(session: SessionRef, entry: PermissionEntry): void;
  deny(session: SessionRef, entry: PermissionEntry): void;
}

// The base scope a shown Chat tab sets.
export type ChatTabScope = 'chat';

// `setScope` sets the base scope; `otherSessionShown` runs when the
// Chat tab shown is another session's than the Chat tab shown before;
// `visibleSessionRested` runs when the visible Chat tab's process exits;
// `onSessionRemoved` hears the sessions plugin drop a row's tabs. `run` runs
// a command, as the composer's chips and send button do; `keys` also anchors
// the composer's key hints; `layouts` holds the chat layouts the entries and
// the composer draw with; `paths` names each tab by its project folder.
// `slashCommandNames` reads the app slash commands registered now, which the
// `/` completion offers ahead of the agent's. `viewer` opens a sent message's
// images full size. `timers` and `clock` tick a live activity line's time.
export interface ChatViewDeps extends SurfaceKitDeps {
  channel: PageChannel<ChatChannel>;
  paths: Paths;
  sessions: Pick<SessionsPageExports, 'addTab' | 'activate' | 'closeSession'>;
  onSessionRemoved(listener: (sessionId: string) => void): void;
  editor: EditorHost;
  run(command: CommandId): void;
  layouts: ChatLayouts;
  permissions: PermissionActions;
  confirm: CloseConfirm;
  viewer: Pick<ImageViewer, 'open'>;
  slashCommandNames(): string[];
  setScope(scope: ChatTabScope): void;
  otherSessionShown(): void;
  visibleSessionRested(): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
}

// A held session's Chat tab. `handle` is null until `addTab` returns, and
// `box` until the editor mounts into the attached tab. `composerSize` follows
// the drawn composer's height for as long as the tab is held.
interface HeldTab {
  sessionId: string;
  name: string;
  state: ChatSessionState;
  closeConfirmed: boolean;
  handle: SessionTabHandle | null;
  status: string;
  box: TextEditor | null;
  boxMode: VimMode;
  isBoxFocused: boolean;
  root: HTMLElement;
  entries: EntryList;
  attachments: Attachments;
  composer: ComposerSurface;
  composerSize: ResizeObserver;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

// One Chat tab per chat session main holds, each with its entries and its
// composer (attached images, message box, mode, type hint, running indicator,
// control chips, send), kept up to date from chat main's messages. Each tab is
// selected in its session when added. A layout change draws every tab's
// entries and composer again, each box keeping its text, vim mode and focus.
export function mountChatView(deps: ChatViewDeps): ChatTabs {
  const { log } = deps;
  const tabs = new Map<string, HeldTab>();
  // The kinds whose failed draw has toasted since the layouts were shown.
  const toastedKinds = new Set<ChatEntryKind>();
  deps.layouts.onChange(() => {
    toastedKinds.clear();
    for (const tab of tabs.values()) {
      tab.entries.rebuild(tab.state.entries);
      drawComposer(tab);
    }
  });
  let pendingReveal: string | null = null;
  let lastShownSessionId: string | null = null;

  const focusIfRevealed = (tab: HeldTab) => {
    const isWaiting = pendingReveal === tab.sessionId;
    if (isWaiting && tab.box !== null && tab.handle?.isVisible() === true) {
      pendingReveal = null;
      tab.box.focus({ insertAtEnd: true });
    }
  };
  const showRevealed = (tab: HeldTab) => {
    deps.sessions.activate(tab.sessionId);
    tab.handle?.select();
    focusIfRevealed(tab);
  };

  const add = (state: ChatSessionState) => {
    if (tabs.has(state.sessionId)) {
      return;
    }
    const tab = createTab(state, toastedKinds, deps, {
      // Chat keys act only on the visible Chat tab's session. Every Chat tab
      // sets the same scope, so no pushed dialog hears a base change:
      // `otherSessionShown` closes the session's dialogs.
      shown: (shownTab) => {
        deps.setScope('chat');
        askHistory(shownTab, deps);
        if (
          lastShownSessionId !== null &&
          lastShownSessionId !== shownTab.sessionId
        ) {
          deps.otherSessionShown();
        }
        lastShownSessionId = shownTab.sessionId;
        log('chat', `Chat tab shown in ${shownTab.name}`);
        drawBar(shownTab);
        shownTab.entries.scrollToFocus();
        focusIfRevealed(shownTab);
      },
      beforeClose: (closing) => mayClose(closing, deps),
    });
    tabs.set(state.sessionId, tab);
    if (pendingReveal === tab.sessionId) {
      showRevealed(tab);
    }
  };

  const heldFor = (message: string, sessionId: string) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      log('chat', `${message} for unknown session ${sessionId} ignored`);
    }
    return tab;
  };

  // Listeners first: a session `sessions()` returns after its
  // `sessionStarted` is already held, and adding it again changes nothing.
  const { channel } = deps;
  channel.on('sessionStarted', add);
  channel.on('entry', ({ sessionId, entry }) => {
    const tab = heldFor('entry', sessionId);
    if (tab !== undefined) {
      putEntry(tab, entry, log);
    }
  });
  channel.on('controls', ({ sessionId, controls }) => {
    const tab = heldFor('controls', sessionId);
    if (tab !== undefined) {
      setControls(tab, controls, log);
    }
  });
  channel.on('activity', ({ sessionId, activity }) => {
    const tab = heldFor('activity', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, activity };
      tab.entries.setWorking(isWorking(tab.state));
      log('chat', `${tab.name} is ${activity}`);
      sendStatus(tab, tabStatus(activity));
      drawBar(tab);
    }
  });
  channel.on('commands', ({ sessionId, names }) => {
    const tab = heldFor('commands', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, commands: names };
    }
  });
  channel.on('entries', ({ sessionId, entries }) => {
    const tab = heldFor('entries', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, entries };
      tab.entries.rebuild(entries);
      log('chat', `${entries.length} entries read in ${tab.name}`);
    }
  });
  channel.on('sessionRunning', ({ sessionId }) => {
    const tab = heldFor('sessionRunning', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, running: true };
      tab.entries.setWorking(isWorking(tab.state));
      drawBar(tab);
      log('chat', `${tab.name} running`);
    }
  });
  channel.on('sessionRested', ({ sessionId, error }) => {
    const tab = heldFor('sessionRested', sessionId);
    if (tab === undefined) {
      return;
    }
    tab.state = { ...tab.state, running: false };
    tab.entries.setWorking(isWorking(tab.state));
    drawBar(tab);
    sendStatus(tab, '');
    if (tab.handle?.isVisible() === true) {
      deps.visibleSessionRested();
    }
    if (error === null) {
      log('chat', `${tab.name} rested`);
    } else {
      log('chat', `${tab.name} rested: ${error}`);
      deps.toast(`${tab.name} stopped: ${error}`, 'error');
    }
  });
  deps.onSessionRemoved((sessionId) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    tabs.delete(sessionId);
    tab.box?.destroy();
    tab.composerSize.disconnect();
    tab.composer.dispose();
    tab.entries.dispose();
    if (pendingReveal === sessionId) {
      pendingReveal = null;
    }
    log('chat', `session closed: ${tab.name}`);
  });
  void channel
    .invoke('sessions')
    .then((states) => {
      for (const state of states) {
        add(state);
      }
    })
    .catch((error: unknown) =>
      log('chat', `chat sessions not read: ${errorText(error)}`),
    );

  const visibleTab = () =>
    [...tabs.values()].find((tab) => tab.handle?.isVisible() === true);
  const asSession = (tab: HeldTab | undefined): ChatSession | undefined =>
    tab === undefined || tab.box === null ? undefined : sessionOf(tab, tab.box);

  return {
    reveal(sessionId) {
      pendingReveal = sessionId;
      const tab = tabs.get(sessionId);
      if (tab !== undefined) {
        showRevealed(tab);
      }
    },
    visibleSessionId: () => visibleTab()?.sessionId ?? null,
    session: (sessionId) => asSession(tabs.get(sessionId)),
    sessionOfEditor: (editor) =>
      asSession([...tabs.values()].find((tab) => tab.box === editor)),
  };
}

// Draws the tab's composer through the chat layout in place of its last draw,
// moving the box into it and focusing the box again when it held focus; the
// height observer follows the new composer.
function drawComposer(tab: HeldTab) {
  const hadFocus = tab.isBoxFocused;
  const composer = tab.composer.drawComposer(tab.root, composerInputOf(tab));
  tab.composerSize.disconnect();
  tab.composerSize.observe(composer);
  if (hadFocus) {
    tab.box?.focus();
  }
}

// Draws the bar, or the whole composer again when its update threw.
function drawBar(tab: HeldTab) {
  if (!tab.composer.drawBar(composerInputOf(tab))) {
    drawComposer(tab);
  }
}

// Asks main for the session's earlier conversation each time its tab shows;
// main reads it once, and it arrives as an `entries` message.
function askHistory(tab: HeldTab, deps: ChatViewDeps) {
  void deps.channel
    .invoke('loadHistory', tab.sessionId)
    .catch((error: unknown) => {
      deps.log('chat', `history not loaded: ${errorText(error)}`);
      deps.toast(`history not loaded: ${errorText(error)}`, 'error');
    });
}

// The commands' view of a held tab, reading its state live.
function sessionOf(tab: HeldTab, box: TextEditor): ChatSession {
  return {
    sessionId: tab.sessionId,
    name: tab.name,
    get state() {
      return tab.state;
    },
    get running() {
      return tab.state.running;
    },
    box,
    attachments: tab.attachments,
    entries: tab.entries,
  };
}

// The tab element (`div.chat-tab`: entries, then the floating composer
// holding the attached images' strip, the box and its bar) added to its
// session, with the box's editor mounted once the element is attached. The
// tab then selects itself, so a chat session opens on its Chat tab whichever
// plugin's tab the session got first. `view.shown` may run inside `addTab`,
// before the handle and box are set.
function createTab(
  state: ChatSessionState,
  toastedKinds: Set<ChatEntryKind>,
  deps: ChatViewDeps,
  view: { shown(tab: HeldTab): void; beforeClose(tab: HeldTab): boolean },
): HeldTab {
  const name = folderName(state.projectDir, deps.paths);
  const ref: SessionRef = { sessionId: state.sessionId, name };
  const entries = createEntryList({
    layouts: deps.layouts,
    toastedKinds,
    kit: {
      markdown: deps.markdown,
      keys: deps.keys,
      commands: deps.commands,
      platform: deps.platform,
      allow: (entry) => deps.permissions.allow(ref, entry),
      deny: (entry) => deps.permissions.deny(ref, entry),
      openImages: (images, index) => deps.viewer.open(images, index),
    },
    log: deps.log,
    toast: deps.toast,
    timers: deps.timers,
    clock: deps.clock,
  });
  const boxElement = inputFrame();
  boxElement.classList.add('chat-box');
  const attachments = createAttachments();
  const composer = createComposerSurface(
    {
      layouts: deps.layouts,
      markdown: deps.markdown,
      keys: deps.keys,
      commands: deps.commands,
      platform: deps.platform,
      run: deps.run,
      log: deps.log,
    },
    {
      box: boxElement,
      removeImage: (index) => attachments.removeAt(index),
    },
  );
  attachments.onChange((images) => composer.drawAttachments(images));
  const root = element('div', 'chat-tab');
  root.append(entries.element);
  const tab: HeldTab = {
    sessionId: state.sessionId,
    name,
    state,
    closeConfirmed: false,
    handle: null,
    status: '',
    box: null,
    boxMode: STARTING_MODE,
    isBoxFocused: false,
    root,
    entries,
    attachments,
    composer,
    composerSize: followComposerHeight(root, entries),
  };
  listenForImages({ name, attachments }, { root, box: boxElement }, deps);
  entries.rebuild(state.entries);
  entries.setWorking(isWorking(state));
  drawComposer(tab);
  tab.handle = deps.sessions.addTab(state.sessionId, {
    id: 'chat',
    title: 'Chat',
    element: root,
    beforeClose: () => view.beforeClose(tab),
    shown: () => view.shown(tab),
  });
  tab.box = deps.editor.create(
    boxElement,
    '',
    {
      changed: () => undefined,
      focused: () => {
        tab.isBoxFocused = true;
        tab.root.classList.add('is-box-focused');
        drawBar(tab);
      },
      blurred: () => {
        tab.isBoxFocused = false;
        tab.root.classList.remove('is-box-focused');
        drawBar(tab);
      },
      modeChanged: (mode) => {
        tab.boxMode = mode;
        drawBar(tab);
      },
    },
    {
      completions: {
        prefix: '/',
        // Read each call: commands can arrive or register after the box
        // exists.
        words: () =>
          completionWords(deps.slashCommandNames(), tab.state.commands),
        offered: (words) =>
          deps.log(
            'chat',
            `completions offered: ${words.map((word) => `/${word}`).join(', ')}`,
          ),
        accepted: (word) => deps.log('chat', `completion accepted: /${word}`),
      },
    },
  );
  sendStatus(tab, tabStatus(state.activity));
  tab.handle.select();
  return tab;
}

function putEntry(tab: HeldTab, entry: ChatEntry, log: Log) {
  const applied = applyEntry(tab.state.entries, entry);
  tab.state = { ...tab.state, entries: applied.entries };
  tab.entries.put(entry, applied.entries);
  if (applied.added) {
    log('chat', `${entry.kind} entry added in ${tab.name}`);
  }
}

function setControls(tab: HeldTab, controls: SessionControl[], log: Log) {
  const changed = changedControls(tab.state.controls, controls);
  tab.state = { ...tab.state, controls };
  drawBar(tab);
  for (const control of changed) {
    log('chat', `${control.label} is ${valueLabel(control)} in ${tab.name}`);
  }
}

// Sends the row's status only when it changed.
function sendStatus(tab: HeldTab, status: string) {
  if (tab.handle !== null && tab.status !== status) {
    tab.status = status;
    tab.handle.setStatus(status);
  }
}

// A session closes at once unless Claude is still working on it: then the
// Chat tab shows and the end-session confirmation asks first.
function mayClose(tab: HeldTab, deps: ChatViewDeps): boolean {
  const isBusy =
    tab.state.running && tab.state.activity !== 'idle' && !tab.closeConfirmed;
  if (!isBusy) {
    return true;
  }
  tab.handle?.select();
  blurFocusedElement();
  deps.confirm.open(tab.name, () => {
    tab.closeConfirmed = true;
    deps.sessions.closeSession(tab.sessionId);
  });
  deps.log('chat', `closing the session asks to end ${tab.name}`);
  return false;
}

// Writes the observed composer's border-box height, rounded, as the unitless
// `--chat-composer-height` on `root`, so the entries scroll clear of it, and
// keeps a following list on its last entry as the composer grows. A height of
// 0 is the tab hidden, so the last shown height stays for when it shows again.
// The tab observes each composer it draws.
function followComposerHeight(
  root: HTMLElement,
  entries: Pick<EntryList, 'followBottom'>,
): ResizeObserver {
  const observer = new ResizeObserver(([observed]) => {
    const height = Math.round(observed.borderBoxSize[0].blockSize);
    if (height === 0) {
      return;
    }
    root.style.setProperty('--chat-composer-height', String(height));
    entries.followBottom();
  });
  return observer;
}
