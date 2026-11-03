import type { Log } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { textBoxInput } from '../../../shared/page/text-box';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { SessionRow } from '../contract';
import {
  editableTitle,
  normalizedTitle,
  titleLimit,
  titleProblem,
} from '../session-title';

// `pushScope` pushes the `rename` scope, whose Enter and Esc run `accept` and
// `cancel`; `setUserTitle` asks main to set the user title, null clearing it;
// `titleMaxLength` reads the setting a typed title is checked against.
export interface RenameDialogDeps {
  pushScope(): PushedScope;
  setUserTitle(sessionId: string, title: string | null): Promise<void>;
  titleMaxLength(): number;
  log: Log;
}

// `open` shows the dialog for the row's session, the box holding the title
// the rename starts from, uncut; it does nothing while the dialog is open.
// `accept` sets the typed title, or clears the user title for a box that
// normalizes to empty, and closes once main has it; a title past the limit,
// or main refusing it, keeps the dialog open with the reason under the box.
// `cancel` closes it and changes nothing, as the base scope changing under it
// does.
export interface RenameDialog {
  element: HTMLElement;
  open(row: SessionRow): void;
  isOpen(): boolean;
  accept(): void;
  cancel(): void;
}

interface Renaming {
  sessionId: string;
  label: string;
  scope: PushedScope;
}

export function createRenameDialog(deps: RenameDialogDeps): RenameDialog {
  const dialog = createDialog('Rename session', { hasActions: false });
  const frame = inputFrame();
  const input = textBoxInput('session-rename-box');
  frame.append(input);
  const problem = element('p', 'session-rename-problem');
  problem.hidden = true;
  const hint = element(
    'p',
    'session-rename-hint',
    'Empty hands naming back to the agent.',
  );
  dialog.body.append(frame, problem, hint);

  let renaming: Renaming | null = null;
  let isAccepting = false;

  const showProblem = (text: string | null) => {
    problem.textContent = text ?? '';
    problem.hidden = text === null;
  };

  const hide = () => {
    dialog.hide();
    renaming?.scope.pop();
    renaming = null;
    isAccepting = false;
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
      const scope = deps.pushScope();
      scope.onBaseChanged(() => {
        if (renaming?.scope === scope) {
          renameDialog.cancel();
        }
      });
      renaming = { sessionId: row.sessionId, label: row.label, scope };
      input.value = editableTitle(row.titles);
      showProblem(null);
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
          if (renaming === shown) {
            isAccepting = false;
            showProblem(errorText(error));
          }
        });
    },
    cancel() {
      if (renaming !== null) {
        hide();
      }
    },
  };
  return renameDialog;
}
