import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type { PushedScope } from '../../contracts/plugin';
import { element } from './dom';
import { type ButtonVariant, textButton } from './ui/button';
import { createDialog } from './ui/dialog';

export interface ConfirmChoice {
  label: string;
  command: CommandId;
}

// Draws a button's hint as an anchor; the `keys` plugin's page exports fit.
export interface ConfirmKeys {
  anchor(
    element: HTMLElement,
    command: CommandId,
    options?: { scope?: ViewScope },
  ): Disposable;
}

export interface ConfirmPromptDeps {
  title: string;
  body: string;
  // The safe choice, drawn first as a secondary button.
  keep: ConfirmChoice;
  // Drawn second as a danger button.
  confirm: ConfirmChoice;
  // The pushed scope, qualified, each button's hint is anchored in.
  scope: ViewScope;
  keys: ConfirmKeys;
  run(command: CommandId): void;
  platform: Platform;
  // Lays the prompt's scope over the caller's base scope.
  pushScope(): PushedScope;
  // Whether the caller's state asks for the prompt now.
  isAsked(): boolean;
  // Whether the caller's form is sending; a dismiss the base scope owes waits until it is not.
  isSending(): boolean;
  // Asks the caller's state to drop the prompt.
  dismiss(): void;
  // Runs on each base scope change under the pushed scope, when given.
  onBaseChanged?(): void;
  log: Log;
  logSource: string;
}

export interface ConfirmPrompt {
  // The dialog's scrim, for the caller's overlay area.
  element: HTMLElement;
  // Call first on each render. Returns false when it dismissed a prompt whose dismiss waited on a send that has
  // ended; that dismiss renders again, so the caller stops its render.
  settleOwedDismiss(): boolean;
  // Call on each render to set the caller's base scope with `setBase`: the prompt hides and pops its scope first
  // once it is not asked, so the caller's own base change never reaches its listener, and shows and pushes its
  // scope after once it is asked, over the new base.
  setBaseScope(setBase: () => void): void;
}

const DISMISSED_LINE = 'cancel prompt dismissed: the view moved on';

// A confirm dialog, the safe choice first, that pushes its own scope over the
// caller's while asked and is dismissed when another view sets the base
// scope. While the caller's form sends, that dismiss waits: a failed send
// dismisses the prompt, and a sent form closes it with the form. Each
// button's hint is an anchor for its command in the prompt's pushed scope,
// for as long as the page lives, as the prompt does.
export function createConfirmPrompt(deps: ConfirmPromptDeps): ConfirmPrompt {
  const dialog = createDialog(deps.title);
  const choiceButton = (choice: ConfirmChoice, variant: ButtonVariant) => {
    const hint = element('span', 'ui-confirm-hint');
    const control = textButton(choice.label, () => deps.run(choice.command), {
      variant,
      hint,
    });
    deps.keys.anchor(hint, choice.command, { scope: deps.scope });
    return control;
  };
  dialog.body.append(element('p', '', deps.body));
  dialog.actions.append(
    choiceButton(deps.keep, 'secondary'),
    choiceButton(deps.confirm, 'danger'),
  );
  // The prompt's pushed scope while the prompt shows, else null.
  let pushedScope: PushedScope | null = null;
  // Whether the base scope changed while the caller's form was sending, so
  // the prompt is dismissed once the send fails.
  let isDismissOwed = false;
  const pushScope = () => {
    const pushed = deps.pushScope();
    pushed.onBaseChanged(() => {
      deps.onBaseChanged?.();
      if (pushedScope !== pushed) {
        return;
      }
      deps.dismiss();
      if (!deps.isAsked()) {
        deps.log(deps.logSource, DISMISSED_LINE);
      } else if (deps.isSending()) {
        isDismissOwed = true;
      }
    });
    pushedScope = pushed;
  };

  return {
    element: dialog.element,
    settleOwedDismiss() {
      if (!deps.isAsked()) {
        isDismissOwed = false;
      } else if (isDismissOwed && !deps.isSending()) {
        isDismissOwed = false;
        deps.dismiss();
        deps.log(deps.logSource, DISMISSED_LINE);
        return false;
      }
      return true;
    },
    setBaseScope(setBase) {
      if (!deps.isAsked() && pushedScope !== null) {
        dialog.hide();
        pushedScope.pop();
        pushedScope = null;
      }
      setBase();
      if (deps.isAsked() && pushedScope === null) {
        dialog.show();
        pushScope();
      }
    },
  };
}
