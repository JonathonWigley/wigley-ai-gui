import type { ControlChoice, SessionControl } from '../../../contracts/agent';
import type { ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
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
} from '../contract';
import type { chatManifest } from '../manifest';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
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
import type { SignInDialog } from './sign-in-dialog';
import type { SlashCommands } from './slash-commands';

type ChatInvoke = Pick<PageChannel<ChatChannel>, 'invoke'>;

export interface PermissionActionDeps {
  channel: ChatInvoke;
  reasonBox: Pick<ReasonBox, 'open'>;
  log: Log;
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
        log('chat', `answerPermission failed: ${errorText(error)}`),
      );
  return {
    allow(session, entry) {
      answer(session, entry.id, true, null);
      log('chat', `allowed ${entry.toolName} in ${session.name}`);
    },
    deny(session, entry) {
      deps.reasonBox.open(entry.toolName, (reason) => {
        answer(session, entry.id, false, reason);
        log('chat', `denied ${entry.toolName} in ${session.name}`);
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
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

type Handler = (context: PageCommandContext) => void;

// Every chat command's handler but the start prompt's (`newSession`,
// `toggleArchive`, `showArchived`), by short id. A command acting on a
// session acts only on the session whose Chat tab is the visible tab, and
// does nothing while no Chat tab is visible.
export function chatCommandHandlers(
  deps: ChatCommandDeps,
): Omit<
  PageStart<typeof chatManifest>['commands'],
  'newSession' | 'toggleArchive' | 'showArchived'
> {
  const { tabs, channel, picker, log } = deps;
  const inSession =
    (
      act: (session: ChatSession, context: PageCommandContext) => void,
    ): Handler =>
    (context) => {
      const session = sessionFor(tabs, context);
      if (session === undefined) {
        log('chat', 'no Chat tab shown');
        return;
      }
      act(session, context);
    };
  // A resting session has no process to interrupt or change a control of.
  const inRunningSession = (act: (session: ChatSession) => void): Handler =>
    inSession((session) => {
      if (!session.running) {
        log('chat', `${session.name} has no running process`);
        return;
      }
      act(session);
    });
  const pickControlOf = (id: string) =>
    inRunningSession((session) => {
      const control = session.state.controls.find((held) => held.id === id);
      if (control === undefined) {
        log('chat', `${session.name} has no ${id} control`);
        return;
      }
      openChoices(deps, session, control);
    });

  return {
    focusBox: inSession((session) => {
      session.box.focus({ insert: true });
      log('chat', `focused the box in ${session.name}`);
    }),
    appendBox: inSession((session) => {
      session.box.focus({ insertAtEnd: true });
      log('chat', `focused the box in ${session.name}`);
    }),
    leaveBox: inSession((session, context) => {
      (context.editor ?? session.box).blur();
      log('chat', 'left the box');
    }),
    send: inSession((session) => send(deps, session)),
    interrupt: inRunningSession((session) => {
      if (session.state.activity === 'idle') {
        log('chat', `nothing to interrupt in ${session.name}`);
        return;
      }
      void channel
        .invoke('interrupt', session.sessionId)
        .catch((error: unknown) =>
          log('chat', `interrupt failed: ${errorText(error)}`),
        );
      log('chat', `interrupted ${session.name}`);
    }),
    nextEntry: inSession((session) => moveEntry(session, 1, log)),
    prevEntry: inSession((session) => moveEntry(session, -1, log)),
    latestEntry: inSession((session) => {
      session.entries.latest();
      log('chat', 'following the latest entry');
    }),
    firstEntry: inSession((session) => {
      const focused = session.entries.first();
      log(
        'chat',
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
    // A focused user entry with images opens the viewer on its first image and
    // toggles nothing; any other focused entry toggles its expanders.
    toggleEntry: inSession((session) => {
      const focused = session.entries.focused();
      if (focused?.kind === 'user' && focused.images.length > 0) {
        deps.viewer.open(focused.images, 0);
        return;
      }
      const toggled = session.entries.toggleFocused();
      if (toggled === null) {
        log('chat', `no entries in ${session.name}`);
        return;
      }
      const { kind } = toggled.entry;
      log(
        'chat',
        toggled.result === 'nothing'
          ? `${kind} entry has nothing to expand`
          : `${toggled.result} ${kind} entry`,
      );
    }),
    allowPermission: inSession((session) => {
      const pending = oldestPendingPermission(session.state.entries);
      if (pending === null) {
        log('chat', `no pending permission in ${session.name}`);
        return;
      }
      deps.permissions.allow(session, pending);
    }),
    denyPermission: inSession((session) => {
      const pending = oldestPendingPermission(session.state.entries);
      if (pending === null) {
        log('chat', `no pending permission in ${session.name}`);
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
        log('chat', `${session.name} has no controls`);
        return;
      }
      picker.open({
        title: 'Controls',
        items: controls,
        label: controlText,
        sessionBound: true,
        picked: (control) => openChoices(deps, session, control),
      });
    }),
    removeImage: inSession((session) => {
      if (session.attachments.removeLast()) {
        log('chat', `removed the last attached image in ${session.name}`);
      } else {
        log('chat', 'no attached image');
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
// its process in main. A registered app slash command runs in place of
// sending and clears the box, leaving the images attached.
function send(deps: ChatCommandDeps, session: ChatSession) {
  const { log } = deps;
  const text = session.box.text();
  const images = session.attachments.images();
  if (text.trim() === '' && images.length === 0) {
    log('chat', 'nothing to send');
    return;
  }
  const matched = deps.slashCommands.match(text);
  if (matched !== null) {
    runSlashCommand(deps, session, matched.command, matched.args);
    return;
  }
  void deps.channel
    .invoke('send', session.sessionId, { text, images })
    .catch((error: unknown) => {
      log('chat', `send failed: ${errorText(error)}`);
      deps.toast(`Message not sent: ${errorText(error)}`, 'error');
    });
  session.box.setText('');
  session.attachments.clear();
  const withImages =
    images.length === 0 ? '' : ` with ${images.length} image(s)`;
  log('chat', `sent a message${withImages} in ${session.name}`);
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
  log('chat', `ran /${command.name} in ${session.name}`);
  void (async () => command.run(context))().catch((error: unknown) => {
    log('chat', `/${command.name} failed: ${errorText(error)}`);
    deps.toast(`/${command.name} failed: ${errorText(error)}`, 'error');
  });
}

function moveEntry(session: ChatSession, step: 1 | -1, log: Log) {
  const focused = session.entries.move(step);
  log(
    'chat',
    focused === null
      ? `no entries in ${session.name}`
      : `focused ${focused.kind} entry`,
  );
}

// Logs e.g. `scrolled the transcript up a line; not following`.
function scrollTranscript(
  session: ChatSession,
  step: ScrollStep,
  direction: 1 | -1,
  log: Log,
) {
  const scroll = session.entries.scrollBy(step, direction);
  const following = scroll.following
    ? 'following the latest entry'
    : 'not following';
  log(
    'chat',
    `${scrollText('the transcript', step, direction, scroll)}; ${following}`,
  );
}

// The control's choices picker, the current value highlighted; a pick asks
// main to set it, and logs the change only once main has made it: main
// refuses a session it no longer holds, which logs and toasts the failure
// instead. The control's chip changes once main reports the new value.
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
    selected: Math.max(0, current),
    sessionBound: true,
    picked: (choice) => {
      void deps.channel
        .invoke('setControl', session.sessionId, control.id, choice.value)
        .then(
          () =>
            log(
              'chat',
              `set ${control.id} to ${choice.value} in ${session.name}`,
            ),
          (error: unknown) => {
            log('chat', `setControl failed: ${errorText(error)}`);
            deps.toast(errorText(error), 'error');
          },
        );
    },
  });
}
