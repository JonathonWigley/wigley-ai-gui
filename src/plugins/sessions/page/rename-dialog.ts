import type { Log } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { textBoxInput } from '../../../shared/page/text-box';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { SessionRow } from '../contract';
import type { SessionsPart } from '../layouts/layout';
import {
  editableTitle,
  normalizedTitle,
  titleLimit,
  titleProblem,
} from '../session-title';
import type { SessionsParts } from './layout/sessions-parts';

// `pushScope` pushes the `rename` scope, whose Enter and Esc run `accept` and
// `cancel`; `setUserTitle` asks main to set the user title, null clearing it;
// `titleMaxLength` reads the setting a typed title is checked against;
// `parts` draws the dialog's body through the sessions layout.
export interface RenameDialogDeps {
  pushScope(): PushedScope;
  setUserTitle(sessionId: string, title: string | null): Promise<void>;
  titleMaxLength(): number;
  parts: Pick<SessionsParts, 'renameDialog'>;
  log: Log;
}

// `open` shows the dialog for the row's session, the box holding the title
// the rename starts from, uncut; it does nothing while the dialog is open.
// `accept` sets the typed title, or clears the user title for a box that
// normalizes to empty, and closes once main has it; a title past the limit,
// or main refusing it, keeps the dialog open with the reason under the box,
// until the next edit. `cancel` closes it and changes nothing, as the base
// scope changing under it does; a cancel after `accept` does not undo the
// title main is already setting, and a refusal the closed dialog cannot show
// is logged. Closing gives focus back to what held it as the dialog opened,
// unless focus moved elsewhere meanwhile. `redraw` draws the open dialog's
// body again, for changed layouts.
export interface RenameDialog {
  element: HTMLElement;
  open(row: SessionRow): void;
  isOpen(): boolean;
  accept(): void;
  cancel(): void;
  redraw(): void;
}

interface Renaming {
  sessionId: string;
  label: string;
  scope: PushedScope;
  focusedBefore: Element | null;
}

const HINT = 'Empty hands naming back to the agent.';

export function createRenameDialog(deps: RenameDialogDeps): RenameDialog {
  const dialog = createDialog('Rename session', { hasActions: false });
  const frame = inputFrame();
  const input = textBoxInput('session-rename-box');
  frame.append(input);

  let renaming: Renaming | null = null;
  let isAccepting = false;
  let problem: string | null = null;
  let drawnBody: DrawnPart<SessionsPart> | null = null;

  const disposeBody = () => {
    drawnBody?.dispose();
    drawnBody?.built.element.remove();
    drawnBody = null;
  };

  const drawBody = () => {
    keepingFocusAndScroll(dialog.body, [], () => {
      disposeBody();
      drawnBody = deps.parts.renameDialog(
        dialog.body,
        { problem, hint: HINT },
        frame,
      );
    });
  };

  const showProblem = (text: string | null) => {
    if (text === problem) {
      return;
    }
    problem = text;
    drawBody();
  };

  input.addEventListener('input', () => showProblem(null));

  // Focus left on the closed dialog, or on nothing, goes back to what held it
  // as the dialog opened.
  const restoreFocus = (focusedBefore: Element | null) => {
    const active = document.activeElement;
    const isFocusLost =
      active === null ||
      active === document.body ||
      dialog.element.contains(active);
    if (
      isFocusLost &&
      focusedBefore instanceof HTMLElement &&
      focusedBefore.isConnected
    ) {
      focusedBefore.focus();
    }
  };

  const hide = () => {
    const shown = renaming;
    dialog.hide();
    disposeBody();
    shown?.scope.pop();
    renaming = null;
    isAccepting = false;
    restoreFocus(shown?.focusedBefore ?? null);
  };

  const renamedLine = (label: string, title: string | null) =>
    title === null
      ? `cleared the user title of ${label}`
      : `renamed ${label} to "${title}"`;

  const renameDialog: RenameDialog = {
    element: dialog.element,
    open(row) {
      if (renaming !== null) {
        return;
      }
      const focusedBefore = document.activeElement;
      const scope = deps.pushScope();
      scope.onBaseChanged(() => {
        if (renaming?.scope === scope) {
          renameDialog.cancel();
        }
      });
      renaming = {
        sessionId: row.sessionId,
        label: row.label,
        scope,
        focusedBefore,
      };
      input.value = editableTitle(row.titles);
      problem = null;
      drawBody();
      dialog.show();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    isOpen: () => renaming !== null,
    accept() {
      const shown = renaming;
      if (shown === null || isAccepting) {
        return;
      }
      const typed = normalizedTitle(input.value);
      const title = typed === '' ? null : typed;
      const tooLong =
        title === null
          ? null
          : titleProblem(title, titleLimit(deps.titleMaxLength()));
      if (tooLong !== null) {
        showProblem(tooLong);
        return;
      }
      isAccepting = true;
      deps
        .setUserTitle(shown.sessionId, title)
        .then(() => {
          if (renaming === shown) {
            hide();
          }
          deps.log('sessions', renamedLine(shown.label, title));
        })
        .catch((error: unknown) => {
          if (renaming !== shown) {
            deps.log('sessions', `rename failed: ${errorText(error)}`);
            return;
          }
          isAccepting = false;
          showProblem(errorText(error));
        });
    },
    cancel() {
      if (renaming !== null) {
        hide();
      }
    },
    redraw() {
      if (renaming !== null) {
        drawBody();
      }
    },
  };
  return renameDialog;
}
