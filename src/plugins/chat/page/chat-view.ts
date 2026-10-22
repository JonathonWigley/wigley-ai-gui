import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import type {
  EditorHost,
  TextEditor,
  VimMode,
} from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { modeLabel } from '../../../shared/vim-mode-label';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import type { ChatChannel, ChatSessionState } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { blurFocusedElement, type CloseConfirm } from './chat-dialogs';
import {
  applyEntry,
  changedControls,
  controlText,
  folderName,
  type PermissionEntry,
  tabStatus,
  valueLabel,
} from './chat-state';
import {
  createEntryList,
  type EntryList,
  type ShownLayout,
} from './entry-list';

export interface ChatView {
  // Shows the session's Chat tab: activates the session (Sessions mode shows),
  // selects the tab, and focuses its box in insert mode with the cursor at
  // the end the next time the tab is the visible tab (at once when it is). A
  // session with no Chat tab yet gets this the moment its tab is added.
  reveal(sessionId: string): void;
  // The session whose Chat tab is the visible tab.
  visibleSessionId(): string | null;
  setLayout(layout: ChatLayout, name: string): void;
}

// A session as a log line and a call to main name it.
export interface SessionRef {
  sessionId: string;
  name: string;
}

// One held chat session as the commands act on it: its state as chat main
// last sent it, whether it ended, its message box and its entries.
export interface ChatSession extends SessionRef {
  readonly state: ChatSessionState;
  readonly ended: boolean;
  box: TextEditor;
  entries: Pick<EntryList, 'move' | 'latest' | 'toggleFocused'>;
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

// `setScope` sets the base scope `chat`; `otherSessionShown` runs when the
// Chat tab shown is another session's than the Chat tab shown before;
// `onSessionRemoved` hears the sessions plugin drop a row's tabs.
export interface ChatViewDeps {
  channel: PageChannel<ChatChannel>;
  sessions: Pick<SessionsPageExports, 'addTab' | 'activate' | 'closeSession'>;
  onSessionRemoved(listener: (sessionId: string) => void): void;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  permissions: PermissionActions;
  confirm: CloseConfirm;
  setScope(): void;
  otherSessionShown(): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// A held session's Chat tab. `handle` is null until `addTab` returns, and
// `box` until the editor mounts into the attached tab.
interface HeldTab {
  sessionId: string;
  name: string;
  state: ChatSessionState;
  ended: boolean;
  closeConfirmed: boolean;
  handle: SessionTabHandle | null;
  status: string;
  box: TextEditor | null;
  boxMode: VimMode;
  isBoxFocused: boolean;
  entries: EntryList;
  statusLine: StatusLine;
}

interface StatusLine {
  element: HTMLElement;
  draw(tab: HeldTab): void;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

// One Chat tab per chat session main holds, each with its entries, message
// box and status line, kept up to date from chat main's messages. Each tab is
// selected in its session when added.
export function mountChatView(deps: ChatViewDeps): ChatTabs {
  const { log } = deps;
  const tabs = new Map<string, HeldTab>();
  const shown: ShownLayout = {
    layout: defaultLayout,
    name: 'default',
    toastedKinds: new Set(),
  };
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
    const tab = createTab(state, shown, deps, {
      // Chat keys act only on the visible Chat tab's session. Another
      // session's Chat tab sets the same scope, so no pushed dialog hears a
      // base change: `otherSessionShown` closes the session's dialogs.
      shown: (shownTab) => {
        deps.setScope();
        if (
          lastShownSessionId !== null &&
          lastShownSessionId !== shownTab.sessionId
        ) {
          deps.otherSessionShown();
        }
        lastShownSessionId = shownTab.sessionId;
        log('chat', `Chat tab shown in ${shownTab.name}`);
        shownTab.statusLine.draw(shownTab);
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
      log('chat', `${tab.name} is ${activity}`);
      sendStatus(tab, tab.ended ? '' : tabStatus(activity));
    }
  });
  channel.on('commands', ({ sessionId, names }) => {
    const tab = heldFor('commands', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, commands: names };
    }
  });
  channel.on('sessionEnded', ({ sessionId, error }) => {
    const tab = heldFor('sessionEnded', sessionId);
    if (tab === undefined) {
      return;
    }
    tab.ended = true;
    sendStatus(tab, '');
    if (error === null) {
      log('chat', `${tab.name} ended`);
    } else {
      log('chat', `${tab.name} ended: ${error}`);
      deps.toast(`${tab.name} ended: ${error}`, 'error');
    }
  });
  deps.onSessionRemoved((sessionId) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    tabs.delete(sessionId);
    tab.box?.destroy();
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
    setLayout(layout, name) {
      shown.layout = layout;
      shown.name = name;
      shown.toastedKinds = new Set();
      for (const tab of tabs.values()) {
        tab.entries.rebuild(tab.state.entries);
      }
    },
    session: (sessionId) => asSession(tabs.get(sessionId)),
    sessionOfEditor: (editor) =>
      asSession([...tabs.values()].find((tab) => tab.box === editor)),
  };
}

// The commands' view of a held tab, reading its state live.
function sessionOf(tab: HeldTab, box: TextEditor): ChatSession {
  return {
    sessionId: tab.sessionId,
    name: tab.name,
    get state() {
      return tab.state;
    },
    get ended() {
      return tab.ended;
    },
    box,
    entries: tab.entries,
  };
}

// The tab element (`div.chat-tab`: entries, box, status line) added to its
// session, with the box's editor mounted once the element is attached. The
// tab then selects itself, so a chat session opens on its Chat tab whichever
// plugin's tab the session got first. `view.shown` may run inside `addTab`,
// before the handle and box are set.
function createTab(
  state: ChatSessionState,
  shown: ShownLayout,
  deps: ChatViewDeps,
  view: { shown(tab: HeldTab): void; beforeClose(tab: HeldTab): boolean },
): HeldTab {
  const name = folderName(state.projectDir);
  const ref: SessionRef = { sessionId: state.sessionId, name };
  const entries = createEntryList({
    shown,
    kit: {
      markdown: deps.markdown,
      keys: deps.keys,
      allow: (entry) => deps.permissions.allow(ref, entry),
      deny: (entry) => deps.permissions.deny(ref, entry),
    },
    log: deps.log,
    toast: deps.toast,
  });
  const boxElement = element('div', 'chat-box');
  const statusLine = buildStatusLine();
  const root = element('div', 'chat-tab');
  root.append(entries.element, boxElement, statusLine.element);
  const tab: HeldTab = {
    sessionId: state.sessionId,
    name,
    state,
    ended: false,
    closeConfirmed: false,
    handle: null,
    status: '',
    box: null,
    boxMode: STARTING_MODE,
    isBoxFocused: false,
    entries,
    statusLine,
  };
  entries.rebuild(state.entries);
  statusLine.draw(tab);
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
        statusLine.draw(tab);
      },
      blurred: () => {
        tab.isBoxFocused = false;
        statusLine.draw(tab);
      },
      modeChanged: (mode) => {
        tab.boxMode = mode;
        statusLine.draw(tab);
      },
    },
    {
      completions: {
        prefix: '/',
        // Read each call: commands can arrive after the box exists.
        words: () => tab.state.commands,
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
  tab.statusLine.draw(tab);
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
    tab.state.activity !== 'idle' && !tab.ended && !tab.closeConfirmed;
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

// The box's vim mode, PAGE while it has no focus, then each control's value.
function buildStatusLine(): StatusLine {
  const line = element('div', 'chat-controls');
  return {
    element: line,
    draw(tab) {
      const mode = element(
        'span',
        'chat-box-mode',
        modeLabel(tab.isBoxFocused ? tab.boxMode : null),
      );
      const controls = tab.state.controls.map((control) =>
        element('span', 'chat-control', controlText(control)),
      );
      line.replaceChildren(mode, ...controls);
    },
  };
}
