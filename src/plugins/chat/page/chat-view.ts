import type { ActiveTime } from '../../../contracts/active-time';
import type { Clock, Timers } from '../../../contracts/ambient';
import type {
  AgentCommand,
  ChatEntry,
  ChatImage,
  ProcessActivity,
  SessionControl,
} from '../../../contracts/agent';
import type { CommandId, CommandKey } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type {
  EditorCompletions,
  EditorHost,
  ScrollStep,
  TextEditor,
} from '../../../contracts/editor';
import type { ChatEntryKind } from '../../../contracts/agent';
import type { ViewScope } from '../../../contracts/keymap';
import type { PluginLog } from '../../../contracts/log';
import type {
  FocusTarget,
  PaneDirection,
  ResizeTarget,
} from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import type { KeyedSlotReader, ListSlotReader } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import { scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import type { PartStore } from '../../../shared/page/contributed-parts';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import { canvasEncoder } from '../../../shared/page/file-drop/canvas-encoder';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type {
  RowActivity,
  SessionRow,
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import {
  type AppSlashCommand,
  chatAllowEntryCommand,
  type ChatChannel,
  type ChatComposerPart,
  chatDenyEntryCommand,
  type ChatFocus,
  type ChatPlace,
  chatMoveFocusCommand,
  chatOpenImageCommand,
  chatPullBackMessageCommand,
  chatRemoveImageAtCommand,
  type ChatSessionInfo,
  type ChatSessionState,
  type ChatSidePart,
  type ChatStatusPart,
  chatToggleExpanderCommand,
  chatToggleRunCommand,
  type QueuedMessage,
  type ReturnedMessage,
} from '../contract';
import {
  type AttachReport,
  type Attachments,
  type ChatDropDeps,
  createAttachments,
  takeChatFiles,
} from './attachments';
import { placeReturned } from './chat-commands';
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
import type { CompletionRows } from './completion-rows';
import { composerInputOf } from './composer-input';
import { type ComposerSurface, createComposerSurface } from './composer-kit';
import {
  type ComposerStopHolder,
  createComposerStopHolder,
} from './composer-stop-holder';
import { blockIndexOfStop, entryIdOfStop } from './entry-focus';
import { createEntryList, type EntryList } from './entry-list';
import { sessionFactsOf, type SessionFactsSource } from './session-part';
import type { SideSections, SideTab } from './side-sections';
import { completionCommands } from './slash-commands';
import { compactionLabel } from './working-turn';

export interface ChatView {
  // Shows the session's Chat tab: activates the session (Sessions mode shows),
  // selects the tab, and focuses its box in insert mode with the cursor at
  // the end the next time the tab is the visible tab (at once when it is). A
  // session with no Chat tab yet gets this the moment its tab is added.
  reveal(sessionId: string): void;
  // The session whose Chat tab is the visible tab.
  visibleSessionId(): string | null;
  // The session's clock in `chat.session`, from before its tab is added; null for
  // a session with no key there.
  activeTime(sessionId: string): ActiveTime | null;
}

// A session as a log line and a call to main name it.
export interface SessionRef {
  sessionId: string;
  name: string;
}

// One held chat session as the commands act on it: its state as the view last
// applied it, whether its process runs, its message box, the images
// attached to its next message and its entries. `enterStop` offers the entry
// cursor to the composer parts' stops, in part order: the id of the part that
// took it, null when none did. `isBoxFocused` says whether the box holds
// focus now. `boxChanged` tells the tab's place that a `setText`, which reports
// no `changed`, replaced the box's text.
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
    | 'toggleFocusedBlock'
    | 'toggleRun'
    | 'toggleExpander'
    | 'moveFocusTo'
    | 'scrollBy'
  >;
  enterStop(): string | null;
  boxChanged(): void;
}

// The last page's place of one session's Chat tab, and the writes of its place
// now. `writeImages` writes the attached images; an empty list deletes their
// key.
export interface TabPlace {
  saved: ChatPlace | undefined;
  savedImages: readonly ChatImage[];
  write(place: ChatPlace): void;
  writeImages(images: readonly ChatImage[]): void;
}

// The session hub's keys, each acting on the visible Chat tab's hub while it
// holds the keys and logging `no Chat tab shown` with no visible Chat tab.
// `move` and `toEdge` walk the section heads and `toggle` folds or unfolds the
// cursor's section; `leave` gives the keys to the transcript, as Esc does;
// `scroll` scrolls the cursor's section body. `hiddenChanged` runs after the
// hub is hidden or shown: a hub no longer reachable gives its keys to the
// transcript while its own scope is in force. A key that finds no section
// shown does the same.
export interface HubKeys {
  move(by: 1 | -1): void;
  toEdge(edge: 'first' | 'last'): void;
  toggle(): void;
  leave(): void;
  scroll(step: ScrollStep, direction: 1 | -1): void;
  hiddenChanged(): void;
}

// The Chat view with what the commands read: the session a box belongs to,
// and a held session by id. `markSent` clears the done or error the
// session's row shows, as a message sent there does. `composerOf` is a held
// session's composer surface, for the part that places its activity dock.
// `sessionFactsSource` is a held session's facts for the hub's Session section,
// read live: `onChanged` fires after each status line draw. `hub` is the
// session hub's keys.
export interface ChatTabs extends ChatView {
  hub: HubKeys;
  session(sessionId: string): ChatSession | undefined;
  sessionOfEditor(editor: TextEditor): ChatSession | undefined;
  markSent(sessionId: string): void;
  ready(): void;
  // Ends every held tab; no tab starts after it.
  dispose(): void;
  composerOf(sessionId: string): ComposerSurface | null;
  sessionFactsSource(sessionId: string): SessionFactsSource | null;
  // A refusal naming the first of `rows` whose live box holds more than
  // whitespace or whose tab holds an attached image; null when none does.
  mayStop(
    rows: Iterable<Pick<SessionRow, 'sessionId' | 'label'>>,
  ): string | null;
}

// `allow` answers a permission entry allowed; `deny` asks for the reason
// first.
export interface PermissionActions {
  allow(session: SessionRef, entry: PermissionEntry): void;
  deny(session: SessionRef, entry: PermissionEntry): void;
}

// The base scopes a Chat tab sets: `chat` for the transcript, the box and a
// composer part's stop, `hub` while the session hub holds the keys.
export type ChatTabScope = 'chat' | 'hub';

// `setScope` sets the base scope, and `setFocusTarget` and `setResizeTarget`
// hand the core the tab's focus target and the divider the resize keys move
// after it, since a base scope change drops both; `otherSessionShown` runs when the
// Chat tab shown is another session's than the Chat tab shown before;
// `visibleSessionRested` runs when the visible Chat tab's process exits;
// `onSessionRemoved` hears the sessions plugin drop a row's tabs,
// `onActiveChanged` the focused pane's session change and
// `onSessionHostChanged` a row's host id change, `onScopeChanged` each change of
// the scope keys fire in, with that scope; `sessions` also takes each
// row's activity, and `activeSessionId` names the focused pane's session.
// `slots` holds chat's slots, and `ready`, which the host calls once every page
// part has started, reads the sessions already held and follows the slots from
// then. `activeTimeListeners`
// run when a session arrives and on each change of a held session's `activeTime`
// in `chat.session`, a throw skipping none of them. `run` runs
// a command, as the composer's chips and send button do, and `runKey` the
// command a click in a tab runs on what it landed on: a permission's Allow once
// or Deny, a thumbnail, an expander's head, an activity line, a stop, a pending
// row or an attached image's remove, each naming the tab's session; `keys` also anchors
// the composer's key hints; `layouts` holds the chat layouts the entries and
// the composer draw with; `paths` names each tab by its project folder, and with
// `homeDir` shows that folder in the hub's Session section. `placeOf` hands
// each tab made its session's place: the tab puts the saved draft, images and
// entry place back, and writes its place on each change.
// `slashCommands` reads the app slash commands registered now, which the `/`
// completion offers ahead of the agent's, and `completionRows` draws that
// completion's rows. `timers` and `clock` tick a live activity line's time and
// the activity dock's. `composerParts` holds the parts other plugins draw
// above every composer, `statusParts` those they draw in every status line;
// `sideParts` tells when a part beside every `.chat-main` comes or goes, and
// `sideSections` draws those parts as each tab's session hub.
// `drops` registers each Chat tab as the target of the
// files dropped or pasted on it, and saves a pasted file that is not an
// image. `writeFocus` writes `chat.focus` each time the visible Chat tab's focused
// stop changes, null at the view's dispose. `restoresSettled` is whether the
// part's restore window has settled.
export interface ChatViewDeps extends SurfaceKitDeps {
  channel: PageChannel<ChatChannel>;
  slots: ChatSlotReaders;
  paths: Paths;
  homeDir: string;
  sessions: Pick<SessionsPageExports, 'addTab' | 'activate' | 'setActivity'>;
  activeSessionId(): string | null;
  onSessionRemoved(listener: (sessionId: string) => void): void;
  onActiveChanged(listener: (sessionId: string | null) => void): void;
  onSessionHostChanged(listener: (sessionId: string) => void): void;
  onScopeChanged(listener: (scope: ViewScope | undefined) => void): void;
  activeTimeListeners: readonly ((
    sessionId: string,
    activeTime: ActiveTime,
  ) => void)[];
  editor: EditorHost;
  run(command: CommandId): void;
  runKey<A>(key: CommandKey<A>, arg: A): void;
  layouts: ChatLayouts;
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts' | 'onChanged'>;
  statusParts: Pick<PartStore<ChatStatusPart>, 'parts' | 'onChanged'>;
  sideParts: Pick<PartStore<ChatSidePart>, 'onChanged'>;
  sideSections: Pick<SideSections, 'openTab'>;
  confirm: CloseConfirm;
  slashCommands(): AppSlashCommand[];
  completionRows: CompletionRows;
  setScope(scope: ChatTabScope): void;
  setFocusTarget(target: FocusTarget | null): void;
  setResizeTarget(target: ResizeTarget | null): void;
  otherSessionShown(): void;
  visibleSessionRested(): void;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  placeOf(sessionId: string): TabPlace;
  writeFocus(focus: ChatFocus | null): void;
  restoresSettled(): boolean;
}

// Chat's slots as the page reads them.
export interface ChatSlotReaders {
  session: KeyedSlotReader<ChatSessionInfo>;
  entries: ListSlotReader<ChatEntry>;
  controls: KeyedSlotReader<SessionControl[]>;
  commands: KeyedSlotReader<AgentCommand[]>;
  queued: KeyedSlotReader<QueuedMessage[]>;
  returned: KeyedSlotReader<ReturnedMessage[]>;
}

// A held session's Chat tab. `state` is the view's last applied state: the
// baseline a `chat.session` write compares with. `handle` is null until `addTab` returns, and
// `box` and `dropTarget` until the editor mounts into the attached tab.
// `composerSize` follows the drawn composer's height for as long as the tab is
// held, and `rootSize` the tab's own size, under which the hub can hide.
// `unseen` is the finished turn the row still shows, and `activity` the
// activity last set on the row. `stop` holds the composer part holding the
// tab's entry cursor. `main` holds the entries and the composer; `side` is the
// tab's session hub; `isAtHub` is set while the hub holds the keys, and
// `cameToHub` names the pane the keys came to it from. `focusTarget` moves the
// focus keys between the tab's panes. `factsListeners` hear each status line draw.
// `placedReturned` holds each returned message's id once it is handed to the box:
// `chat.returned` is the whole list, which still names them until main hears
// `returnedPlaced`. `place` takes the tab's place on each change.
interface HeldTab {
  sessionId: string;
  name: string;
  state: ChatSessionState;
  handle: SessionTabHandle | null;
  unseen: Unseen;
  activity: RowActivity | null;
  box: TextEditor | null;
  isBoxFocused: boolean;
  root: HTMLElement;
  main: HTMLElement;
  side: SideTab;
  isAtHub: boolean;
  cameToHub: 'box' | 'transcript';
  focusTarget: FocusTarget;
  entries: EntryList;
  attachments: Attachments;
  composer: ComposerSurface;
  composerSize: ResizeObserver;
  rootSize: ResizeObserver;
  dropTarget: Disposable | null;
  stop: ComposerStopHolder;
  factsListeners: Set<() => void>;
  placedReturned: Set<string>;
  place: TabPlace;
}

// The session's state in the slots now, from `info`, the value of its key in
// `chat.session`: main writes that key after the session's lists.
function stateInSlots(
  info: ChatSessionInfo,
  slots: ChatSlotReaders,
): ChatSessionState {
  const { sessionId } = info;
  return {
    ...info,
    entries: [...slots.entries.get(sessionId)],
    controls: slots.controls.get(sessionId) ?? [],
    commands: slots.commands.get(sessionId) ?? [],
    queued: slots.queued.get(sessionId) ?? [],
    returned: slots.returned.get(sessionId) ?? [],
  };
}

// One Chat tab per chat session main holds, each with its entries, its
// pending rows and its composer (the activity line, attached images, message
// box, and the status line: repo, branch, type hint, control chips, status
// parts, running indicator, send) in its `.chat-main`, and the session hub
// beside that, kept up to date from chat's slots. A key deleted from a slot
// changes nothing: a closing session's tab stays as drawn until its row leaves.
// A tab added once the restore window settled is selected in its session; one
// added before, which a reload or chat's restore reopens, leaves the selection
// to the session's saved place. A layout change draws every tab's
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
  // The kinds whose failed draw has toasted since the layouts were shown.
  const toastedKinds = new Set<ChatEntryKind>();
  // The scope keys fire in, as `onScopeChanged` last reported it.
  let scopeInForce: ViewScope | undefined;
  // A hub holding the keys that can no longer be reached gives them to the
  // transcript, only while its own scope is in force: under another scope the
  // keys are not chat's to hand.
  const leaveUnreachableHub = (tab: HeldTab) => {
    const isHubInForce = tab.isAtHub && scopeInForce === HUB_SCOPE;
    if (isHubInForce && !tab.side.cursor.isReachable()) {
      hubToEntries(tab, deps);
    }
  };
  deps.layouts.onChange(() => {
    toastedKinds.clear();
    for (const tab of tabs.values()) {
      tab.entries.rebuild(tab.state.entries);
      drawComposer(tab);
      tab.side.rebuild();
      leaveUnreachableHub(tab);
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
      leaveUnreachableHub(tab);
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

  const { channel, slots } = deps;

  // Hands the box only the messages this page has not placed: each gets one
  // attempt per page load.
  const placeNewReturned = (tab: HeldTab, returned: ReturnedMessage[]) => {
    const fresh = returned.filter(({ id }) => !tab.placedReturned.has(id));
    for (const { id } of fresh) {
      tab.placedReturned.add(id);
    }
    // `tabs` holds a tab once `createTab` mounted its box.
    const session = sessionOf(tab, tab.box!, deps.composerParts);
    placeReturned({ tabs: view, channel, log }, session, fresh);
  };

  const add = (info: ChatSessionInfo) => {
    if (isDisposed || tabs.has(info.sessionId)) {
      return;
    }
    const state = stateInSlots(info, slots);
    const tab = createTab(state, toastedKinds, deps, {
      isHeld: (heldTab) => tabs.get(heldTab.sessionId) === heldTab,
      // Chat keys act only on the visible Chat tab's session. Every Chat tab
      // sets the same scope, so no pushed dialog hears a base change:
      // `otherSessionShown` closes the session's dialogs.
      shown: (shownTab) => {
        shownTab.stop.leave();
        takeKeys(shownTab, 'chat', deps);
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
        writeFocus(shownTab);
      },
      focusChanged: () => writeFocus(),
      beforeClose: (closing, atOnce) => mayClose(closing, deps, atOnce),
      resized: leaveUnreachableHub,
    });
    tabs.set(state.sessionId, tab);
    // A focus change while `createTab` ran found the tab not yet held.
    writeFocus();
    tab.side.sync();
    placeNewReturned(tab, state.returned);
    if (pendingReveal === tab.sessionId) {
      showRevealed(tab);
    }
    announceActiveTime(state.sessionId, state.activeTime);
  };

  // Runs the block of each value `info` changed. A fresh object from the Bridge
  // always differs by identity, so the two objects compare by what they hold.
  const applyInfo = (tab: HeldTab, info: ChatSessionInfo) => {
    const before = tab.state;
    tab.state = { ...before, ...info };
    if (info.running !== before.running) {
      showRunning(tab, before.running, log);
    }
    if (info.activity !== before.activity) {
      showActivity(tab, before.activity, deps);
    }
    if (info.background !== before.background) {
      log(`${tab.name} has ${info.background} running in the background`);
      drawActivity(tab, deps);
    }
    if (!isSameJson(info.activeTime, before.activeTime)) {
      announceActiveTime(info.sessionId, info.activeTime);
    }
    if (info.repo !== before.repo || info.branch !== before.branch) {
      showBranch(tab, log);
    }
    if (!isSameJson(info.worktrees, before.worktrees)) {
      showWorktrees(tab, log);
    }
    if (!isSameJson(info.compaction, before.compaction)) {
      showCompaction(tab, log);
    }
  };

  // A keyed slot's change for a held tab; a key with no tab loses nothing, since
  // `add` reads the slots when its `chat.session` key arrives, and a delete
  // changes nothing.
  const followKeyed = <V>(
    reader: KeyedSlotReader<V>,
    apply: (tab: HeldTab, value: V) => void,
  ) =>
    reader.on((sessionId, value) => {
      const tab = tabs.get(sessionId);
      if (tab !== undefined && value !== undefined) {
        apply(tab, value);
      }
    });

  // `running: false` reached `chat.session` first, with its draws.
  channel.on('sessionRested', ({ sessionId, error }) => {
    const tab = tabs.get(sessionId);
    if (tab === undefined) {
      return;
    }
    const wasActive = tab.state.activity !== 'idle';
    tab.unseen = unseenAfterRest(tab.unseen, error, wasActive);
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
    writeFocus();
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
  // Another tab, pane or mode took the keys; a scope over the visible tab keeps
  // its stop and its hub, whose ring shows only under the hub's own scope.
  // Chat's transcript scope in force means the hub holds nothing. The hub's
  // scope in force again finds a hub hidden meanwhile, under another scope.
  deps.onScopeChanged((scope) => {
    scopeInForce = scope;
    for (const tab of tabs.values()) {
      const isVisible = tab.handle?.isVisible() === true;
      tab.stop.scopeChanged(isVisible);
      if (!isVisible || scope === CHAT_SCOPE) {
        tab.isAtHub = false;
      }
      markHub(tab, scope);
    }
    if (scope === HUB_SCOPE) {
      const tab = visibleTab();
      if (tab !== undefined) {
        leaveUnreachableHub(tab);
      }
    }
  });

  const visibleTab = () =>
    [...tabs.values()].find((tab) => tab.handle?.isVisible() === true);
  // `chat.focus` as last written: chat's page writes null at its start.
  let writtenFocus: ChatFocus | null = null;
  // Writes the focus of `shownTab`, else of the visible tab, when it differs from
  // the last written. A tab shown inside `addTab` is not yet in `tabs`, and its
  // handle is not yet set, so `visibleTab` cannot find it.
  const writeFocus = (shownTab?: HeldTab) => {
    const next = focusOf(shownTab ?? visibleTab());
    if (!isSameJson(next, writtenFocus)) {
      writtenFocus = next;
      deps.writeFocus(next);
    }
  };
  const withVisibleTab = (act: (tab: HeldTab) => void) => {
    const tab = visibleTab();
    if (tab === undefined) {
      log('no Chat tab shown');
      return;
    }
    act(tab);
  };
  // Logs the cursor's section, or gives the keys to the transcript when no
  // section shows.
  const showHubCursor = (tab: HeldTab, title: string | null) => {
    if (title === null) {
      hubToEntries(tab, deps);
    } else {
      log(`hub cursor on ${title}`);
    }
  };
  const hub: HubKeys = {
    move: (by) =>
      withVisibleTab((tab) => showHubCursor(tab, tab.side.cursor.move(by))),
    toEdge: (edge) =>
      withVisibleTab((tab) => showHubCursor(tab, tab.side.cursor.toEdge(edge))),
    toggle: () =>
      withVisibleTab((tab) => {
        if (tab.side.cursor.toggle() === null) {
          hubToEntries(tab, deps);
        }
      }),
    leave: () => withVisibleTab((tab) => hubToEntries(tab, deps)),
    scroll: (step, direction) =>
      withVisibleTab((tab) => {
        const scrolled = tab.side.cursor.scrollBy(step, direction);
        if (scrolled === null) {
          hubToEntries(tab, deps);
          return;
        }
        const what = `the ${scrolled.title} section`;
        log(scrollText(what, step, direction, scrolled.scroll));
      }),
    hiddenChanged() {
      const tab = visibleTab();
      if (tab !== undefined) {
        leaveUnreachableHub(tab);
      }
    },
  };

  const asSession = (tab: HeldTab | undefined): ChatSession | undefined =>
    tab === undefined || tab.box === null
      ? undefined
      : sessionOf(tab, tab.box, deps.composerParts);

  const view: ChatTabs = {
    hub,
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
    activeTime: (sessionId) => slots.session.get(sessionId)?.activeTime ?? null,
    session: (sessionId) => asSession(tabs.get(sessionId)),
    sessionOfEditor: (editor) =>
      asSession([...tabs.values()].find((tab) => tab.box === editor)),
    markSent: clearUnseen,
    // Reads the sessions already held, then follows the slots.
    ready() {
      try {
        callEach([...slots.session.all().values()], add);
      } catch (error) {
        log(`chat session arrival failed: ${errorText(error)}`);
      }
      slots.session.on((sessionId, info) => {
        if (info === undefined) {
          return;
        }
        const tab = tabs.get(sessionId);
        if (tab === undefined) {
          add(info);
        } else {
          applyInfo(tab, info);
        }
      });
      slots.entries.on((sessionId, change) => {
        const tab = tabs.get(sessionId);
        if (tab === undefined || change.kind === 'delete') {
          return;
        }
        if (change.kind === 'put') {
          putEntry(tab, change.item, log);
        } else {
          replaceEntries(tab, change.items, log);
        }
      });
      followKeyed(slots.controls, (tab, controls) =>
        setControls(tab, controls, log),
      );
      followKeyed(slots.commands, (tab, commands) => {
        tab.state = { ...tab.state, commands };
      });
      followKeyed(slots.queued, (tab, queued) => {
        tab.state = { ...tab.state, queued };
        tab.entries.setQueued(queued);
        log(`${queued.length} pending message(s) in ${tab.name}`);
      });
      followKeyed(slots.returned, (tab, returned) => {
        tab.state = { ...tab.state, returned };
        placeNewReturned(tab, returned);
      });
    },
    // `chat.focus` outlives the view, so it goes null before the tabs end.
    dispose() {
      isDisposed = true;
      const held = [...tabs.values()];
      tabs.clear();
      writeFocus();
      callEach(held, tearDownTab);
    },
    composerOf: (sessionId) => tabs.get(sessionId)?.composer ?? null,
    sessionFactsSource: (sessionId) => {
      const tab = tabs.get(sessionId);
      return tab === undefined ? null : sessionFactsSourceOf(tab, deps);
    },
    mayStop(rows) {
      for (const { sessionId, label } of rows) {
        const tab = tabs.get(sessionId);
        if (tab !== undefined && holdsDraft(tab)) {
          return `Send or clear the draft in ${label}'s chat first`;
        }
      }
      return null;
    },
  };
  return view;
}

// The tab's focused stop as `chat.focus` holds it; null with no tab, no focused
// stop, or while a composer part's stop holds the cursor.
function focusOf(tab: HeldTab | undefined): ChatFocus | null {
  if (tab === undefined || tab.stop.holding() !== null) {
    return null;
  }
  const stopId = tab.entries.focusedStopId();
  return stopId === null
    ? null
    : {
        sessionId: tab.sessionId,
        entryId: entryIdOfStop(stopId),
        block: blockIndexOfStop(stopId),
      };
}

// Whether the tab's live box holds text beyond whitespace or the tab holds an
// attached image.
function holdsDraft(tab: HeldTab): boolean {
  const hasText = (tab.box?.text().trim() ?? '') !== '';
  const hasImage = tab.attachments.images().length > 0;
  return hasText || hasImage;
}

// Ends what the tab holds that outlives its element.
function tearDownTab(tab: HeldTab) {
  callEach<() => void>(
    [
      () => tab.stop.leave(),
      () => tab.dropTarget?.dispose(),
      () => tab.box?.destroy(),
      () => tab.composerSize.disconnect(),
      () => tab.rootSize.disconnect(),
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
    input: () => sessionFactsOf(composerInputOf(tab), tab.state, deps),
    onChanged(listener) {
      // A wrapper per subscription, so each handle removes only its own.
      const wrapped = () => listener();
      tab.factsListeners.add(wrapped);
      return { dispose: () => tab.factsListeners.delete(wrapped) };
    },
  };
}

// What handing over the keys calls.
type KeysDeps = Pick<
  ChatViewDeps,
  'setScope' | 'setFocusTarget' | 'setResizeTarget'
>;

type PaneDeps = KeysDeps & Pick<ChatViewDeps, 'log'>;

// The hub's and the transcript's scopes as the core names them in force.
const HUB_SCOPE = 'chat.hub';
const CHAT_SCOPE = 'chat.chat';

// Marks the tab `is-at-hub` while the hub holds its keys, which hides the
// transcript's cursor bar under any scope, and `is-hub-in-force` while the
// hub's own scope is in force too, which rings the hub's cursor head.
function markHub(tab: HeldTab, scope: ViewScope | undefined) {
  tab.root.classList.toggle('is-at-hub', tab.isAtHub);
  tab.root.classList.toggle(
    'is-hub-in-force',
    tab.isAtHub && scope === HUB_SCOPE,
  );
}

// Gives the tab the keys in `scope`: the hub flag first, so the scope's
// listeners read it, then the scope, then the targets its change dropped.
// The hub's mark follows the flag even when a pushed scope hides the change.
function takeKeys(tab: HeldTab, scope: ChatTabScope, deps: KeysDeps) {
  tab.isAtHub = scope === 'hub';
  tab.root.classList.toggle('is-at-hub', tab.isAtHub);
  deps.setScope(scope);
  handTargets(tab, deps);
}

// The tab's focus target, and the hub's divider as the resize target while the
// hub holds the keys.
function handTargets(tab: HeldTab, deps: KeysDeps) {
  deps.setResizeTarget(tab.isAtHub ? tab.side.divider : null);
  deps.setFocusTarget(tab.focusTarget);
}

// Chat's scope in force again and the cursor on the stop `G` focuses.
function cursorToEntries(tab: HeldTab, deps: KeysDeps) {
  takeKeys(tab, 'chat', deps);
  tab.entries.latest();
}

// The focus keys inside one Chat tab: Alt+l from the transcript, the box or a
// composer part's stop enters the hub while it is reachable, and Alt+h there
// returns to the box or the transcript the keys came from; Alt+j goes from the
// transcript or the stop to the box, Alt+k from the box or the stop to the
// transcript. Every other move returns false.
function movePane(
  tab: HeldTab,
  direction: PaneDirection,
  deps: PaneDeps,
): boolean {
  if (tab.isAtHub) {
    if (direction !== 'left') {
      return false;
    }
    if (tab.cameToHub === 'box') {
      focusBox(tab, deps);
    } else {
      hubToEntries(tab, deps);
    }
    return true;
  }
  const isAtStop = tab.stop.holding() !== null;
  if (direction === 'right') {
    if (!tab.side.cursor.isReachable()) {
      return false;
    }
    const isFromBox = !isAtStop && tab.isBoxFocused;
    enterHub(tab, isFromBox ? 'box' : 'transcript', deps);
    return true;
  }
  if (isAtStop && direction === 'up') {
    tab.stop.leave();
    cursorToEntries(tab, deps);
    deps.log(`cursor back on the entries in ${tab.name}`);
    return true;
  }
  const isFromTranscript = isAtStop || !tab.isBoxFocused;
  if (isFromTranscript && direction === 'down') {
    tab.stop.leave();
    focusBox(tab, deps);
    return true;
  }
  if (!isFromTranscript && direction === 'up') {
    tab.box?.blur({ toNormal: true });
    takeKeys(tab, 'chat', deps);
    deps.log('left the box');
    return true;
  }
  return false;
}

// Focuses the box in the vim mode it was left in, with chat's keys.
function focusBox(tab: HeldTab, deps: PaneDeps) {
  takeKeys(tab, 'chat', deps);
  tab.side.cursor.leave();
  tab.box?.focus();
  deps.log(`focused the box in ${tab.name}`);
}

// Leaves the box in normal mode or the stop, and gives the hub the keys.
function enterHub(tab: HeldTab, from: 'box' | 'transcript', deps: PaneDeps) {
  if (from === 'box') {
    tab.box?.blur({ toNormal: true });
  }
  tab.stop.leave();
  tab.cameToHub = from;
  takeKeys(tab, 'hub', deps);
  tab.side.cursor.enter();
  deps.log(`focused the session hub in ${tab.name}`);
}

// The hub gives the keys to the transcript, its entry cursor where it was.
function hubToEntries(tab: HeldTab, deps: PaneDeps) {
  takeKeys(tab, 'chat', deps);
  tab.side.cursor.leave();
  deps.log(`cursor back on the entries in ${tab.name}`);
}

// Asks main for the session's earlier conversation each time its tab shows;
// main reads it once, and it arrives as a `replace` in `chat.entries`.
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
    boxChanged: () => writeTabPlace(tab),
  };
}

// Writes the tab's draft and entry place; none before the box mounts, so the
// first draws leave the last page's place for the tab to put back.
function writeTabPlace(tab: HeldTab) {
  if (tab.box === null) {
    return;
  }
  tab.place.write({ draft: tab.box.text(), ...tab.entries.place() });
}

// The tab element (`div.chat-tab`: `div.chat-main`, then the session hub's
// holder, which the caller fills through `side.sync` once it holds the tab;
// `.chat-main` holds the entries, then the floating composer holding
// other plugins' parts, the activity line, the attached images' strip, the box
// and its status line) added to its session, with the box's editor mounted
// once the element is attached; it is marked `is-at-stop` while a composer part's stop
// holds the entry cursor, and the box taking focus leaves that part, and
// `is-at-hub` while the hub holds the keys; the box taking focus, a pointer
// down on the entries, or the tab shrinking until the hub hides ends the hub's
// turn (`view.resized` runs on each size change). Once the restore window
// settled, the tab then selects itself, so a new chat session opens on its Chat
// tab whichever plugin's tab the session got first; a tab added before leaves
// the session's saved selection in place, so a reload or a live restart keeps
// it. `view.shown` may run inside `addTab`,
// before the handle and box are set. Once the box is mounted the tab element is
// the target of the files dropped or pasted on it; `view.isHeld` answers
// whether the tab is still held, so a take that outlives it stops. The tab
// element carries `data-chat-session` with its session id. `view.focusChanged`
// runs on each change of the entry cursor or of the composer stop's hold, and
// when the tab is hidden.
function createTab(
  state: ChatSessionState,
  toastedKinds: Set<ChatEntryKind>,
  deps: ChatViewDeps,
  view: {
    isHeld(tab: HeldTab): boolean;
    shown(tab: HeldTab): void;
    focusChanged(): void;
    beforeClose(tab: HeldTab, atOnce: boolean): boolean | Promise<boolean>;
    resized(tab: HeldTab): void;
  },
): HeldTab {
  const name = folderName(state.projectDir, deps.paths);
  const { sessionId } = state;
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
      state: deps.state,
      run: deps.run,
      composerParts: deps.composerParts,
      statusParts: deps.statusParts,
      log: deps.log,
      clock: deps.clock,
      timers: deps.timers,
    },
    {
      sessionId,
      box: boxElement,
      removeImage: (index) =>
        deps.runKey(chatRemoveImageAtCommand, { sessionId, index }),
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
      state: deps.state,
      allow: (entry) =>
        deps.runKey(chatAllowEntryCommand, { sessionId, entryId: entry.id }),
      deny: (entry) =>
        deps.runKey(chatDenyEntryCommand, { sessionId, entryId: entry.id }),
      openImages: (entryId, index) =>
        deps.runKey(chatOpenImageCommand, { sessionId, entryId, index }),
      expanderClicked: (entryId, place) =>
        deps.runKey(chatToggleExpanderCommand, { sessionId, entryId, place }),
    },
    log: deps.log,
    toast: deps.toast,
    timers: deps.timers,
    clock: deps.clock,
    pullBack: (queuedId) =>
      deps.runKey(chatPullBackMessageCommand, { sessionId, queuedId }),
    runClicked: (runId) =>
      deps.runKey(chatToggleRunCommand, { sessionId, runId }),
    stopClicked: (stopId) =>
      deps.runKey(chatMoveFocusCommand, { sessionId, stopId }),
    turnLine: composer.turnLineSlot,
    placeChanged: () => writeTabPlace(tab),
    focusChanged: () => view.focusChanged(),
  });
  const place = deps.placeOf(sessionId);
  attachments.onChange((images) => {
    composer.drawAttachments(images);
    place.writeImages(images);
  });
  const root = element('div', 'chat-tab');
  root.dataset.chatSession = sessionId;
  const main = element('div', 'chat-main');
  main.append(entries.element);
  root.append(main);
  const tab: HeldTab = {
    sessionId: state.sessionId,
    name,
    state,
    handle: null,
    unseen: null,
    activity: null,
    box: null,
    isBoxFocused: false,
    root,
    main,
    side: deps.sideSections.openTab(root, state.sessionId),
    isAtHub: false,
    cameToHub: 'transcript',
    focusTarget: { move: (direction) => movePane(tab, direction, deps) },
    entries,
    attachments,
    composer,
    composerSize: followComposerHeight(root, entries),
    rootSize: new ResizeObserver(() => view.resized(tab)),
    dropTarget: null,
    stop: createComposerStopHolder({
      sessionId: state.sessionId,
      name,
      toEntries: () => cursorToEntries(tab, deps),
      toBox: (how) => {
        takeKeys(tab, 'chat', deps);
        tab.box?.focus(
          how === 'insert' ? { insert: true } : { insertAtEnd: true },
        );
      },
      setChatScope: () => takeKeys(tab, 'chat', deps),
      // A part taking the stop has set its own scope, which dropped the targets.
      changed: (holding) => {
        root.classList.toggle('is-at-stop', holding);
        if (holding) {
          handTargets(tab, deps);
        }
        view.focusChanged();
      },
      log: deps.log,
    }),
    factsListeners: new Set(),
    placedReturned: new Set(),
    place,
  };
  tab.rootSize.observe(root);
  entries.element.addEventListener('pointerdown', () => {
    if (tab.isAtHub) {
      hubToEntries(tab, deps);
    }
  });
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
    order: 2,
    beforeClose: (atOnce) => view.beforeClose(tab, atOnce),
    shown: () => view.shown(tab),
    hidden: () => view.focusChanged(),
  });
  tab.box = deps.editor.create(
    boxElement,
    '',
    {
      changed: () => writeTabPlace(tab),
      focused: () => {
        tab.stop.boxFocused();
        if (tab.isAtHub) {
          takeKeys(tab, 'chat', deps);
        }
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
      completions: boxCompletions(tab, deps),
      hidesModeLine: true,
    },
  );
  restoreTabPlace(tab, tab.box);
  const dropDeps = chatDropDepsOf(tab, tab.box, () => view.isHeld(tab), deps);
  tab.dropTarget = deps.drops.addTarget({
    element: root,
    take: (files) => void takeChatFiles(files, dropDeps),
  });
  drawActivity(tab, deps);
  if (deps.restoresSettled()) {
    tab.handle.select();
  }
  return tab;
}

// Puts the last page's draft into `box`, its images back on the tab and its
// entry place on the list.
function restoreTabPlace(tab: HeldTab, box: TextEditor) {
  const { saved, savedImages } = tab.place;
  for (const image of savedImages) {
    tab.attachments.add(image);
  }
  if (saved !== undefined) {
    box.setText(saved.draft);
    tab.entries.restorePlace(saved);
  }
}

// The `/` completion of the tab's box. The commands are read on each call:
// they can arrive or register after the box exists, so a row's word may no
// longer be in the list, and that row shows its name alone.
function boxCompletions(
  tab: HeldTab,
  deps: Pick<ChatViewDeps, 'slashCommands' | 'completionRows' | 'log'>,
): EditorCompletions {
  const commands = () =>
    completionCommands(deps.slashCommands(), tab.state.commands);
  return {
    prefix: '/',
    items: () =>
      commands().map(({ name, aliases }) => ({ word: name, aliases })),
    drawRow: (word, row) => {
      const command = commands().find(({ name }) => name === word);
      if (command !== undefined) {
        deps.completionRows.draw(command, row);
      }
    },
    offered: (words) =>
      deps.log(
        `completions offered: ${words.map((word) => `/${word}`).join(', ')}`,
      ),
    accepted: (word) => deps.log(`completion accepted: /${word}`),
  };
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

function replaceEntries(
  tab: HeldTab,
  items: readonly ChatEntry[],
  log: PluginLog,
) {
  const entries = [...items];
  tab.state = { ...tab.state, entries };
  tab.entries.rebuild(entries);
  drawTurn(tab);
  log(`${entries.length} entries read in ${tab.name}`);
}

// `tab.state.running` changed: it owns the working line, whichever way it went.
function showRunning(tab: HeldTab, wasRunning: boolean, log: PluginLog) {
  tab.entries.setWorking(isWorking(tab.state));
  drawTurn(tab);
  drawStatusLine(tab);
  if (!wasRunning) {
    log(`${tab.name} running`);
  }
}

// `tab.state.activity` changed from `previous`.
function showActivity(
  tab: HeldTab,
  previous: ProcessActivity,
  deps: Pick<ChatViewDeps, 'sessions' | 'activeSessionId' | 'log'>,
) {
  const { activity } = tab.state;
  tab.entries.setWorking(isWorking(tab.state));
  drawTurn(tab);
  if (previous !== 'idle' && activity === 'idle') {
    tab.entries.latest();
    const focused = deps.activeSessionId() === tab.sessionId;
    tab.unseen = unseenAfterTurnEnd(tab.unseen, focused, tab.state.background);
  }
  if (previous === 'idle' && activity !== 'idle') {
    tab.unseen = null;
  }
  deps.log(`${tab.name} is ${activity}`);
  drawActivity(tab, deps);
  drawStatusLine(tab);
}

function showBranch(tab: HeldTab, log: PluginLog) {
  const { repo, branch } = tab.state;
  drawStatusLine(tab);
  log(
    branch === null
      ? `${tab.name} is in ${repo}, no branch`
      : `${tab.name} is in ${repo} on ${branch}`,
  );
}

function showWorktrees(tab: HeldTab, log: PluginLog) {
  drawStatusLine(tab);
  const { worktrees } = tab.state;
  const noun = worktrees.length === 1 ? 'worktree' : 'worktrees';
  log(`${tab.name} wrote in ${noun} ${worktrees.join(', ')}`);
}

function showCompaction(tab: HeldTab, log: PluginLog) {
  const { compaction } = tab.state;
  drawTurn(tab);
  drawStatusLine(tab);
  log(
    compaction === null
      ? `${tab.name} compaction ended`
      : `${tab.name} compacting: ${compactionLabel(compaction)}`,
  );
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
// Chat tab shows and the end-session confirmation answers. A close another
// tab asked to make at once asks nothing.
function mayClose(
  tab: HeldTab,
  deps: ChatViewDeps,
  atOnce: boolean,
): boolean | Promise<boolean> {
  if (atOnce) {
    return true;
  }
  const isBusy = tab.state.running && tab.state.activity !== 'idle';
  if (!isBusy) {
    return true;
  }
  tab.handle?.select();
  blurFocusedElement();
  deps.log(`closing the session asks to end ${tab.name}`);
  return deps.confirm.open(tab.name);
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
