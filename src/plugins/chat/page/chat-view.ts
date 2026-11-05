import type { ActiveTime } from '../../../contracts/active-time';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import type { ChatEntryKind } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { PartStore } from '../../../shared/page/contributed-parts';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import { canvasEncoder } from '../../../shared/page/file-drop/canvas-encoder';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type {
  RowActivity,
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import type {
  ChatChannel,
  ChatComposerPart,
  ChatSessionState,
  ChatSidePart,
  ChatStatusPart,
} from '../contract';
import {
  type AttachReport,
  type Attachments,
  type ChatDropDeps,
  createAttachments,
  takeChatFiles,
} from './attachments';
import { placeReturned, pullBackQueued } from './chat-commands';
import type { CloseConfirm } from './chat-dialogs';
import type { ChatLayouts, SurfaceKitDeps } from './chat-layouts';
import {
  applyEntry,
  changedControls,
  folderName,
  isTurnUnderway,
  isWorking,
  type PermissionEntry,
  rowActivity,
  type Unseen,
  unseenAfterRest,
  unseenAfterTurnEnd,
  valueLabel,
} from './chat-state';
import { composerInputOf } from './composer-input';
import { type ComposerSurface, createComposerSurface } from './composer-kit';
import {
  type ComposerStopHolder,
  createComposerStopHolder,
} from './composer-stop-holder';
import { createEntryList, type EntryList } from './entry-list';
import type { ImageViewer } from './image-viewer';
import { sessionFactsOf, type SessionFactsSource } from './session-part';
import type { SideSections, SideTab } from './side-sections';
import { completionWords } from './slash-commands';
import { compactionLabel } from './working-turn';

export interface ChatView {
  // Shows the session's Chat tab: activates the session (Sessions mode shows),
  // selects the tab, and focuses its box in insert mode with the cursor at
  // the end the next time the tab is the visible tab (at once when it is). A
  // session with no Chat tab yet gets this the moment its tab is added.
  reveal(sessionId: string): void;
  // The session whose Chat tab is the visible tab.
  visibleSessionId(): string | null;
  // The visible Chat tab's focused stop's slot element; null with no visible
  // Chat tab, no focused stop, or while a composer part's stop holds the
  // cursor.
  focusedEntry(): HTMLElement | null;
  // The visible Chat tab's cursor block element; null with no visible Chat
  // tab, on a stop with no blocks, or while a composer part's stop holds the
  // cursor.
  focusedBlock(): HTMLElement | null;
  // The session's clock as main last sent it, from the moment its tab starts
  // being added; null for a session the view does not hold.
  activeTime(sessionId: string): ActiveTime | null;
}

// A session as a log line and a call to main name it.
export interface SessionRef {
  sessionId: string;
  name: string;
}

// One held chat session as the commands act on it: its state as chat main
// last sent it, whether its process runs, its message box, the images
// attached to its next message and its entries. `enterStop` offers the entry
// cursor to the composer parts' stops, in part order: the id of the part that
// took it, null when none did. `isBoxFocused` says whether the box holds
// focus now.
export interface ChatSession extends SessionRef {
  readonly state: ChatSessionState;
  readonly running: boolean;
  box: TextEditor;
  isBoxFocused(): boolean;
  attachments: Attachments;
  entries: Pick<
    EntryList,
    | 'move'
    | 'moveToMessage'
    | 'isAtLastStop'
    | 'latest'
    | 'first'
    | 'toggleRange'
    | 'isRangeOpen'
    | 'cancelRange'
    | 'selectedSource'
    | 'focused'
    | 'toggleFocused'
    | 'scrollBy'
  >;
  enterStop(): string | null;
}

// The Chat view with what the commands read: the session a box belongs to,
// and a held session by id. `markSent` clears the done or error the
// session's row shows, as a message sent there does. `composerOf` is a held
// session's composer surface, for the part that places its activity dock.
// `sessionFactsSource` is a held session's facts for the hub's Session section,
// read live: `onChanged` fires after each status line draw.
export interface ChatTabs extends ChatView {
  session(sessionId: string): ChatSession | undefined;
  sessionOfEditor(editor: TextEditor): ChatSession | undefined;
  markSent(sessionId: string): void;
  // Ends every held tab; no tab starts after it.
  dispose(): void;
  composerOf(sessionId: string): ComposerSurface | null;
  sessionFactsSource(sessionId: string): SessionFactsSource | null;
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
// `onSessionRemoved` hears the sessions plugin drop a row's tabs,
// `onActiveChanged` the focused pane's session change and
// `onSessionHostChanged` a row's host id change, `onScopeChanged` each change of
// the scope keys fire in; `sessions` also takes each
// row's activity and names the focused pane's session. `activeTimeListeners` run
// when a session arrives and on each `activeTime` message for a held session, a
// throw skipping none of them. `run` runs
// a command, as the composer's chips and send button do; `keys` also anchors
// the composer's key hints; `layouts` holds the chat layouts the entries and
// the composer draw with; `paths` names each tab by its project folder, and with
// `homeDir` shows that folder in the hub's Session section.
// `slashCommandNames` reads the app slash commands registered now, which the
// `/` completion offers ahead of the agent's. `viewer` opens a sent message's
// images full size. `timers` and `clock` tick a live activity line's time and
// the activity dock's. `composerParts` holds the parts other plugins draw
// above every composer, `statusParts` those they draw in every status line;
// `sideParts` tells when a part beside every `.chat-main` comes or goes, and
// `sideSections` draws those parts as each tab's session hub.
// `drops` registers each Chat tab as the target of the
// files dropped or pasted on it, and saves a pasted file that is not an
// image.
export interface ChatViewDeps extends SurfaceKitDeps {
  channel: PageChannel<ChatChannel>;
  paths: Paths;
  homeDir: string;
  sessions: Pick<
    SessionsPageExports,
    'addTab' | 'activate' | 'closeSession' | 'setActivity' | 'selectedSessionId'
  >;
  onSessionRemoved(listener: (sessionId: string) => void): void;
  onActiveChanged(listener: (sessionId: string | null) => void): void;
  onSessionHostChanged(listener: (sessionId: string) => void): void;
  onScopeChanged(listener: () => void): void;
  activeTimeListeners: readonly ((
    sessionId: string,
    activeTime: ActiveTime,
  ) => void)[];
  editor: EditorHost;
  run(command: CommandId): void;
  layouts: ChatLayouts;
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts' | 'onChanged'>;
  statusParts: Pick<PartStore<ChatStatusPart>, 'parts' | 'onChanged'>;
  sideParts: Pick<PartStore<ChatSidePart>, 'onChanged'>;
  sideSections: Pick<SideSections, 'openTab'>;
  permissions: PermissionActions;
  confirm: CloseConfirm;
  viewer: Pick<ImageViewer, 'open'>;
  slashCommandNames(): string[];
  setScope(scope: ChatTabScope): void;
  otherSessionShown(): void;
  visibleSessionRested(): void;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
}

// A held session's Chat tab. `handle` is null until `addTab` returns, and
// `box` and `dropTarget` until the editor mounts into the attached tab.
// `composerSize` follows the drawn composer's height for as long as the tab is
// held. `unseen` is the finished turn the row still shows, and `activity` the
// activity last set on the row. `stop` holds the composer part holding the
// tab's entry cursor. `main` holds the entries and the composer; `side` is the
// tab's session hub. `factsListeners` hear each status line draw.
interface HeldTab {
  sessionId: string;
  name: string;
  state: ChatSessionState;
  closeConfirmed: boolean;
  handle: SessionTabHandle | null;
  unseen: Unseen;
  activity: RowActivity | null;
  box: TextEditor | null;
  isBoxFocused: boolean;
  root: HTMLElement;
  main: HTMLElement;
  side: SideTab;
  entries: EntryList;
  attachments: Attachments;
  composer: ComposerSurface;
  composerSize: ResizeObserver;
  dropTarget: Disposable | null;
  stop: ComposerStopHolder;
  factsListeners: Set<() => void>;
}

// One Chat tab per chat session main holds, each with its entries, its
// pending rows and its composer (the activity line, attached images, message
// box, and the status line: repo, branch, type hint, control chips, status
// parts, running indicator, send) in its `.chat-main`, and the session hub
// beside that, kept up to date from chat main's messages. Each tab is
// selected in its session when added. A layout change draws every tab's
// entries, pending rows and composer again and builds its side parts again, and
// a composer or status part added or removed draws every tab's composer again,
// each box keeping its text, vim mode and focus. A side part added or removed
// builds or removes that part alone in every tab, and no composer draw touches
// one. Each session's row
// shows what its process does (needs you, working) and, once idle, a turn the
// user has not seen end (done, error). Messages main returned go into their
// session's box: as they arrive, and those main still holds when a tab mounts.
export function mountChatView(deps: ChatViewDeps): ChatTabs {
  const { log } = deps;
  const tabs = new Map<string, HeldTab>();
  // Apart from `tabs`: `addTab` draws the side bar's rows, whose clocks read
  // this, before the tab is in `tabs`.
  const activeTimes = new Map<string, ActiveTime>();
  // The kinds whose failed draw has toasted since the layouts were shown.
  const toastedKinds = new Set<ChatEntryKind>();
  deps.layouts.onChange(() => {
    toastedKinds.clear();
    for (const tab of tabs.values()) {
      tab.entries.rebuild(tab.state.entries);
      drawComposer(tab);
      tab.side.rebuild();
    }
  });
  const drawEveryComposer = () => {
    for (const tab of tabs.values()) {
      drawComposer(tab);
    }
  };
  deps.composerParts.onChanged(drawEveryComposer);
  deps.statusParts.onChanged(drawEveryComposer);
  deps.sideParts.onChanged(() => {
    for (const tab of tabs.values()) {
      tab.side.sync();
    }
  });
  let pendingReveal: string | null = null;
  let lastShownSessionId: string | null = null;
  let isDisposed = false;

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

  const announceActiveTime = (sessionId: string, activeTime: ActiveTime) =>
    callEach(deps.activeTimeListeners, (listener) =>
      listener(sessionId, activeTime),
    );

  const add = (state: ChatSessionState) => {
    if (isDisposed || tabs.has(state.sessionId)) {
      return;
    }
    activeTimes.set(state.sessionId, state.activeTime);
    const tab = createTab(state, toastedKinds, deps, {
      isHeld: (heldTab) => tabs.get(heldTab.sessionId) === heldTab,
      // Chat keys act only on the visible Chat tab's session. Every Chat tab
      // sets the same scope, so no pushed dialog hears a base change:
      // `otherSessionShown` closes the session's dialogs.
      shown: (shownTab) => {
        shownTab.stop.leave();
        deps.setScope('chat');
        askHistory(shownTab, deps);
        if (
          lastShownSessionId !== null &&
          lastShownSessionId !== shownTab.sessionId
        ) {
          deps.otherSessionShown();
        }
        lastShownSessionId = shownTab.sessionId;
        log(`Chat tab shown in ${shownTab.name}`);
        drawStatusLine(shownTab);
        shownTab.entries.scrollToFocus();
        focusIfRevealed(shownTab);
      },
      beforeClose: (closing) => mayClose(closing, deps),
    });
    tabs.set(state.sessionId, tab);
    tab.side.sync();
    placeReturned(
      { tabs: view, channel, log },
      state.sessionId,
      state.returned,
    );
    if (pendingReveal === tab.sessionId) {
      showRevealed(tab);
    }
    announceActiveTime(state.sessionId, state.activeTime);
  };

  const heldFor = (message: string, sessionId: string) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      log(`${message} for unknown session ${sessionId} ignored`);
    }
    return tab;
  };

  // Listeners first: a session `sessions()` returns after its
  // `sessionStarted` is already held, and adding it again changes nothing.
  const { channel } = deps;
  channel.on('sessionStarted', add);
  channel.on('returned', ({ sessionId, messages }) =>
    placeReturned({ tabs: view, channel, log }, sessionId, messages),
  );
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
      const isTurnEnded = tab.state.activity !== 'idle' && activity === 'idle';
      const isTurnStarted =
        tab.state.activity === 'idle' && activity !== 'idle';
      tab.state = { ...tab.state, activity };
      tab.entries.setWorking(isWorking(tab.state));
      drawTurn(tab);
      if (isTurnEnded) {
        tab.entries.latest();
        const focused = deps.sessions.selectedSessionId() === sessionId;
        tab.unseen = unseenAfterTurnEnd(
          tab.unseen,
          focused,
          tab.state.background,
        );
      }
      if (isTurnStarted) {
        tab.unseen = null;
      }
      log(`${tab.name} is ${activity}`);
      drawActivity(tab, deps);
      drawStatusLine(tab);
    }
  });
  channel.on('background', ({ sessionId, background }) => {
    const tab = heldFor('background', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, background };
      log(`${tab.name} has ${background} running in the background`);
      drawActivity(tab, deps);
    }
  });
  channel.on('activeTime', ({ sessionId, activeTime }) => {
    const tab = heldFor('activeTime', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, activeTime };
      activeTimes.set(sessionId, activeTime);
      announceActiveTime(sessionId, activeTime);
    }
  });
  channel.on('branch', ({ sessionId, repo, branch }) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    tab.state = { ...tab.state, repo, branch };
    drawStatusLine(tab);
    log(
      branch === null
        ? `${tab.name} is in ${repo}, no branch`
        : `${tab.name} is in ${repo} on ${branch}`,
    );
  });
  channel.on('commands', ({ sessionId, commands }) => {
    const tab = heldFor('commands', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, commands };
    }
  });
  channel.on('entries', ({ sessionId, entries }) => {
    const tab = heldFor('entries', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, entries };
      tab.entries.rebuild(entries);
      drawTurn(tab);
      log(`${entries.length} entries read in ${tab.name}`);
    }
  });
  channel.on('queued', ({ sessionId, queued }) => {
    const tab = heldFor('queued', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, queued };
      tab.entries.setQueued(queued);
      log(`${queued.length} pending message(s) in ${tab.name}`);
    }
  });
  channel.on('compaction', ({ sessionId, compaction }) => {
    const tab = heldFor('compaction', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, compaction };
      drawTurn(tab);
      drawStatusLine(tab);
      log(
        compaction === null
          ? `${tab.name} compaction ended`
          : `${tab.name} compacting: ${compactionLabel(compaction)}`,
      );
    }
  });
  channel.on('sessionRunning', ({ sessionId }) => {
    const tab = heldFor('sessionRunning', sessionId);
    if (tab !== undefined) {
      tab.state = { ...tab.state, running: true };
      tab.entries.setWorking(isWorking(tab.state));
      drawTurn(tab);
      drawStatusLine(tab);
      log(`${tab.name} running`);
    }
  });
  channel.on('sessionRested', ({ sessionId, error }) => {
    const tab = heldFor('sessionRested', sessionId);
    if (tab === undefined) {
      return;
    }
    const wasActive = tab.state.activity !== 'idle';
    tab.unseen = unseenAfterRest(tab.unseen, error, wasActive);
    tab.state = { ...tab.state, running: false };
    tab.entries.setWorking(isWorking(tab.state));
    drawTurn(tab);
    drawStatusLine(tab);
    drawActivity(tab, deps);
    if (tab.handle?.isVisible() === true) {
      deps.visibleSessionRested();
    }
    if (error === null) {
      log(`${tab.name} rested`);
    } else {
      log(`${tab.name} rested: ${error}`);
      deps.toast(`${tab.name} stopped: ${error}`, 'error');
    }
  });
  deps.onSessionRemoved((sessionId) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    tabs.delete(sessionId);
    activeTimes.delete(sessionId);
    if (pendingReveal === sessionId) {
      pendingReveal = null;
    }
    log(`session closed: ${tab.name}`);
    tearDownTab(tab);
  });
  // Viewing a session, clearing its conversation or sending to it leaves
  // nothing unseen.
  const clearUnseen = (sessionId: string | null) => {
    const tab = sessionId === null ? undefined : tabs.get(sessionId);
    if (tab !== undefined) {
      tab.unseen = null;
      drawActivity(tab, deps);
    }
  };
  deps.onActiveChanged(clearUnseen);
  deps.onSessionHostChanged(clearUnseen);
  // Another tab, pane or mode took the keys; a scope pushed over the visible
  // tab keeps its stop.
  deps.onScopeChanged(() => {
    for (const tab of tabs.values()) {
      tab.stop.scopeChanged(tab.handle?.isVisible() === true);
    }
  });
  void channel.invoke('sessions').then(
    (states) => {
      try {
        callEach(states, add);
      } catch (error) {
        log(`chat session arrival failed: ${errorText(error)}`);
      }
    },
    (error: unknown) => log(`chat sessions not read: ${errorText(error)}`),
  );

  const visibleTab = () =>
    [...tabs.values()].find((tab) => tab.handle?.isVisible() === true);
  const asSession = (tab: HeldTab | undefined): ChatSession | undefined =>
    tab === undefined || tab.box === null
      ? undefined
      : sessionOf(tab, tab.box, deps.composerParts);

  const view: ChatTabs = {
    reveal(sessionId) {
      if (isDisposed) {
        return;
      }
      pendingReveal = sessionId;
      const tab = tabs.get(sessionId);
      if (tab !== undefined) {
        showRevealed(tab);
      }
    },
    visibleSessionId: () => visibleTab()?.sessionId ?? null,
    focusedEntry: () => {
      const tab = visibleTab();
      return tab === undefined || tab.stop.holding() !== null
        ? null
        : tab.entries.focusedElement();
    },
    focusedBlock: () => {
      const tab = visibleTab();
      return tab === undefined || tab.stop.holding() !== null
        ? null
        : tab.entries.focusedBlock();
    },
    activeTime: (sessionId) => activeTimes.get(sessionId) ?? null,
    session: (sessionId) => asSession(tabs.get(sessionId)),
    sessionOfEditor: (editor) =>
      asSession([...tabs.values()].find((tab) => tab.box === editor)),
    markSent: clearUnseen,
    dispose() {
      isDisposed = true;
      const held = [...tabs.values()];
      tabs.clear();
      callEach(held, tearDownTab);
    },
    composerOf: (sessionId) => tabs.get(sessionId)?.composer ?? null,
    sessionFactsSource: (sessionId) => {
      const tab = tabs.get(sessionId);
      return tab === undefined ? null : sessionFactsSourceOf(tab, deps);
    },
  };
  return view;
}

// Ends what the tab holds that outlives its element.
function tearDownTab(tab: HeldTab) {
  callEach<() => void>(
    [
      () => tab.stop.leave(),
      () => tab.dropTarget?.dispose(),
      () => tab.box?.destroy(),
      () => tab.composerSize.disconnect(),
      () => tab.composer.dispose(),
      () => tab.side.close(),
      () => tab.entries.dispose(),
    ],
    (step) => step(),
  );
}

// Draws the tab's composer through the chat layout in place of its last draw,
// moving the box into it and focusing the box again when it held focus; the
// height observer follows the new composer. The parts are built again, so a
// part holding the entry cursor leaves first, and a visible tab's cursor goes
// back on the entries.
function drawComposer(tab: HeldTab) {
  tab.stop.composerRedrawn(tab.handle?.isVisible() === true);
  const hadFocus = tab.isBoxFocused;
  const composer = tab.composer.drawComposer(tab.main, composerInputOf(tab));
  tab.composerSize.disconnect();
  tab.composerSize.observe(composer);
  if (hadFocus) {
    tab.box?.focus();
  }
}

// Hands the composer surface's activity dock the tab's entries, whether its
// session's turn is under way, and the compaction running in it.
function drawTurn(tab: HeldTab) {
  tab.composer.setTurn(
    tab.state.entries,
    isTurnUnderway(tab.state),
    tab.state.compaction,
  );
}

// Draws the status line, or the whole composer again when its update threw, then
// tells the session's facts source. A listener that throws stops no other, and
// the first throw reaches the caller.
function drawStatusLine(tab: HeldTab) {
  if (!tab.composer.drawStatusLine(composerInputOf(tab))) {
    drawComposer(tab);
  }
  callEach([...tab.factsListeners], (listener) => listener());
}

function sessionFactsSourceOf(
  tab: HeldTab,
  deps: Pick<ChatViewDeps, 'homeDir' | 'paths'>,
): SessionFactsSource {
  return {
    input: () =>
      sessionFactsOf(composerInputOf(tab), tab.state.projectDir, deps),
    onChanged(listener) {
      // A wrapper per subscription, so each handle removes only its own.
      const wrapped = () => listener();
      tab.factsListeners.add(wrapped);
      return { dispose: () => tab.factsListeners.delete(wrapped) };
    },
  };
}

// Chat's scope in force again and the cursor on the stop `G` focuses.
function cursorToEntries(tab: HeldTab, deps: Pick<ChatViewDeps, 'setScope'>) {
  deps.setScope('chat');
  tab.entries.latest();
}

// Asks main for the session's earlier conversation each time its tab shows;
// main reads it once, and it arrives as an `entries` message.
function askHistory(tab: HeldTab, deps: ChatViewDeps) {
  void deps.channel
    .invoke('loadHistory', tab.sessionId)
    .catch((error: unknown) => {
      deps.log(`history not loaded: ${errorText(error)}`);
      deps.toast(`history not loaded: ${errorText(error)}`, 'error');
    });
}

// The commands' view of a held tab, reading its state live; `enterStop`
// offers the cursor to the composer parts held now.
function sessionOf(
  tab: HeldTab,
  box: TextEditor,
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts'>,
): ChatSession {
  return {
    enterStop: () => tab.stop.offer(composerParts.parts()),
    sessionId: tab.sessionId,
    name: tab.name,
    get state() {
      return tab.state;
    },
    get running() {
      return tab.state.running;
    },
    box,
    isBoxFocused: () => tab.isBoxFocused,
    attachments: tab.attachments,
    entries: tab.entries,
  };
}

// The tab element (`div.chat-tab`: `div.chat-main`, then the session hub's
// holder, which the caller fills through `side.sync` once it holds the tab;
// `.chat-main` holds the entries, then the floating composer holding
// other plugins' parts, the activity line, the attached images' strip, the box
// and its status line) added to its session, with the box's editor mounted
// once the element is attached; it is marked `is-at-stop` while a composer part's stop
// holds the entry cursor, and the box taking focus leaves that part. The
// tab then selects itself, so a chat session opens on its Chat tab whichever
// plugin's tab the session got first. `view.shown` may run inside `addTab`,
// before the handle and box are set. Once the box is mounted the tab element is
// the target of the files dropped or pasted on it; `view.isHeld` answers
// whether the tab is still held, so a take that outlives it stops.
function createTab(
  state: ChatSessionState,
  toastedKinds: Set<ChatEntryKind>,
  deps: ChatViewDeps,
  view: {
    isHeld(tab: HeldTab): boolean;
    shown(tab: HeldTab): void;
    beforeClose(tab: HeldTab): boolean;
  },
): HeldTab {
  const name = folderName(state.projectDir, deps.paths);
  const ref: SessionRef = { sessionId: state.sessionId, name };
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
      composerParts: deps.composerParts,
      statusParts: deps.statusParts,
      log: deps.log,
      clock: deps.clock,
      timers: deps.timers,
    },
    {
      sessionId: state.sessionId,
      box: boxElement,
      removeImage: (index) => attachments.removeAt(index),
    },
  );
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
    pullBack: (queuedId) => pullBackQueued(deps, ref, queuedId),
    turnLine: composer.turnLineSlot,
  });
  attachments.onChange((images) => composer.drawAttachments(images));
  const root = element('div', 'chat-tab');
  const main = element('div', 'chat-main');
  main.append(entries.element);
  root.append(main);
  const tab: HeldTab = {
    sessionId: state.sessionId,
    name,
    state,
    closeConfirmed: false,
    handle: null,
    unseen: null,
    activity: null,
    box: null,
    isBoxFocused: false,
    root,
    main,
    side: deps.sideSections.openTab(root, state.sessionId),
    entries,
    attachments,
    composer,
    composerSize: followComposerHeight(root, entries),
    dropTarget: null,
    stop: createComposerStopHolder({
      sessionId: state.sessionId,
      name,
      toEntries: () => cursorToEntries(tab, deps),
      toBox: (how) => {
        deps.setScope('chat');
        tab.box?.focus(
          how === 'insert' ? { insert: true } : { insertAtEnd: true },
        );
      },
      setChatScope: () => deps.setScope('chat'),
      changed: (holding) => root.classList.toggle('is-at-stop', holding),
      log: deps.log,
    }),
    factsListeners: new Set(),
  };
  entries.rebuild(state.entries);
  entries.setQueued(state.queued);
  entries.setWorking(isWorking(state));
  drawComposer(tab);
  drawTurn(tab);
  tab.handle = deps.sessions.addTab(state.sessionId, {
    id: 'chat',
    title: 'Chat',
    icon: 'comment',
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
        tab.stop.boxFocused();
        tab.isBoxFocused = true;
        tab.root.classList.add('is-box-focused');
        drawStatusLine(tab);
      },
      blurred: () => {
        tab.isBoxFocused = false;
        tab.root.classList.remove('is-box-focused');
        drawStatusLine(tab);
      },
      // The cursor's shape shows the vim mode; the status line names none.
      modeChanged: () => undefined,
    },
    {
      completions: {
        prefix: '/',
        // Read each call: commands can arrive or register after the box
        // exists.
        items: () =>
          completionWords(
            deps.slashCommandNames(),
            tab.state.commands.map((command) => command.name),
          ).map((word) => ({ word, aliases: [] })),
        offered: (words) =>
          deps.log(
            `completions offered: ${words.map((word) => `/${word}`).join(', ')}`,
          ),
        accepted: (word) => deps.log(`completion accepted: /${word}`),
      },
    },
  );
  const dropDeps = chatDropDepsOf(tab, tab.box, () => view.isHeld(tab), deps);
  tab.dropTarget = deps.drops.addTarget({
    element: root,
    take: (files) => void takeChatFiles(files, dropDeps),
  });
  drawActivity(tab, deps);
  tab.handle.select();
  return tab;
}

// What a take on the tab writes into: its box and attachments, until
// `isHeld` answers false.
function chatDropDepsOf(
  tab: HeldTab,
  box: TextEditor,
  isHeld: () => boolean,
  deps: Pick<ChatViewDeps, 'drops' | 'log' | 'toast'>,
): ChatDropDeps {
  return {
    attachments: tab.attachments,
    box,
    savePasted: (file) => deps.drops.savePasted(file),
    encoder: canvasEncoder,
    report: attachReportOf(tab.name, deps),
    isHeld,
  };
}

function attachReportOf(
  name: string,
  deps: Pick<ChatViewDeps, 'log' | 'toast'>,
): AttachReport {
  return {
    attached: (image) =>
      deps.log(`attached a ${image.mediaType} image in ${name}`),
    refused: (reason) => {
      deps.log(`image refused: ${reason}`);
      deps.toast(reason, 'error');
    },
    failed: (fileName, what, error) => {
      deps.log(`${fileName} not ${what}: ${error}`);
      deps.toast(`${fileName} not ${what}: ${error}`, 'error');
    },
    inserted: (paths) =>
      deps.log(`inserted ${paths.length} file path(s) in ${name}`),
  };
}

function putEntry(tab: HeldTab, entry: ChatEntry, log: PluginLog) {
  const applied = applyEntry(tab.state.entries, entry);
  tab.state = { ...tab.state, entries: applied.entries };
  tab.entries.put(entry, applied.entries);
  drawTurn(tab);
  if (applied.added) {
    log(`${entry.kind} entry added in ${tab.name}`);
  }
}

function setControls(tab: HeldTab, controls: SessionControl[], log: PluginLog) {
  const changed = changedControls(tab.state.controls, controls);
  tab.state = { ...tab.state, controls };
  drawStatusLine(tab);
  for (const control of changed) {
    log(`${control.label} is ${valueLabel(control)} in ${tab.name}`);
  }
}

// Sets the session's row activity under chat's source id, only when it
// changed.
function drawActivity(
  tab: HeldTab,
  deps: Pick<ChatViewDeps, 'sessions' | 'log'>,
) {
  const activity = rowActivity({
    activity: tab.state.activity,
    background: tab.state.background,
    unseen: tab.unseen,
  });
  if (activity === tab.activity) {
    return;
  }
  tab.activity = activity;
  deps.sessions.setActivity(tab.sessionId, 'chat', activity);
  deps.log(`row activity ${tab.name} ${activity?.word ?? 'none'}`);
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
  deps.log(`closing the session asks to end ${tab.name}`);
  return false;
}

// Writes the observed composer's border-box height, rounded, as the unitless
// `--chat-composer-height` on `root`, where `.chat-main` inherits it, so the
// entries scroll clear of it, and keeps a following list on its last entry as the composer grows. A height of
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
