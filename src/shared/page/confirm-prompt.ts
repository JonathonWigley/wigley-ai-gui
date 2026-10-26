import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';
import type { Log } from '../../contracts/log';
import type { Platform } from '../../contracts/platform';
import type { PushedScope } from '../../contracts/plugin';
import { element } from './dom';
import { appendKeyHint } from './key-hint';
import { type ButtonVariant, textButton } from './ui/button';
import { createDialog } from './ui/dialog';

export interface ConfirmChoice {
  label: string;
  command: CommandId;
}

// The keys a button's hint reads; the `keys` plugin's page exports fit.
export interface ConfirmKeys {
  keysFor(command: CommandId, scope?: ViewScope): string | null;
  onChanged(listener: () => void): Disposable;
}

export interface ConfirmPromptDeps {
  title: string;
  body: string;
  // The safe choice, drawn first as a secondary button.
  keep: ConfirmChoice;
  // Drawn second as a danger button.
  confirm: ConfirmChoice;
  // The pushed scope, qualified, whose keys each button's hint shows.
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
  // Runs on each base scope change under the pushed scope.
  onBaseChanged(): void;
  log: Log;
  logSource: string;
}

export interface ConfirmPrompt {
  // The dialog's scrim, for the caller's overlay area.
  element: HTMLElement;
  // Call first on each render. Returns false when it dismissed a prompt whose dismiss waited on a send that has
  // ended; that dismiss renders again, so the caller stops its render.
  settleOwedDismiss(): boolean;
  // Call before the caller sets its base scope: hides the prompt and pops its scope once it is not asked.
  hideIfDone(): void;
  // Call after the caller sets its base scope: shows the prompt and pushes its scope once it is asked.
  showIfAsked(): void;
}

const DISMISSED_LINE = 'cancel prompt dismissed: the view moved on';

// A confirm dialog, the safe choice first, that pushes its own scope over the
// caller's while asked and is dismissed when another view sets the base
// scope. While the caller's form sends, that dismiss waits: a failed send
// dismisses the prompt, and a sent form closes it with the form. Each button
// shows the pushed scope's keys for its command, and shows them again after
// each keymap change, for as long as the page lives, as the prompt does.
export function createConfirmPrompt(deps: ConfirmPromptDeps): ConfirmPrompt {
  const dialog = createDialog(deps.title);
  const choiceButton = (choice: ConfirmChoice, variant: ButtonVariant) => {
    const control = textButton(choice.label, () => deps.run(choice.command), {
      variant,
    });
    const redrawKeys = appendKeyHint(
      control,
      () => deps.keys.keysFor(choice.command, deps.scope),
      deps.platform,
    );
    deps.keys.onChanged(redrawKeys);
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
      deps.onBaseChanged();
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
    hideIfDone() {
      if (!deps.isAsked() && pushedScope !== null) {
        dialog.hide();
        pushedScope.pop();
        pushedScope = null;
      }
    },
    showIfAsked() {
      if (deps.isAsked() && pushedScope === null) {
        dialog.show();
        pushScope();
      }
    },
  };
}
