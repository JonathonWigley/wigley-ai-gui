import type { CommandId } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import {
  appendKeys,
  button,
  element,
  showKeys,
} from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';

// Blurs whatever holds focus, a text box included, so page keys fire.
export function blurFocusedElement() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    focused.blur();
  }
}

export interface DialogDeps {
  overlay: PluginAreas['overlay'];
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  run(command: CommandId): void;
  // Pushes the dialog's own scope.
  pushScope(): PushedScope;
  log: Log;
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

export function createReasonBox(
  deps: DialogDeps & { editor: EditorHost },
): ReasonBox {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog chat-reason');
  const title = element('h2', 'dialog-title');
  const box = element('div', 'chat-reason-box');
  const actions = element('div', 'dialog-actions');
  actions.append(
    dialogButton(
      deps,
      'button button-danger',
      'Deny',
      'submitReason',
      'reason',
    ),
    dialogButton(deps, 'button', 'Back', 'cancelReason', 'reason'),
  );
  dialog.append(
    title,
    element(
      'p',
      'dialog-text',
      'Optional: tell Claude why. It reads your reason.',
    ),
    box,
    actions,
  );
  overlay.append(dialog);
  overlay.hidden = true;
  deps.overlay.contribute(overlay);
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
    overlay.hidden = true;
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
      title.textContent = `Deny ${toolName}?`;
      overlay.hidden = false;
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
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog dialog-confirm');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-label', 'End this session?');
  const actions = element('div', 'dialog-actions');
  actions.append(
    dialogButton(
      deps,
      'button button-danger',
      'End the session',
      'endSession',
      'confirm',
    ),
    dialogButton(deps, 'button', 'Keep it running', 'keepSession', 'confirm'),
  );
  dialog.append(
    element('h2', 'dialog-title', 'End this session?'),
    element(
      'p',
      'dialog-text',
      'Claude is still working. Ending the session stops it.',
    ),
    actions,
  );
  overlay.append(dialog);
  overlay.hidden = true;
  deps.overlay.contribute(overlay);

  let open: { name: string; end(): void; scope: PushedScope } | null = null;
  const hide = () => {
    const held = open;
    if (held === null) {
      return null;
    }
    open = null;
    overlay.hidden = true;
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
      overlay.hidden = false;
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

// A dialog button running `command`, showing the keys `scope` binds to it and
// showing them again after each keymap change, for as long as the page lives,
// as the dialog does.
function dialogButton(
  deps: Pick<DialogDeps, 'keys' | 'run'>,
  className: string,
  label: string,
  command: ChatCommandName,
  scope: ChatScopeName,
): HTMLButtonElement {
  const control = button(className, label, () =>
    deps.run(chatCommand(command)),
  );
  const readKeys = () =>
    deps.keys.keysFor(chatCommand(command), chatScope(scope));
  let hint = appendKeys(control, readKeys());
  deps.keys.onChanged(() => {
    hint = showKeys(control, hint, readKeys());
  });
  return control;
}
