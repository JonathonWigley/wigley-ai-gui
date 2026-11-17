import type { CommandId } from '../../../contracts/commands';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import {
  type DrawnPart,
  requireDialogFrame,
} from '../../../shared/page/layout-host/draw-part';
import {
  createDialog,
  type Dialog,
  type DialogFramePart,
} from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ChatScopeName } from '../ids';
import { chatPartDraws, surfaceBaseKit } from './chat-layouts';
import {
  createCloseConfirmPart,
  createReasonBoxPart,
  type DialogAction,
  dialogActions,
  type DialogPart,
  type DialogPartDeps,
} from './dialog-kits';

// `keys` anchors the action buttons' key hints; the dialog's frame and body
// draw through the chat layout, again on each layout change.
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

// The end-session confirmation: `open` shows it for one session and resolves
// to the user's answer: true once `end` hides it, false once `keep`, the
// pushed scope's base changing or a later `open` hides it. `end` and `keep` do
// nothing while it is hidden.
export interface CloseConfirm {
  open(name: string): Promise<boolean>;
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
  const dialog = createChatDialog('Deny', 'reason', deps);
  const box = inputFrame();
  box.classList.add('chat-reason-box');
  const part = createReasonBoxPart(deps, () => dialog.body, {
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
  redrawOnLayoutChange(deps, dialog, part, box, editor);

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
      deps.log(`deny reason box shown for ${toolName}`);
    },
    submit() {
      const text = editor.text().trim();
      close()?.send(text === '' ? null : text);
    },
    cancel() {
      if (close() !== null) {
        deps.log('deny reason box closed');
      }
    },
  };
  return reasonBox;
}

export function createCloseConfirm(deps: DialogDeps): CloseConfirm {
  const dialog = createChatDialog('End this session?', 'confirm', deps);
  const part = createCloseConfirmPart(deps, () => dialog.body, {
    actions: dialogActions(CONFIRM_ACTIONS, deps),
  });
  part.draw({ session: '' });
  deps.layouts.onChange(() => {
    dialog.redrawFrame();
    part.redraw();
  });

  let open: {
    name: string;
    answer(ended: boolean): void;
    scope: PushedScope;
  } | null = null;
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
    open(name) {
      hide()?.answer(false);
      const scope = deps.pushScope();
      return new Promise<boolean>((answer) => {
        const opened = { name, answer, scope };
        scope.onBaseChanged(() => {
          if (open === opened) {
            confirm.keep();
          }
        });
        open = opened;
        part.update({ session: name });
        dialog.show();
      });
    },
    end() {
      hide()?.answer(true);
    },
    keep() {
      const kept = hide();
      if (kept !== null) {
        deps.log(`kept ${kept.name}`);
        kept.answer(false);
      }
    },
  };
  return confirm;
}

// A dialog in the overlay whose frame draws through the chat layout's
// `dialogFrame` in the kit of `scope`, and whose part draws its actions inside
// its body, so the frame has no actions row. Each draw of the frame disposes
// the one before it.
export function createChatDialog(
  title: string,
  scope: ChatScopeName,
  deps: DialogDeps,
): Dialog {
  const draws = chatPartDraws(deps.layouts, 'dialogFrame', deps.log);
  let lastDrawn: DrawnPart<DialogFramePart> | null = null;
  const dialog = createDialog(title, {
    hasActions: false,
    drawFrame(parent, input) {
      const drawn = draws.draw(parent, (builder, at, rollback) =>
        requireDialogFrame(
          builder(at, input, surfaceBaseKit(deps, scope, rollback)),
          input,
          'dialogFrame',
        ),
      );
      lastDrawn?.dispose();
      lastDrawn = drawn;
      return drawn.built;
    },
  });
  deps.overlay.contribute(dialog.element);
  return dialog;
}

// Draws the dialog's frame and part again on each layout change; a box that
// held focus is focused again once it has moved into the new part.
export function redrawOnLayoutChange(
  deps: Pick<DialogDeps, 'layouts'>,
  dialog: Pick<Dialog, 'redrawFrame'>,
  part: Pick<DialogPart<unknown>, 'redraw'>,
  box: HTMLElement,
  editor: Pick<TextEditor, 'focus'>,
): void {
  deps.layouts.onChange(() => {
    const hadFocus = box.contains(document.activeElement);
    dialog.redrawFrame();
    part.redraw();
    if (hadFocus) {
      editor.focus();
    }
  });
}
