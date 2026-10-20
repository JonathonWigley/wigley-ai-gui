import type { ControlChoice, SessionControl } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type {
  PageChannel,
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { ChatChannel } from '../contract';
import type { chatManifest } from '../manifest';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
import { controlText, oldestPendingPermission } from './chat-state';
import type {
  ChatSession,
  ChatTabs,
  PermissionActions,
  SessionRef,
} from './chat-view';
import type { Picker } from './picker';

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
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

type Handler = (context: PageCommandContext) => void;

// The control ids the pick keys reach, by command.
const CONTROL_IDS = {
  pickMode: 'mode',
  pickEffort: 'effort',
  pickModel: 'model',
} as const;

// Every chat command's handler but `newSession`'s (the start prompt's), by
// short id. A command acting on a session acts only on the session whose Chat
// tab is the visible tab, and does nothing while no Chat tab is visible.
export function chatCommandHandlers(
  deps: ChatCommandDeps,
): Omit<PageStart<typeof chatManifest>['commands'], 'newSession'> {
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
  // An ended session takes no interrupt and no control change.
  const inLiveSession = (act: (session: ChatSession) => void): Handler =>
    inSession((session) => {
      if (session.ended) {
        log('chat', `${session.name} has ended`);
        return;
      }
      act(session);
    });
  const pickControlOf = (id: string) =>
    inLiveSession((session) => {
      const control = session.state.controls.find((held) => held.id === id);
      if (control === undefined) {
        log('chat', `${session.name} has no ${id} control`);
        return;
      }
      openChoices(deps, session, control);
    });
  const layoutCommand =
    (invoke: () => Promise<unknown>): Handler =>
    () =>
      void invoke().catch((error: unknown) => {
        log('chat', `layout command failed: ${errorText(error)}`);
        deps.toast(`Layout command failed: ${errorText(error)}`, 'error');
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
    interrupt: inLiveSession((session) => {
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
    toggleEntry: inSession((session) => {
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
    pickControl: inLiveSession((session) => {
      const { controls } = session.state;
      if (controls.length === 0) {
        log('chat', `${session.name} has no controls`);
        return;
      }
      picker.open({
        title: 'Controls',
        items: controls,
        label: controlText,
        picked: (control) => openChoices(deps, session, control),
      });
    }),
    endSession: () => deps.confirm.end(),
    keepSession: () => deps.confirm.keep(),
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerPick: () => picker.pick(),
    pickerClose: () => picker.close(),
    pickerFilter: () => picker.focusFilter(),
    pickerList: () => picker.leaveFilter(),
    nextLayout: layoutCommand(() => channel.invoke('cycleLayout', 1)),
    prevLayout: layoutCommand(() => channel.invoke('cycleLayout', -1)),
    copyLayout: layoutCommand(() => channel.invoke('copyLayout')),
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

// Sends the box's text as typed and clears the box; an empty box or an ended
// session sends nothing and keeps the text.
function send(deps: ChatCommandDeps, session: ChatSession) {
  const { log } = deps;
  const text = session.box.text();
  if (text.trim() === '') {
    log('chat', 'nothing to send');
    return;
  }
  if (session.ended) {
    log('chat', `${session.name} has ended`);
    return;
  }
  void deps.channel
    .invoke('send', session.sessionId, text)
    .catch((error: unknown) => {
      log('chat', `send failed: ${errorText(error)}`);
      deps.toast(`Message not sent: ${errorText(error)}`, 'error');
    });
  session.box.setText('');
  log('chat', `sent a message in ${session.name}`);
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

// The control's choices picker, the current value highlighted; a pick asks
// main to set it, and the status line changes once main reports it.
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
    picked: (choice) => {
      void deps.channel
        .invoke('setControl', session.sessionId, control.id, choice.value)
        .catch((error: unknown) => {
          log('chat', `setControl failed: ${errorText(error)}`);
          deps.toast(errorText(error), 'error');
        });
      log('chat', `set ${control.id} to ${choice.value} in ${session.name}`);
    },
  });
}
