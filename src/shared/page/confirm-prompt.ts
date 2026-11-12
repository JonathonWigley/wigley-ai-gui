import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';
import type { PluginLog } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import { appended, element } from './dom';
import { type ButtonVariant, textButton } from './ui/button';
import { createDialog } from './ui/dialog';

export interface ConfirmChoice {
  label: string;
  command: CommandId;
}

// Draws a button's hint as an anchor; `api.keys`, the page's `KeyHints`, fits.
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
  log: PluginLog;
  // Draws the body into `parent` (the dialog's body), placing the buttons
  // through `parts`; the prompt draws its own body when left out.
  drawBody?(parent: HTMLElement, parts: ConfirmBodyParts): void;
}

// What a `drawBody` draws with: the body text and the prompt's two buttons.
export interface ConfirmBodyParts {
  body: string;
  // Each appends the prompt's own button (label, variant, key anchor in the
  // prompt's scope) to `parent`.
  keepButton(parent: HTMLElement): HTMLButtonElement;
  confirmButton(parent: HTMLElement): HTMLButtonElement;
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
  // Empties the body and actions and draws them again, as after a new layout.
  redraw(): void;
}

const DISMISSED_LINE = 'cancel prompt dismissed: the view moved on';

// A confirm dialog, the safe choice first, that pushes its own scope over the
// caller's while asked and is dismissed when another view sets the base
// scope. While the caller's form sends, that dismiss waits: a failed send
// dismisses the prompt, and a sent form closes it with the form. Each
// button's hint is an anchor for its command in the prompt's pushed scope,
// held until the next draw; the page keeps the last draw's for as long as it
// lives, as the prompt does. A `drawBody` places the body and buttons; a
// button not in the dialog once it returns (left out, or placed by a layout
// attempt that rolled back) is appended to the actions, so both commands
// always hold an anchor.
export function createConfirmPrompt(deps: ConfirmPromptDeps): ConfirmPrompt {
  const dialog = createDialog(deps.title);
  // The anchors of the buttons the last draw made.
  let anchors: Disposable[] = [];
  const choiceButton = (choice: ConfirmChoice, variant: ButtonVariant) => {
    const hint = element('span', 'ui-confirm-hint');
    const control = textButton(choice.label, () => deps.run(choice.command), {
      variant,
      hint,
    });
    anchors.push(deps.keys.anchor(hint, choice.command, { scope: deps.scope }));
    return control;
  };
  const keepButton = () => choiceButton(deps.keep, 'secondary');
  const confirmButton = () => choiceButton(deps.confirm, 'danger');
  const draw = () => {
    const drawn = anchors;
    anchors = [];
    for (const anchor of drawn) {
      anchor.dispose();
    }
    dialog.body.replaceChildren();
    dialog.actions.replaceChildren();
    if (deps.drawBody === undefined) {
      dialog.body.append(element('p', '', deps.body));
      dialog.actions.append(keepButton(), confirmButton());
      return;
    }
    let keep: HTMLButtonElement | null = null;
    let confirm: HTMLButtonElement | null = null;
    deps.drawBody(dialog.body, {
      body: deps.body,
      keepButton: (parent) => appended(parent, (keep ??= keepButton())),
      confirmButton: (parent) =>
        appended(parent, (confirm ??= confirmButton())),
    });
    if (keep === null || !dialog.element.contains(keep)) {
      dialog.actions.append(keep ?? keepButton());
    }
    if (confirm === null || !dialog.element.contains(confirm)) {
      dialog.actions.append(confirm ?? confirmButton());
    }
  };
  draw();
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
      // The prompt's own choice already closed it, and its scope is popped on the next render.
      if (!deps.isAsked()) {
        return;
      }
      deps.dismiss();
      if (!deps.isAsked()) {
        deps.log(DISMISSED_LINE);
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
        deps.log(DISMISSED_LINE);
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
    redraw: draw,
  };
}
