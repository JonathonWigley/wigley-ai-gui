import type { CommandId } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { Platform } from '../../../contracts/platform';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { createDialog, type Dialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { KeysPageExports } from '../../keys/contract';
import { type ChatCommandName, type ChatScopeName, chatCommand } from '../ids';
import { keyHint } from './key-hint';

// Blurs whatever holds focus, a text box included, so page keys fire.
export function blurFocusedElement() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    focused.blur();
  }
}

// `keys` and `platform` print the action buttons' key hints, redrawn on each
// keymap change.
export interface DialogDeps {
  overlay: PluginAreas['overlay'];
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  platform: Platform;
  run(command: CommandId): void;
  // Pushes the dialog's own scope.
  pushScope(): PushedScope;
  log: Log;
}

// One action button of a dialog: its label, look, and the command it runs,
// whose keys in `scope` it shows.
export interface DialogAction {
  label: string;
  variant: ButtonVariant;
  command: ChatCommandName;
  scope: ChatScopeName;
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
  const dialog = createDialog('Deny');
  const box = inputFrame();
  box.classList.add('chat-reason-box');
  dialog.body.append(
    element(
      'p',
      'chat-dialog-text',
      'Optional: tell Claude why. It reads your reason.',
    ),
    box,
  );
  deps.overlay.contribute(dialog.element);
  followKeymap(dialog, REASON_ACTIONS, deps);
  const editor = deps.editor.create(box, '', {
    changed: () => undefined,
    focused: () => undefined,
    blurred: () => undefined,
    modeChanged: () => undefined,
  });

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
  const dialog = createDialog('End this session?');
  dialog.body.append(
    element(
      'p',
      'chat-dialog-text',
      'Claude is still working. Ending the session stops it.',
    ),
  );
  deps.overlay.contribute(dialog.element);
  followKeymap(dialog, CONFIRM_ACTIONS, deps);

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

// Draws the dialog's actions, and draws them again on each keymap change for
// as long as the page lives, so a rebind reaches a dialog open or shut.
export function followKeymap(
  dialog: Dialog,
  actions: readonly DialogAction[],
  deps: Pick<DialogDeps, 'keys' | 'platform' | 'run'>,
) {
  drawActions(dialog, actions, deps);
  deps.keys.onChanged(() => drawActions(dialog, actions, deps));
}

// Fills the dialog's actions with one button per action, each running its
// command and showing the keys bound to it now.
function drawActions(
  dialog: Dialog,
  actions: readonly DialogAction[],
  deps: Pick<DialogDeps, 'keys' | 'platform' | 'run'>,
) {
  dialog.actions.replaceChildren(
    ...actions.map((action) =>
      textButton(action.label, () => deps.run(chatCommand(action.command)), {
        variant: action.variant,
        hint: keyHint(deps.keys, deps.platform, action.command, action.scope),
      }),
    ),
  );
}
