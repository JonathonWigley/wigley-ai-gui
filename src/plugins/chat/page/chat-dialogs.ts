import type { CommandId } from '../../../contracts/commands';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { createDialog, type Dialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import {
  createCloseConfirmPart,
  createReasonBoxPart,
  type DialogAction,
  dialogActions,
  type DialogPart,
  type DialogPartDeps,
} from './dialog-kits';

// Blurs whatever holds focus, a text box included, so page keys fire.
export function blurFocusedElement() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    focused.blur();
  }
}

// `keys` anchors the action buttons' key hints; the dialog's body draws
// through the chat layout, again on each layout change.
export interface DialogDeps extends DialogPartDeps {
  overlay: PluginAreas['overlay'];
  run(command: CommandId): void;
  // Pushes the dialog's own scope.
  pushScope(): PushedScope;
}

// The deny reason box: `open` shows it for one permission and focuses its
// editor in insert mode; `submit` closes it and hands `send` the trimmed
// reason, null when empty; `cancel`, and the pushed scope's base changing,
// close it sending nothing. Each does nothing while the box is closed.
export interface ReasonBox {
  open(toolName: string, send: (reason: string | null) => void): void;
  submit(): void;
  cancel(): void;
}

// The end-session confirmation: `open` shows it for one session; `end` hides
// it and runs that session's `end`; `keep`, and the pushed scope's base
// changing, hide it ending nothing. Each does nothing while it is hidden.
export interface CloseConfirm {
  open(name: string, end: () => void): void;
  end(): void;
  keep(): void;
}

const REASON_ACTIONS: readonly DialogAction[] = [
  {
    label: 'Back',
    variant: 'secondary',
    command: 'cancelReason',
    scope: 'reason',
  },
  {
    label: 'Deny',
    variant: 'danger',
    command: 'submitReason',
    scope: 'reason',
  },
];

const CONFIRM_ACTIONS: readonly DialogAction[] = [
  {
    label: 'Keep it running',
    variant: 'secondary',
    command: 'keepSession',
    scope: 'confirm',
  },
  {
    label: 'End the session',
    variant: 'danger',
    command: 'endSession',
    scope: 'confirm',
  },
];

export function createReasonBox(
  deps: DialogDeps & { editor: EditorHost },
): ReasonBox {
  const dialog = createChatDialog('Deny', deps);
  const box = inputFrame();
  box.classList.add('chat-reason-box');
  const part = createReasonBoxPart(deps, dialog.body, {
    reasonBox: box,
    actions: dialogActions(REASON_ACTIONS, deps),
  });
  part.draw({ toolName: '' });
  const editor = deps.editor.create(box, '', {
    changed: () => undefined,
    focused: () => undefined,
    blurred: () => undefined,
    modeChanged: () => undefined,
  });
  redrawOnLayoutChange(deps, part, box, editor);

  let open: { send(reason: string | null): void; scope: PushedScope } | null =
    null;
  const close = () => {
    const held = open;
    if (held === null) {
      return null;
    }
    open = null;
    editor.blur();
    held.scope.pop();
    editor.setText('');
    dialog.hide();
    return held;
  };
  const reasonBox: ReasonBox = {
    open(toolName, send) {
      close();
      const scope = deps.pushScope();
      const opened = { send, scope };
      scope.onBaseChanged(() => {
        if (open === opened) {
          reasonBox.cancel();
        }
      });
      open = opened;
      dialog.setTitle(`Deny ${toolName}?`);
      part.update({ toolName });
      dialog.show();
      editor.focus({ insert: true });
      deps.log('chat', `deny reason box shown for ${toolName}`);
    },
    submit() {
      const text = editor.text().trim();
      close()?.send(text === '' ? null : text);
    },
    cancel() {
      if (close() !== null) {
        deps.log('chat', 'deny reason box closed');
      }
    },
  };
  return reasonBox;
}

export function createCloseConfirm(deps: DialogDeps): CloseConfirm {
  const dialog = createChatDialog('End this session?', deps);
  const part = createCloseConfirmPart(deps, dialog.body, {
    actions: dialogActions(CONFIRM_ACTIONS, deps),
  });
  part.draw({ session: '' });
  deps.layouts.onChange(() => part.redraw());

  let open: { name: string; end(): void; scope: PushedScope } | null = null;
  const hide = () => {
    const held = open;
    if (held === null) {
      return null;
    }
    open = null;
    dialog.hide();
    held.scope.pop();
    return held;
  };
  const confirm: CloseConfirm = {
    open(name, end) {
      hide();
      const scope = deps.pushScope();
      const opened = { name, end, scope };
      scope.onBaseChanged(() => {
        if (open === opened) {
          confirm.keep();
        }
      });
      open = opened;
      part.update({ session: name });
      dialog.show();
    },
    end() {
      hide()?.end();
    },
    keep() {
      const kept = hide();
      if (kept !== null) {
        deps.log('chat', `kept ${kept.name}`);
      }
    },
  };
  return confirm;
}

// A dialog in the overlay whose part draws its actions inside its body, so
// the dialog's own actions row leaves the frame.
export function createChatDialog(
  title: string,
  deps: Pick<DialogDeps, 'overlay'>,
): Dialog {
  const dialog = createDialog(title, { hasActions: false });
  deps.overlay.contribute(dialog.element);
  return dialog;
}

// Draws the dialog's part again on each layout change; a box that held focus
// is focused again once it has moved into the new part.
export function redrawOnLayoutChange(
  deps: Pick<DialogDeps, 'layouts'>,
  part: Pick<DialogPart<unknown>, 'redraw'>,
  box: HTMLElement,
  editor: Pick<TextEditor, 'focus'>,
): void {
  deps.layouts.onChange(() => {
    const hadFocus = box.contains(document.activeElement);
    part.redraw();
    if (hadFocus) {
      editor.focus();
    }
  });
}
