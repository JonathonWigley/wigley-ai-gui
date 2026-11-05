import type {
  ControlChoice,
  SessionControl,
  UserMessage,
} from '../../../contracts/agent';
import type { ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type {
  PageChannel,
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { scrollText } from '../../../shared/content-scroll';
import type {
  AppSlashCommand,
  ChatChannel,
  SlashCommandContext,
  ReturnedMessage,
} from '../contract';
import type { chatManifest } from '../manifest';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
import type { WriteClipboard } from './clipboard';
import type { EntryListStop } from './entry-list';
import { controlText, oldestPendingPermission } from './chat-state';
import type {
  ChatSession,
  ChatTabs,
  PermissionActions,
  SessionRef,
} from './chat-view';
import { CONTROL_IDS } from './control-commands';
import type { ImageViewer } from './image-viewer';
import type { Picker } from './picker';
import { choiceRowInput, controlRowInput } from './picker-row';
import type { SignInDialog } from './sign-in-dialog';
import type { SlashCommands } from './slash-commands';

type ChatInvoke = Pick<PageChannel<ChatChannel>, 'invoke'>;

export interface PermissionActionDeps {
  channel: ChatInvoke;
  reasonBox: Pick<ReasonBox, 'open'>;
  log: PluginLog;
}

// Allow answers at once; deny opens the reason box and answers with what the
// user typed there. The page draws the answer only from chat main's replaced
// entry.
export function createPermissionActions(
  deps: PermissionActionDeps,
): PermissionActions {
  const { channel, log } = deps;
  const answer = (
    session: SessionRef,
    entryId: string,
    allowed: boolean,
    reason: string | null,
  ) =>
    void channel
      .invoke('answerPermission', session.sessionId, entryId, {
        allowed,
        reason,
      })
      .catch((error: unknown) =>
        log(`answerPermission failed: ${errorText(error)}`),
      );
  return {
    allow(session, entry) {
      answer(session, entry.id, true, null);
      log(`allowed ${entry.toolName} in ${session.name}`);
    },
    deny(session, entry) {
      deps.reasonBox.open(entry.toolName, (reason) => {
        answer(session, entry.id, false, reason);
        log(`denied ${entry.toolName} in ${session.name}`);
      });
    },
  };
}

export interface ChatCommandDeps {
  tabs: ChatTabs;
  channel: ChatInvoke;
  permissions: PermissionActions;
  reasonBox: ReasonBox;
  confirm: CloseConfirm;
  picker: Picker;
  signIn: SignInDialog;
  slashCommands: Pick<SlashCommands, 'match'>;
  viewer: ImageViewer;
  writeClipboard: WriteClipboard;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
}

type Handler = (context: PageCommandContext) => void;

// Every chat command's handler but the start prompt's (`newSession`,
// `toggleArchive`, `showArchived`) and the session hub's (`toggleSideParts`), by
// short id. A command acting on a
// session acts only on the session whose Chat tab is the visible tab, and
// does nothing while no Chat tab is visible.
export function chatCommandHandlers(
  deps: ChatCommandDeps,
): Omit<
  PageStart<typeof chatManifest>['commands'],
  'newSession' | 'toggleArchive' | 'showArchived' | 'toggleSideParts'
> {
  const { tabs, channel, picker, log } = deps;
  const inSession =
    (
      act: (session: ChatSession, context: PageCommandContext) => void,
    ): Handler =>
    (context) => {
      const session = sessionFor(tabs, context);
      if (session === undefined) {
        log('no Chat tab shown');
        return;
      }
      act(session, context);
    };
  // A resting session has no process to interrupt or change a control of.
  const inRunningSession = (act: (session: ChatSession) => void): Handler =>
    inSession((session) => {
      if (!session.running) {
        log(`${session.name} has no running process`);
        return;
      }
      act(session);
    });
  const pickControlOf = (id: string) =>
    inRunningSession((session) => {
      const control = session.state.controls.find((held) => held.id === id);
      if (control === undefined) {
        log(`${session.name} has no ${id} control`);
        return;
      }
      openChoices(deps, session, control);
    });

  return {
    focusBox: inSession((session) => {
      session.box.focus({ insert: true });
      log(`focused the box in ${session.name}`);
    }),
    appendBox: inSession((session) => {
      session.box.focus({ insertAtEnd: true });
      log(`focused the box in ${session.name}`);
    }),
    leaveBox: inSession((session, context) => {
      (context.editor ?? session.box).blur();
      log('left the box');
    }),
    send: inSession((session) => send(deps, session)),
    sendNow: inSession((session) => sendNow(deps, session)),
    interrupt: inRunningSession((session) => {
      const { activity, background, compaction, queued } = session.state;
      const isHoldUp = queued.some((row) => row.holdReason !== null);
      const isBackgroundRunning = background > 0;
      if (
        activity === 'idle' &&
        compaction === null &&
        !isHoldUp &&
        !isBackgroundRunning
      ) {
        log(`nothing to interrupt in ${session.name}`);
        return;
      }
      void channel
        .invoke('interrupt', session.sessionId)
        .catch((error: unknown) =>
          log(`interrupt failed: ${errorText(error)}`),
        );
      log(`interrupted ${session.name}`);
    }),
    // On the last stop, a composer part's stop may take the cursor; the
    // holder logs the part that took it.
    nextEntry: inSession((session) => {
      if (session.entries.isAtLastStop() && session.enterStop() !== null) {
        return;
      }
      moveEntry(session, 1, log);
    }),
    prevEntry: inSession((session) => moveEntry(session, -1, log)),
    nextMessage: inSession((session) => moveMessage(session, 1, log)),
    prevMessage: inSession((session) => moveMessage(session, -1, log)),
    toggleRange: inSession((session) => {
      log(
        session.entries.toggleRange()
          ? 'toggled the range'
          : `no entries in ${session.name}`,
      );
    }),
    cancelRange: inSession((session) => {
      log(
        session.entries.cancelRange()
          ? 'cancelled the range'
          : `no range to cancel in ${session.name}`,
      );
    }),
    latestEntry: inSession((session) => {
      session.entries.latest();
      log('following the latest entry');
    }),
    firstEntry: inSession((session) => {
      const focused = session.entries.first();
      log(
        focused === null
          ? `no entries in ${session.name}`
          : 'focused the first entry',
      );
    }),
    lineDown: inSession((session) => scrollTranscript(session, 'line', 1, log)),
    lineUp: inSession((session) => scrollTranscript(session, 'line', -1, log)),
    halfPageDown: inSession((session) =>
      scrollTranscript(session, 'halfPage', 1, log),
    ),
    halfPageUp: inSession((session) =>
      scrollTranscript(session, 'halfPage', -1, log),
    ),
    // A focused pending row is pulled back; a focused user entry with images
    // opens the viewer on its first image and toggles nothing; a focused
    // activity line opens or closes, and any other focused entry toggles its
    // expanders.
    toggleEntry: inSession((session) => {
      const focused = session.entries.focused();
      if (focused?.kind === 'queued') {
        pullBackQueued(deps, session, focused.message.id);
        return;
      }
      const entry = focused?.kind === 'entry' ? focused.entry : null;
      if (entry?.kind === 'user' && entry.images.length > 0) {
        deps.viewer.open(entry.images, 0);
        return;
      }
      const toggled = session.entries.toggleFocused();
      if (toggled === null) {
        log(`no entries in ${session.name}`);
        return;
      }
      const { stop, result } = toggled;
      if (stop.kind === 'activity') {
        log(`${result} activity line`);
        return;
      }
      const { kind } = stop.entry;
      log(
        result === 'nothing'
          ? `${kind} entry has nothing to expand`
          : `${result} ${kind} entry`,
      );
    }),
    // An open range is intent to copy, so a permission landing on it waits.
    allowOrCopy: inSession((session) => {
      const pending = oldestPendingPermission(session.state.entries);
      if (pending === null || session.entries.isRangeOpen()) {
        copySelection(deps, session);
        return;
      }
      deps.permissions.allow(session, pending);
    }),
    denyPermission: inSession((session) => {
      const pending = oldestPendingPermission(session.state.entries);
      if (pending === null) {
        log(`no pending permission in ${session.name}`);
        return;
      }
      deps.permissions.deny(session, pending);
    }),
    submitReason: () => deps.reasonBox.submit(),
    cancelReason: () => deps.reasonBox.cancel(),
    pickMode: pickControlOf(CONTROL_IDS.pickMode),
    pickEffort: pickControlOf(CONTROL_IDS.pickEffort),
    pickModel: pickControlOf(CONTROL_IDS.pickModel),
    pickControl: inRunningSession((session) => {
      const { controls } = session.state;
      if (controls.length === 0) {
        log(`${session.name} has no controls`);
        return;
      }
      picker.open({
        title: 'Controls',
        items: controls,
        label: controlText,
        rowInput: controlRowInput,
        sessionBound: true,
        picked: (control) => openChoices(deps, session, control),
      });
    }),
    pullBackQueued: inSession((session) => {
      const newest = session.state.queued.findLast(
        (queued) => queued.sentEntryId === null,
      );
      if (newest === undefined) {
        log(`no pending message in ${session.name}`);
        return;
      }
      pullBackQueued(deps, session, newest.id);
    }),
    removeImage: inSession((session) => {
      if (session.attachments.removeLast()) {
        log(`removed the last attached image in ${session.name}`);
      } else {
        log('no attached image');
      }
    }),
    nextImage: () => deps.viewer.next(),
    prevImage: () => deps.viewer.previous(),
    closeImage: () => deps.viewer.close(),
    submitCode: () => deps.signIn.submitCode(),
    cancelSignIn: () => deps.signIn.cancel(),
    copySignInLink: () => deps.signIn.copyLink(),
    endSession: () => deps.confirm.end(),
    keepSession: () => deps.confirm.keep(),
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerPick: () => picker.pick(),
    pickerClose: () => picker.close(),
    pickerFilter: () => picker.focusFilter(),
    pickerList: () => picker.leaveFilter(),
    stopAll: () => {
      log('stopping every session');
      void channel.invoke('stopAll').catch((error: unknown) => {
        log(`sessions not stopped: ${errorText(error)}`);
        deps.toast(`Sessions not stopped: ${errorText(error)}`, 'error');
      });
    },
    openPreview: () =>
      void channel.invoke('openPreview').catch((error: unknown) => {
        log(`chat preview not opened: ${errorText(error)}`);
        deps.toast(`Chat preview not opened: ${errorText(error)}`, 'error');
      }),
  };
}

// The visible Chat tab's session; undefined while no Chat tab is visible, or
// when the key fired in another session's box.
function sessionFor(
  tabs: ChatTabs,
  context: PageCommandContext,
): ChatSession | undefined {
  const visible = tabs.visibleSessionId();
  const session = visible === null ? undefined : tabs.session(visible);
  const firedInOtherBox =
    context.editor !== undefined &&
    context.editor !== session?.box &&
    tabs.sessionOfEditor(context.editor) !== undefined;
  return firedInOtherBox ? undefined : session;
}

// Sends the box's text as typed with the attached images, then clears the box
// and the attachments; images send with an empty box too. A box and
// attachments both empty send nothing. A message to a resting session starts
// its process in main, and the entries follow the latest one and scroll to
// the bottom. When main refuses the message, it goes back into the box (see
// `putBack`). Once main accepts the message, the done or error the session's
// row shows clears; a refused one leaves it. A registered app slash command
// runs in place of sending, clears the box, leaving the images attached, and
// clears the row's done or error at once.
function send(deps: ChatCommandDeps, session: ChatSession) {
  const { log } = deps;
  const message = boxMessage(session);
  if (message === null) {
    log('nothing to send');
    return;
  }
  if (ranSlashCommand(deps, session, message.text)) {
    return;
  }
  void deps.channel
    .invoke('send', session.sessionId, message)
    .then(() => {
      deps.tabs.markSent(session.sessionId);
    })
    .catch(refused(deps, session, 'send', message));
  clearBox(session);
  const withImages =
    message.images.length === 0
      ? ''
      : ` with ${message.images.length} image(s)`;
  log(`sent a message${withImages} in ${session.name}`);
}

// Cmd+Enter: with the box unfocused and a pending row focused, sends that row
// now (see `sendQueuedNow`), leaving the box alone. Otherwise asks main to
// send the box and every pending row now: into the running turn, or as `send`
// does when none runs; while a hold is up main queues the box instead and skips
// the compaction. The box is read, cleared and put back on a refusal as
// `send` does, and an app slash command runs as there. An empty box sends the
// unsent pending rows alone, leaving the box and entries as they are, and
// with no unsent row sends nothing.
function sendNow(deps: ChatCommandDeps, session: ChatSession) {
  const focused = session.entries.focused();
  if (!session.isBoxFocused() && focused?.kind === 'queued') {
    sendQueuedNow(deps, session, focused.message.id);
    return;
  }
  const message = boxMessage(session);
  const hasUnsent = session.state.queued.some(
    (queued) => queued.sentEntryId === null,
  );
  if (message === null && !hasUnsent) {
    deps.log('nothing to send');
    return;
  }
  if (message !== null && ranSlashCommand(deps, session, message.text)) {
    return;
  }
  void deps.channel
    .invoke('sendAllNow', session.sessionId, message)
    .then(() => {
      if (message !== null) {
        deps.tabs.markSent(session.sessionId);
      }
    })
    .catch(refused(deps, session, 'sendAllNow', message));
  if (message !== null) {
    clearBox(session);
  }
  deps.log(`sending now in ${session.name}`);
}

// The box's text as typed with the attached images; null when both are empty.
function boxMessage(session: ChatSession): UserMessage | null {
  const text = session.box.text();
  const images = session.attachments.images();
  return text.trim() === '' && images.length === 0 ? null : { text, images };
}

// Runs the registered app slash command `text` names, if any, and clears the
// row's done or error; whether one ran.
function ranSlashCommand(
  deps: ChatCommandDeps,
  session: ChatSession,
  text: string,
): boolean {
  const matched = deps.slashCommands.match(text);
  if (matched === null) {
    return false;
  }
  runSlashCommand(deps, session, matched.command, matched.args);
  deps.tabs.markSent(session.sessionId);
  return true;
}

// Empties the box and its attachments, and follows the latest entry.
function clearBox(session: ChatSession) {
  session.box.setText('');
  session.attachments.clear();
  session.entries.latest();
}

// The handler for main refusing `method`: logs and toasts the failure, and
// puts the message, when there was one, back into the box.
function refused(
  deps: ChatCommandDeps,
  session: ChatSession,
  method: 'send' | 'sendAllNow',
  message: UserMessage | null,
) {
  return (error: unknown) => {
    deps.log(`${method} failed: ${errorText(error)}`);
    deps.toast(`Message not sent: ${errorText(error)}`, 'error');
    if (message !== null && putBack(deps, session, [message])) {
      deps.log(`put the refused message back in ${session.name}`);
    }
  };
}

// Puts messages, oldest first, back into their session's box, ahead of
// anything typed or attached since: each text on its own line above the box's
// text, the oldest at the top, and their images in order before the attached
// ones. A session closed since takes nothing back; whether the box took them.
export function putBack(
  deps: Pick<ChatCommandDeps, 'tabs'>,
  session: ChatSession,
  messages: readonly UserMessage[],
): boolean {
  if (deps.tabs.session(session.sessionId) === undefined) {
    return false;
  }
  const texts = messages
    .map((message) => message.text)
    .filter((text) => text !== '');
  if (texts.length > 0) {
    const typed = session.box.text();
    session.box.setText(
      [...texts, ...(typed === '' ? [] : [typed])].join('\n'),
    );
  }
  const attached = session.attachments.images();
  session.attachments.clear();
  const returned = messages.flatMap((message) => message.images);
  for (const image of [...returned, ...attached]) {
    session.attachments.add(image);
  }
  return true;
}

// Puts messages main returned into their session's box and tells main they are
// placed. Main keeps any for a session with no tab, which its tab reads at mount.
export function placeReturned(
  deps: Pick<ChatCommandDeps, 'tabs' | 'channel' | 'log'>,
  sessionId: string,
  messages: readonly ReturnedMessage[],
) {
  if (messages.length === 0) {
    return;
  }
  const session = deps.tabs.session(sessionId);
  if (session === undefined) {
    deps.log(`returned for unknown session ${sessionId} ignored`);
    return;
  }
  if (!putBack(deps, session, messages)) {
    return;
  }
  deps.log(`pulled back ${messages.length} message(s) in ${session.name}`);
  void deps.channel
    .invoke(
      'returnedPlaced',
      sessionId,
      messages.map((message) => message.id),
    )
    .catch((error: unknown) =>
      deps.log(
        `returned messages in ${session.name} not reported placed: ${errorText(error)}`,
      ),
    );
}

// Replaces the session's draft with `text`, leaving its attached images, then
// shows its Chat tab with the box focused in insert mode at the end. An
// unknown session is logged and left alone.
export function fillComposer(
  deps: Pick<ChatCommandDeps, 'tabs' | 'log'>,
  sessionId: string,
  text: string,
): void {
  const session = deps.tabs.session(sessionId);
  if (session === undefined) {
    deps.log(`fillComposer for unknown session ${sessionId} ignored`);
    return;
  }
  session.box.setText(text);
  deps.tabs.reveal(sessionId);
}

// Asks main to take the queued message out of the session's queue; it
// arrives back as `returned`.
export function pullBackQueued(
  deps: { channel: ChatInvoke; log: PluginLog },
  session: SessionRef,
  queuedId: string,
) {
  void deps.channel
    .invoke('pullBack', session.sessionId, queuedId)
    .catch((error: unknown) =>
      deps.log(`pullBack failed: ${errorText(error)}`),
    );
  deps.log(`pulling back a pending message in ${session.name}`);
}

// Asks main to write the queued message into the running turn now; its row
// stays, drawn as sending, until the agent takes it in. Main refuses a row
// already sent, and on the held row skips the compaction instead.
export function sendQueuedNow(
  deps: { channel: ChatInvoke; log: PluginLog },
  session: SessionRef,
  queuedId: string,
) {
  void deps.channel
    .invoke('sendNow', session.sessionId, queuedId)
    .catch((error: unknown) => deps.log(`sendNow failed: ${errorText(error)}`));
  deps.log(`sending a pending message now in ${session.name}`);
}

// Runs the command for the session and clears the box; a run that throws or
// rejects logs and toasts the failure.
function runSlashCommand(
  deps: ChatCommandDeps,
  session: ChatSession,
  command: AppSlashCommand,
  args: string,
) {
  const { log } = deps;
  const context: SlashCommandContext = {
    sessionId: session.sessionId,
    profile: session.state.profile,
    args,
  };
  session.box.setText('');
  log(`ran /${command.name} in ${session.name}`);
  void (async () => command.run(context))().catch((error: unknown) => {
    log(`/${command.name} failed: ${errorText(error)}`);
    deps.toast(`/${command.name} failed: ${errorText(error)}`, 'error');
  });
}

function moveEntry(session: ChatSession, step: 1 | -1, log: PluginLog) {
  const focused = session.entries.move(step);
  log(focusedLine(focused, session.name));
}

function moveMessage(session: ChatSession, step: 1 | -1, log: PluginLog) {
  const focused = session.entries.moveToMessage(step);
  log(focusedLine(focused, session.name));
}

function focusedLine(stop: EntryListStop | null, sessionName: string): string {
  if (stop === null) {
    return `no entries in ${sessionName}`;
  }
  if (stop.kind === 'queued') {
    return 'focused pending message';
  }
  return stop.kind === 'activity'
    ? 'focused activity line'
    : `focused ${stop.entry.kind} entry`;
}

// Writes the range's source, else the cursor's, to the clipboard. A write that
// lands ends the range; one that fails leaves it. An open range with nothing to
// copy stays open and says so; a stop with nothing to copy only logs.
function copySelection(deps: ChatCommandDeps, session: ChatSession) {
  const { log } = deps;
  const selected = session.entries.selectedSource();
  if (selected === null) {
    log('nothing to copy');
    if (session.entries.isRangeOpen()) {
      deps.toast('Nothing to copy', 'info');
    }
    return;
  }
  const { text, blockCount } = selected;
  const blocks = blockCount === 1 ? '1 block' : `${blockCount} blocks`;
  void deps.writeClipboard(text).then(
    () => {
      session.entries.cancelRange();
      log(`copied ${blocks} in ${session.name}`);
      deps.toast(`Copied ${blocks}`, 'success');
    },
    (error: unknown) => {
      log(`copy failed: ${errorText(error)}`);
      deps.toast('Copy failed', 'error');
    },
  );
}

// Logs e.g. `scrolled the transcript up a line; not following`.
function scrollTranscript(
  session: ChatSession,
  step: ScrollStep,
  direction: 1 | -1,
  log: PluginLog,
) {
  const scroll = session.entries.scrollBy(step, direction);
  const following = scroll.following
    ? 'following the latest entry'
    : 'not following';
  log(`${scrollText('the transcript', step, direction, scroll)}; ${following}`);
}

// The control's choices picker, the current value highlighted; a pick asks
// main to set it, and logs the change only once main has made it: main
// refuses a session it no longer holds or that has no running process, which
// logs and toasts the failure instead. The control's chip changes once main reports the new value.
function openChoices(
  deps: ChatCommandDeps,
  session: ChatSession,
  control: SessionControl,
) {
  const { log } = deps;
  const current = control.choices.findIndex(
    (choice) => choice.value === control.value,
  );
  deps.picker.open<ControlChoice>({
    title: control.label,
    items: control.choices,
    label: (choice) => choice.label,
    rowInput: (choice) => choiceRowInput(choice, control),
    selected: Math.max(0, current),
    sessionBound: true,
    picked: (choice) => {
      void deps.channel
        .invoke('setControl', session.sessionId, control.id, choice.value)
        .then(
          () => log(`set ${control.id} to ${choice.value} in ${session.name}`),
          (error: unknown) => {
            log(`setControl failed: ${errorText(error)}`);
            deps.toast(errorText(error), 'error');
          },
        );
    },
  });
}
