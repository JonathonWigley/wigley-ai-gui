import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type { CommandsRunIn, PageChannel } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { LayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { textBoxInput } from '../../../shared/page/text-box';
import { sheet } from '../../../shared/page/ui/sheet';
import type {
  BoardRow,
  ChatroomChannel,
  ChatroomPlace,
  ClaimTarget,
  RoomMessage,
  RoomView,
} from '../contract';
import type {
  BoardLineInput,
  ChatroomKit,
  ChatroomPart,
  CompleteLayout,
  Layout,
  MessageInput,
  RoomGroupInput,
} from '../layouts/layout';
import { chatroomManifest } from '../manifest';
import {
  type ComposerIntent,
  type CursorMove,
  canReplyTo,
  clockTime,
  isQuietKind,
  movedIndex,
  parseThreadKey,
  senderName,
  threadKey,
  threadLabel,
  threadList,
  userPostFor,
} from './chatroom-state';
import {
  PREVIEW_MESSAGES,
  PREVIEW_ROOM,
  PREVIEW_ROOM_VIEW,
  PREVIEW_THREAD,
} from './preview-sample';

// The base scopes the view sets: the side bar's thread list, the log and the
// composer.
export type ChatroomScope = 'threads' | 'log' | 'composer';

// Every page command but those the page part runs itself: the mode, the
// preview and the clicks, which take an arg.
export type ChatroomViewCommand = Exclude<
  CommandsRunIn<typeof chatroomManifest, 'page'>,
  'showMode' | 'preview' | 'openThreadRow' | 'openRowRoom'
>;

// No panes of its own: every focus move goes on to the core, so Alt+h from
// the log reaches the side bar.
const FOCUS_TARGET: FocusTarget = { move: () => false };

export interface ChatroomViewDeps {
  channel: PageChannel<ChatroomChannel>;
  log: PluginLog;
  kitServices: OwnerKitServices;
  parts: LayoutParts<Layout, CompleteLayout>;
  // The rooms of `chatroom.rooms`, as they are now.
  rooms(): readonly RoomView[];
  // The label of the harness `id` names.
  harnessLabel(id: string): string;
  setScope(scope: ChatroomScope): void;
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  isShown(): boolean;
  // Shows Chatroom mode.
  showMode(): void;
  // Hears each thread the user opens from the side bar.
  picked(): void;
  // Hears the shown thread's label for the title bar, null for none.
  shownThread(label: string | null): void;
  // The last page's place, opened once its room and thread are in the rooms;
  // null for none.
  savedPlace: ChatroomPlace | null;
  // Hears the place at each opened thread.
  placeChanged(place: ChatroomPlace): void;
}

// Chatroom mode's view: the thread list for the side bar, and in the sheet
// the room's board, the open thread's log and the composer, each drawn
// through the layout picked for its part, logging under `chatroom`. Opening
// a thread reads it whole, then each `roomChanged` of its room whose thread
// grew past the last id held reads past that id, one read at a time; a read
// for a thread no longer open is dropped. While the mode shows, each read's
// last id is marked read for the user. `showPreview` shows the preview's
// sample in place of the rooms until the mode hides or a real thread opens.
export interface ChatroomView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  shown(): void;
  hidden(): void;
  sideBarHidden(): void;
  sideBarOpenedOver(): void;
  focusSideBar(): void;
  focusMain(): void;
  // Opens the last page's thread when the rooms hold it; each `roomChanged`
  // tries again until a thread opens.
  restorePlace(): void;
  // The key `room` of `chatroom.rooms` changed.
  roomChanged(room: string): void;
  // Draws every part again, after a layouts set.
  redraw(): void;
  commands: Record<ChatroomViewCommand, () => void>;
  // Opens the thread a `threadKey` names, as Enter on its row does; text that
  // is no key logs `no thread <text>`.
  openThreadRow(key: string): void;
  // Opens `thread` of `room` and puts the list cursor on it.
  openRoomThread(room: string, thread: string): void;
  showPreview(): void;
  dispose(): void;
}

// The thread the sheet shows, its messages in id order, and the log cursor's
// message id, null before the first read lands. `isRead` is true once a read
// landed.
interface ThreadPane {
  room: string;
  thread: string;
  messages: RoomMessage[];
  cursorId: number | null;
  isRead: boolean;
}

// One message's wrapper in the log, and the part last drawn in it.
interface MessageSlot {
  wrapper: HTMLElement;
  drawn: DrawnPart<ChatroomPart> | null;
}

export function createChatroomView(deps: ChatroomViewDeps): ChatroomView {
  const { channel, log, parts } = deps;

  // ── Elements ───────────────────────────────────────────────────────────
  const sidePane = element('div', 'chatroom-side');
  sidePane.tabIndex = -1;
  const mainPane = element('div', 'chatroom-main');
  mainPane.tabIndex = -1;
  const boardSlot = element('div', 'chatroom-board-slot');
  const logList = element('div', 'chatroom-log');
  const composerSlot = element('div', 'chatroom-composer-slot');
  const composerBox = textBoxInput('chatroom-composer-input');
  mainPane.append(boardSlot, logList, composerSlot);
  const contentSheet = sheet();
  contentSheet.classList.add('chatroom-sheet');
  contentSheet.append(mainPane);

  // ── State ──────────────────────────────────────────────────────────────
  let real: ThreadPane | null = null;
  let preview: ThreadPane | null = null;
  // The last id `markUserRead` was asked for in the real thread.
  let lastMarked = 0;
  let focus: ChatroomScope = 'threads';
  let listCursor: string | null = null;
  let intent: ComposerIntent = { kind: 'note' };
  let composerError: string | null = null;
  let isSending = false;
  let isReading = false;
  let readsAgain = false;
  let isDisposed = false;
  let pendingPlace = placeToOpen(deps.savedPlace);
  const messageSlots = new Map<number, MessageSlot>();

  const pane = (): ThreadPane | null => preview ?? real;
  const shownRooms = (): readonly RoomView[] =>
    preview === null ? deps.rooms() : [PREVIEW_ROOM_VIEW];
  const roomViewOf = (room: string) =>
    shownRooms().find((view) => view.room === room);
  const boardOf = (room: string): readonly BoardRow[] =>
    roomViewOf(room)?.board ?? [];
  const lastHeld = (thread: ThreadPane) => thread.messages.at(-1)?.id ?? 0;
  const kitFor = (scope: ChatroomScope, rollback: RollbackDeps): ChatroomKit =>
    createBaseKit(
      ownerBaseKitDeps(chatroomManifest, deps.kitServices, scope, rollback),
    );

  // ── Drawing ────────────────────────────────────────────────────────────
  const drawSideBar = () => {
    const shown = pane();
    const rooms: RoomGroupInput[] = threadList(shownRooms()).map((group) => ({
      room: group.room,
      threads: group.threads.map((row) => {
        const key = threadKey(row.room, row.thread);
        return {
          label: row.label,
          resolved: row.resolved,
          unread: row.unread,
          mentions: row.mentions,
          isCursor: key === listCursor && focus === 'threads',
          isOpen: shown !== null && key === threadKey(shown.room, shown.thread),
          arg: key,
        };
      }),
    }));
    parts.redraw('sideBar', sidePane, (sideBar, into, rollback) =>
      sideBar(
        into,
        { rooms, preview: preview !== null },
        kitFor('threads', rollback),
      ),
    );
    sidePane.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const drawBoard = () => {
    const shown = pane();
    const board = shown === null ? [] : boardOf(shown.room);
    parts.redraw('board', boardSlot, (boardPart, into, rollback) =>
      boardPart(
        into,
        {
          room: shown?.room ?? null,
          thread: shown === null ? null : threadLabel(board, shown.thread),
          rows: board.map((row) => boardLineOf(row, deps.harnessLabel)),
          preview: preview !== null,
        },
        kitFor('log', rollback),
      ),
    );
  };

  const messageInput = (
    thread: ThreadPane,
    message: RoomMessage,
  ): MessageInput => ({
    id: message.id,
    sender: senderName(message),
    kind: message.kind,
    quiet: isQuietKind(message.kind),
    time: clockTime(message.at),
    body: message.body,
    refs: message.refs.map((ref) => ({ type: ref.type, value: ref.value })),
    to: message.to.map((participant) => participant.name),
    replyTo: message.replyTo,
    isCursor: message.id === thread.cursorId && focus === 'log',
    canReply: canReplyTo(message),
  });

  const disposeSlot = (slot: MessageSlot) => {
    const drawn = slot.drawn;
    slot.drawn = null;
    try {
      drawn?.dispose();
    } finally {
      slot.wrapper.replaceChildren();
    }
  };

  // Draws `message` into its wrapper, adding the wrapper at the log's end
  // when it has none.
  const drawMessage = (thread: ThreadPane, message: RoomMessage) => {
    let slot = messageSlots.get(message.id);
    if (slot === undefined) {
      slot = { wrapper: element('div', 'chatroom-log-item'), drawn: null };
      messageSlots.set(message.id, slot);
      logList.append(slot.wrapper);
    } else {
      disposeSlot(slot);
    }
    slot.drawn = parts.draw('message', slot.wrapper, (part, into, rollback) =>
      part(into, messageInput(thread, message), kitFor('log', rollback)),
    );
  };

  const redrawMessage = (id: number | null) => {
    const thread = pane();
    const message = thread?.messages.find((held) => held.id === id);
    if (thread !== null && message !== undefined) {
      drawMessage(thread, message);
    }
  };

  const scrollLogCursor = () =>
    logList.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });

  const rebuildLog = () => {
    for (const slot of messageSlots.values()) {
      disposeSlot(slot);
    }
    messageSlots.clear();
    logList.replaceChildren();
    const thread = pane();
    if (thread !== null) {
      for (const message of thread.messages) {
        drawMessage(thread, message);
      }
    }
    scrollLogCursor();
  };

  const drawComposer = () => {
    composerSlot.hidden = pane() === null;
    const hadFocus = document.activeElement === composerBox;
    parts.redraw('composer', composerSlot, (composer, into, rollback) => {
      const slot = appSlot(composerBox, 'textBox', rollback);
      const built = composer(
        into,
        {
          answerTo: intent.kind === 'reply' ? intent.message.id : null,
          error: composerError,
          preview: preview !== null,
        },
        { ...kitFor('composer', rollback), textBox: slot.place },
      );
      slot.placeIfLeftOut(requireElementIn(into, built.element, 'composer'));
      return built;
    });
    if (hadFocus) {
      composerBox.focus();
    }
  };

  const noteShownThread = () => {
    const shown = pane();
    deps.shownThread(
      shown === null ? null : threadLabel(boardOf(shown.room), shown.thread),
    );
  };

  const drawAll = () => {
    drawSideBar();
    drawBoard();
    rebuildLog();
    drawComposer();
  };

  // ── Focus ──────────────────────────────────────────────────────────────
  // The one setter of the keys' pane: sets the scope and the targets and
  // moves the DOM focus there while the mode shows, then redraws the cursors.
  const setFocus = (next: ChatroomScope, movesFocus = true) => {
    const before = focus;
    focus = next;
    if (deps.isShown()) {
      deps.setScope(next);
      deps.setResizeTarget(null);
      deps.setFocusTarget(FOCUS_TARGET);
      if (movesFocus) {
        focusElementOf(next).focus();
      }
    }
    if (before !== next) {
      drawSideBar();
      redrawMessage(pane()?.cursorId ?? null);
    }
  };

  const focusElementOf = (scope: ChatroomScope): HTMLElement => {
    switch (scope) {
      case 'threads':
        return sidePane;
      case 'log':
        return mainPane;
      case 'composer':
        return composerBox;
    }
  };

  // A click or a box's focus hands its pane the keys.
  sidePane.addEventListener('focusin', () => {
    if (focus !== 'threads') {
      setFocus('threads', false);
    }
  });
  mainPane.addEventListener('focusin', (event) => {
    const next = event.target === composerBox ? 'composer' : 'log';
    if (focus !== next) {
      setFocus(next, false);
    }
  });

  // ── Reads ──────────────────────────────────────────────────────────────
  const markRead = () => {
    if (real === null || preview !== null || !deps.isShown()) {
      return;
    }
    const held = lastHeld(real);
    if (held <= lastMarked) {
      return;
    }
    lastMarked = held;
    const { room, thread } = real;
    channel.invoke('markUserRead', room, thread, held).catch((error) => {
      log(`not marked read: ${room}/${thread}: ${errorText(error)}`);
    });
  };

  const setLogCursor = (thread: ThreadPane, id: number | null) => {
    const before = thread.cursorId;
    thread.cursorId = id;
    if (before === id || thread !== pane()) {
      return;
    }
    redrawMessage(before);
    redrawMessage(id);
    scrollLogCursor();
    const message = thread.messages.find((held) => held.id === id);
    if (message !== undefined) {
      log(
        `log cursor on #${message.id} ${message.kind} from ${senderName(message)}`,
      );
    }
  };

  // Appends the messages above the thread's last id held, in id order. The
  // log cursor follows to the newest message while it sat on the last one.
  const appendMessages = (
    thread: ThreadPane,
    messages: readonly RoomMessage[],
  ) => {
    const held = lastHeld(thread);
    const fresh = messages
      .filter((message) => message.id > held)
      .sort((a, b) => a.id - b.id);
    const followsNewest = thread.cursorId === null || thread.cursorId === held;
    thread.messages.push(...fresh);
    const isShownPane = thread === pane();
    if (isShownPane) {
      for (const message of fresh) {
        drawMessage(thread, message);
      }
    }
    if (!thread.isRead) {
      thread.isRead = true;
      log(
        `thread shown: ${thread.room}/${thread.thread} (${thread.messages.length} messages)`,
      );
    }
    const newest = thread.messages.at(-1)?.id ?? null;
    if (followsNewest && newest !== null) {
      setLogCursor(thread, newest);
    }
    markRead();
  };

  // One read at a time for the open thread: a read asked for meanwhile runs
  // once the one in flight ends.
  const readOpen = () => {
    const target = real;
    if (target === null || isDisposed) {
      return;
    }
    if (isReading) {
      readsAgain = true;
      return;
    }
    isReading = true;
    channel
      .invoke('readThread', target.room, target.thread, lastHeld(target))
      .then(
        (messages) => {
          if (real === target && !isDisposed) {
            appendMessages(target, messages);
          }
        },
        (error: unknown) => {
          log(
            `thread not read: ${target.room}/${target.thread}: ${errorText(error)}`,
          );
        },
      )
      .finally(() => {
        isReading = false;
        if (readsAgain) {
          readsAgain = false;
          readOpen();
        }
      });
  };

  // ── Opening ────────────────────────────────────────────────────────────
  const setListCursor = (key: string | null) => {
    if (key === listCursor) {
      return;
    }
    listCursor = key;
    const parsed = key === null ? null : parseThreadKey(key);
    if (parsed !== null) {
      log(`list cursor on ${parsed.room}/${parsed.thread}`);
    }
    drawSideBar();
  };

  // Puts the list cursor on the first row when it is on none.
  const placeListCursor = () => {
    if (listCursor !== null) {
      return;
    }
    const first = listRows()[0];
    setListCursor(
      first === undefined ? null : threadKey(first.room, first.thread),
    );
  };

  const resetComposer = () => {
    intent = { kind: 'note' };
    composerError = null;
  };

  const endPreview = () => {
    if (preview === null) {
      return;
    }
    preview = null;
    resetComposer();
    listCursor = real === null ? null : threadKey(real.room, real.thread);
    drawAll();
    noteShownThread();
  };

  const openPreviewThread = (thread: string) => {
    preview = {
      room: PREVIEW_ROOM,
      thread,
      messages: [],
      cursorId: null,
      isRead: false,
    };
    resetComposer();
    listCursor = threadKey(PREVIEW_ROOM, thread);
    drawAll();
    noteShownThread();
    appendMessages(
      preview,
      PREVIEW_MESSAGES.filter((message) => message.thread === thread),
    );
  };

  const openReal = (room: string, thread: string) => {
    endPreview();
    pendingPlace = null;
    setListCursor(threadKey(room, thread));
    if (real?.room === room && real.thread === thread) {
      return;
    }
    real = { room, thread, messages: [], cursorId: null, isRead: false };
    lastMarked = 0;
    resetComposer();
    deps.placeChanged({ room, thread });
    drawAll();
    noteShownThread();
    readOpen();
  };

  // Opens `room`'s `thread` from the side bar: the preview's sample while it
  // shows, else the room's.
  const openFromList = (room: string, thread: string) => {
    if (preview !== null && room === PREVIEW_ROOM) {
      openPreviewThread(thread);
    } else {
      openReal(room, thread);
    }
    deps.picked();
  };

  // Opens the last page's thread once its room holds it.
  const restorePlace = () => {
    const place = pendingPlace;
    const isHeld =
      place !== null &&
      deps
        .rooms()
        .some(
          (view) =>
            view.room === place.room &&
            view.threads.some((held) => held.thread === place.thread),
        );
    if (isHeld && place !== null) {
      openReal(place.room, place.thread);
    }
  };

  // ── Commands ───────────────────────────────────────────────────────────
  const listRows = () =>
    threadList(shownRooms()).flatMap((group) => group.threads);

  const moveList = (move: CursorMove) => () => {
    const rows = listRows();
    if (rows.length === 0) {
      log('no threads');
      return;
    }
    const index = rows.findIndex(
      (row) => threadKey(row.room, row.thread) === listCursor,
    );
    const row = rows[movedIndex(index, rows.length, move)];
    setListCursor(threadKey(row.room, row.thread));
  };

  const moveLog = (move: CursorMove) => () => {
    const thread = pane();
    if (thread === null || thread.messages.length === 0) {
      log('no messages');
      return;
    }
    const index = thread.messages.findIndex(
      (message) => message.id === thread.cursorId,
    );
    const next = movedIndex(index, thread.messages.length, move);
    setLogCursor(thread, thread.messages[next].id);
  };

  const openComposer = (next: ComposerIntent, line: string) => {
    intent = next;
    composerError = null;
    drawComposer();
    setFocus('composer');
    log(line);
  };

  const send = () => {
    const thread = pane();
    const body = composerBox.value.trim();
    if (thread === null || body === '' || isSending) {
      return;
    }
    if (preview !== null) {
      log('preview: not posted');
      return;
    }
    const post = userPostFor(intent, thread.thread, boardOf(thread.room), body);
    if (post === null) {
      return;
    }
    const { room } = thread;
    isSending = true;
    channel
      .invoke('postAsUser', room, thread.thread, post)
      .then(
        (result) => {
          if (result.ok) {
            composerBox.value = '';
            resetComposer();
            log(`posted #${result.id} to ${room}/${thread.thread}`);
          } else {
            composerError = result.reason;
            log(`post refused: ${result.reason}`);
          }
        },
        (error: unknown) => {
          composerError = errorText(error);
          log(`post failed: ${composerError}`);
        },
      )
      .finally(() => {
        isSending = false;
        if (!isDisposed) {
          drawComposer();
        }
      });
  };

  const commands: Record<ChatroomViewCommand, () => void> = {
    listDown: moveList('down'),
    listUp: moveList('up'),
    listTop: moveList('top'),
    listBottom: moveList('bottom'),
    openThread() {
      const parsed = listCursor === null ? null : parseThreadKey(listCursor);
      if (parsed === null) {
        log('no thread under the cursor');
        return;
      }
      openFromList(parsed.room, parsed.thread);
    },
    logDown: moveLog('down'),
    logUp: moveLog('up'),
    logTop: moveLog('top'),
    logBottom: moveLog('bottom'),
    compose() {
      if (pane() === null) {
        log('no thread open');
        return;
      }
      openComposer({ kind: 'note' }, 'composer open: note');
    },
    reply() {
      const thread = pane();
      const message = thread?.messages.find(
        (held) => held.id === thread.cursorId,
      );
      if (message === undefined || !canReplyTo(message)) {
        log('nothing to reply to');
        return;
      }
      openComposer(
        { kind: 'reply', message },
        `composer open: answer to #${message.id}`,
      );
    },
    send,
    leaveComposer: () => setFocus('log'),
  };

  drawAll();

  return {
    restorePlace,
    sideBar: sidePane,
    sheet: contentSheet,
    shown() {
      placeListCursor();
      setFocus(focus);
      markRead();
      log('shown');
    },
    hidden() {
      endPreview();
    },
    sideBarHidden() {
      if (focus === 'threads') {
        setFocus('log');
      }
    },
    sideBarOpenedOver: () => setFocus('threads'),
    focusSideBar: () => setFocus('threads'),
    focusMain() {
      setFocus('log');
      deps.picked();
    },
    roomChanged(room) {
      const view = deps.rooms().find((held) => held.room === room);
      if (real !== null && real.room === room) {
        const thread = view?.threads.find(
          (held) => held.thread === real?.thread,
        );
        if (thread !== undefined && thread.lastId > lastHeld(real)) {
          readOpen();
        }
      }
      restorePlace();
      if (deps.isShown()) {
        placeListCursor();
      }
      if (preview === null) {
        drawSideBar();
        if (real?.room === room) {
          drawBoard();
        }
      }
    },
    redraw() {
      drawAll();
      if (focus === 'composer' && deps.isShown()) {
        composerBox.focus();
      }
    },
    commands,
    openThreadRow(key) {
      const parsed = parseThreadKey(key);
      if (parsed === null) {
        log(`no thread ${key}`);
        return;
      }
      openFromList(parsed.room, parsed.thread);
    },
    openRoomThread: (room, thread) => openReal(room, thread),
    showPreview() {
      if (!deps.isShown()) {
        deps.showMode();
      }
      openPreviewThread(PREVIEW_THREAD);
      log('preview shown');
    },
    dispose() {
      isDisposed = true;
      for (const slot of messageSlots.values()) {
        slot.drawn?.dispose();
      }
      messageSlots.clear();
      parts.dispose();
    },
  };
}

function boardLineOf(
  row: BoardRow,
  harnessLabel: (id: string) => string,
): BoardLineInput {
  return {
    name: row.name,
    harness: row.harness === null ? null : harnessLabel(row.harness),
    state: row.state,
    branch: row.branch,
    clone: row.clone === null ? null : `Unity ${row.clone.number}`,
    uncommitted: row.uncommitted.length + row.uncommittedMore,
    claims: row.claims.map((claim) => claimText(claim.target)),
  };
}

// The thread a saved place names, null when it names none.
function placeToOpen(
  place: ChatroomPlace | null,
): { room: string; thread: string } | null {
  if (place === null || place.room === null || place.thread === null) {
    return null;
  }
  return { room: place.room, thread: place.thread };
}

function claimText(target: ClaimTarget): string {
  if ('paths' in target) {
    return target.paths.join(', ');
  }
  return 'branch' in target ? `branch ${target.branch}` : target.resource;
}
