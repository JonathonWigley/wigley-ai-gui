import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import type {
  EditorHost,
  TextEditor,
  VimMode,
} from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { chip } from '../../../shared/page/ui/chip';
import { floatingPanel } from '../../../shared/page/ui/floating-panel';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { statusDot } from '../../../shared/page/ui/status-dot';
import { modeLabel } from '../../../shared/vim-mode-label';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import type { ChatChannel, ChatSessionState } from '../contract';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import {
  type Attachments,
  buildAttachmentStrip,
  createAttachments,
  listenForImages,
} from './attachments';
import { blurFocusedElement, type CloseConfirm } from './chat-dialogs';
import {
  applyEntry,
  changedControls,
  folderName,
  type PermissionEntry,
  tabStatus,
  valueLabel,
} from './chat-state';
import { controlCommand } from './control-commands';
import {
  createEntryList,
  type EntryList,
  type ShownLayout,
} from './entry-list';
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
  setLayout(layout: ChatLayout, name: string): void;
}

// A session as a log line and a call to main name it.
export interface SessionRef {
  sessionId: string;
  name: string;
}

// One held chat session as the commands act on it: its state as chat main
// last sent it, whether it ended, its message box, the images attached to
// its next message and its entries.
export interface ChatSession extends SessionRef {
  readonly state: ChatSessionState;
  readonly ended: boolean;
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

// The base scope a shown Chat tab sets: `ended` once its session has ended,
// holding only the entry, box and send keys, else `chat`.
export type ChatTabScope = 'chat' | 'ended';

// `setScope` sets the base scope; `otherSessionShown` runs when the
// Chat tab shown is another session's than the Chat tab shown before;
// `onSessionRemoved` hears the sessions plugin drop a row's tabs. `run` runs
// a command, as the composer's chips and send button do; `keys` anchors the
// composer's key hints; `paths` names each tab by its project folder.
// `slashCommandNames` reads the app slash commands registered now, which the
// `/` completion offers ahead of the agent's. `viewer` opens a sent message's
// images full size.
export interface ChatViewDeps {
  channel: PageChannel<ChatChannel>;
  paths: Paths;
  sessions: Pick<SessionsPageExports, 'addTab' | 'activate' | 'closeSession'>;
  onSessionRemoved(listener: (sessionId: string) => void): void;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor'>;
  run(command: CommandId): void;
  permissions: PermissionActions;
  confirm: CloseConfirm;
  viewer: Pick<ImageViewer, 'open'>;
  slashCommandNames(): string[];
  setScope(scope: ChatTabScope): void;
  otherSessionShown(): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// A held session's Chat tab. `handle` is null until `addTab` returns, and
// `box` until the editor mounts into the attached tab. `composerSize` follows
// the composer's height for as long as the tab is held.
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
  attachments: Attachments;
  bar: ComposerBar;
  composerSize: ResizeObserver;
}

// `draw` shows the tab's state; `setScope` names the type hint's and Send's
// anchors again in the tab's new scope; `dispose` disposes every anchor.
interface ComposerBar {
  element: HTMLElement;
  draw(tab: HeldTab): void;
  setScope(scope: ChatTabScope): void;
  dispose(): void;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

// One Chat tab per chat session main holds, each with its entries and its
// composer (attached images, message box, mode, type hint, running indicator,
// control chips, send), kept up to date from chat main's messages. Each tab is
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
      // session's Chat tab, live or ended as this one is, sets the same scope,
      // so no pushed dialog hears a base change: `otherSessionShown` closes
      // the session's dialogs. Between a live and an ended tab the base
      // changes, closing every pushed chat dialog and picker.
      shown: (shownTab) => {
        deps.setScope(tabScope(shownTab));
        if (
          lastShownSessionId !== null &&
          lastShownSessionId !== shownTab.sessionId
        ) {
          deps.otherSessionShown();
        }
        lastShownSessionId = shownTab.sessionId;
        log('chat', `Chat tab shown in ${shownTab.name}`);
        shownTab.bar.draw(shownTab);
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
      tab.bar.draw(tab);
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
    tab.bar.setScope(tabScope(tab));
    if (tab.handle?.isVisible() === true) {
      deps.setScope(tabScope(tab));
    }
    tab.bar.draw(tab);
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
    tab.composerSize.disconnect();
    tab.bar.dispose();
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

function tabScope(tab: Pick<HeldTab, 'ended'>): ChatTabScope {
  return tab.ended ? 'ended' : 'chat';
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
  shown: ShownLayout,
  deps: ChatViewDeps,
  view: { shown(tab: HeldTab): void; beforeClose(tab: HeldTab): boolean },
): HeldTab {
  const name = folderName(state.projectDir, deps.paths);
  const ref: SessionRef = { sessionId: state.sessionId, name };
  const entries = createEntryList({
    shown,
    kit: {
      markdown: deps.markdown,
      keys: deps.keys,
      allow: (entry) => deps.permissions.allow(ref, entry),
      deny: (entry) => deps.permissions.deny(ref, entry),
      openImages: (images, index) => deps.viewer.open(images, index),
    },
    log: deps.log,
    toast: deps.toast,
  });
  const boxElement = inputFrame();
  boxElement.classList.add('chat-box');
  const bar = buildComposerBar(deps, tabScope(state));
  const attachments = createAttachments();
  const strip = buildAttachmentStrip(attachments);
  const composer = floatingPanel();
  composer.classList.add('chat-composer');
  composer.append(strip, boxElement, bar.element);
  const root = element('div', 'chat-tab');
  root.append(entries.element, composer);
  const tab: HeldTab = {
    sessionId: state.sessionId,
    name,
    state,
    ended: state.ended,
    closeConfirmed: false,
    handle: null,
    status: '',
    box: null,
    boxMode: STARTING_MODE,
    isBoxFocused: false,
    entries,
    attachments,
    bar,
    composerSize: followComposerHeight(composer, root, entries),
  };
  entries.rebuild(state.entries);
  bar.draw(tab);
  listenForImages(tab, composer, root, deps);
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
        bar.draw(tab);
      },
      blurred: () => {
        tab.isBoxFocused = false;
        bar.draw(tab);
      },
      modeChanged: (mode) => {
        tab.boxMode = mode;
        bar.draw(tab);
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
  sendStatus(tab, state.ended ? '' : tabStatus(state.activity));
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
  tab.bar.draw(tab);
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

// Writes the composer's border-box height, rounded, as the unitless
// `--chat-composer-height` on `root`, so the entries scroll clear of it, and
// keeps a following list on its last entry as the composer grows. A height of
// 0 is the tab hidden, so the last shown height stays for when it shows again.
function followComposerHeight(
  composer: HTMLElement,
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
  observer.observe(composer);
  return observer;
}

// The bar's parts, built once per tab: the box's vim mode (PAGE while it has no
// focus), the type hint (`i` and `a`, hidden while the box has focus), a chip
// per control opening that control's picker, then at the end the running
// indicator (shown while a turn is in progress on a live session, its space
// kept while it hides) and send. The chips and send
// are disabled once the session has ended. The type hint and send keys are
// anchored in the tab's scope; the interrupt and chip keys in `chat.chat`. Each
// chip command's keys sit in the first chip that runs it; a command no chip
// runs keeps its anchor element detached until a later draw places it.
function buildComposerBar(
  deps: Pick<ChatViewDeps, 'keys' | 'run'>,
  scope: ChatTabScope,
): ComposerBar {
  const bar = element('div', 'chat-composer-bar');
  const mode = element('span', 'chat-box-mode');
  const typeKey = element('span', 'chat-type-key');
  const appendKey = element('span', 'chat-type-key');
  const typeHint = element('span', 'chat-type-hint');
  typeHint.append(typeKey, appendKey);
  const interruptKey = element('span', 'chat-running-key');
  const running = element('span', 'chat-running');
  running.append(statusDot('running'), interruptKey);
  const sendKey = element('span', 'chat-send-key');
  const send = textButton('Send', () => deps.run(chatCommand('send')), {
    variant: 'ghost',
    hint: sendKey,
  });

  const liveScope = { scope: chatScope('chat') };
  const fixedAnchors = [
    deps.keys.anchor(interruptKey, chatCommand('interrupt'), {
      ...liveScope,
      label: 'stop',
    }),
  ];
  const chipKeys = new Map<ChatCommandName, HTMLElement>();
  for (const command of [
    'pickMode',
    'pickEffort',
    'pickModel',
    'pickControl',
  ] as const) {
    const key = element('span', 'chat-chip-key');
    chipKeys.set(command, key);
    fixedAnchors.push(deps.keys.anchor(key, chatCommand(command), liveScope));
  }
  const nameScopedAnchors = (named: ChatTabScope) => {
    const options = { scope: chatScope(named) };
    return [
      deps.keys.anchor(typeKey, chatCommand('focusBox'), {
        ...options,
        label: 'to type',
      }),
      deps.keys.anchor(appendKey, chatCommand('appendBox'), {
        ...options,
        label: 'to append',
      }),
      deps.keys.anchor(sendKey, chatCommand('send'), options),
    ];
  };
  let scopedAnchors = nameScopedAnchors(scope);

  return {
    element: bar,
    draw(tab) {
      mode.textContent = modeLabel(tab.isBoxFocused ? tab.boxMode : null);
      typeHint.classList.toggle('is-box-focused', tab.isBoxFocused);
      running.classList.toggle(
        'is-idle',
        tab.ended || tab.state.activity === 'idle',
      );
      const placed = new Set<ChatCommandName>();
      const chips = tab.state.controls.map((control) => {
        const command = controlCommand(control.id);
        const controlChip = chip(control.label, valueLabel(control), () =>
          deps.run(chatCommand(command)),
        );
        controlChip.toggleAttribute('disabled', tab.ended);
        const key = chipKeys.get(command);
        if (key !== undefined && !placed.has(command)) {
          controlChip.append(key);
          placed.add(command);
        }
        return controlChip;
      });
      send.disabled = tab.ended;
      bar.replaceChildren(mode, typeHint, ...chips, running, send);
    },
    setScope(next) {
      disposeAnchors(scopedAnchors);
      scopedAnchors = nameScopedAnchors(next);
    },
    dispose() {
      disposeAnchors(scopedAnchors);
      disposeAnchors(fixedAnchors);
    },
  };
}
