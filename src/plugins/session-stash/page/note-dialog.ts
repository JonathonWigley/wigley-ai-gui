import type { PushedScope } from '../../../contracts/plugin';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { textBoxInput } from '../../../shared/page/text-box';
import {
  createDialog,
  restoreFocusAfterDialog,
} from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { SessionStashPart } from '../layouts/layout';
import type { SessionStashParts } from './layout/session-stash-parts';

// `pushScope` pushes the `note` scope, whose Enter and Esc run `accept` and
// `cancel`; `stash` hands the session and its note on; `parts` draws the
// dialog's body through the session-stash layout.
export interface NoteDialogDeps {
  pushScope(): PushedScope;
  stash(sessionId: string, note: string | null): void;
  parts: Pick<SessionStashParts, 'noteDialog' | 'dialogFrame'>;
}

// The session `open` asks to stash: its id, and its name as the side-bar row
// shows it.
export interface StashTarget {
  sessionId: string;
  name: string;
}

// `open` shows the dialog for `target` with an empty note box; it does nothing
// while the dialog is open. `accept` closes the dialog, then hands `stash` the
// trimmed note, null for an empty one. `cancel` closes it and changes nothing,
// as the base scope changing under it does. Closing gives focus back to what
// held it as the dialog opened, unless focus moved elsewhere meanwhile.
// `redraw` draws the dialog's frame again, and the body while stashing, for
// changed layouts.
export interface NoteDialog {
  element: HTMLElement;
  open(target: StashTarget): void;
  isOpen(): boolean;
  accept(): void;
  cancel(): void;
  redraw(): void;
}

interface Stashing {
  target: StashTarget;
  scope: PushedScope;
  focusedBefore: Element | null;
}

const TITLE = 'Stash session';
const HINT =
  'The note shows beside the session under Stashed in the start prompt; empty stashes with none.';

export function createNoteDialog(deps: NoteDialogDeps): NoteDialog {
  const dialog = createDialog(TITLE, {
    hasActions: false,
    drawFrame: (parent, frameInput) =>
      deps.parts.dialogFrame(parent, frameInput).built,
  });
  const frame = inputFrame();
  const input = textBoxInput('session-stash-box');
  frame.append(input);

  let stashing: Stashing | null = null;
  let drawnBody: DrawnPart<SessionStashPart> | null = null;

  const disposeBody = () => {
    drawnBody?.dispose();
    drawnBody?.built.element.remove();
    drawnBody = null;
  };

  const drawBody = (target: StashTarget) => {
    keepingFocusAndScroll(dialog.body, [], () => {
      disposeBody();
      drawnBody = deps.parts.noteDialog(
        dialog.body,
        { session: target.name, hint: HINT },
        frame,
      );
    });
  };

  const hide = () => {
    const shown = stashing;
    dialog.hide();
    disposeBody();
    shown?.scope.dispose();
    stashing = null;
    restoreFocusAfterDialog(dialog, shown?.focusedBefore ?? null);
  };

  const noteDialog: NoteDialog = {
    element: dialog.element,
    open(target) {
      if (stashing !== null) {
        return;
      }
      const focusedBefore = document.activeElement;
      const scope = deps.pushScope();
      scope.onBaseChanged(() => {
        if (stashing?.scope === scope) {
          noteDialog.cancel();
        }
      });
      stashing = { target, scope, focusedBefore };
      input.value = '';
      drawBody(target);
      dialog.show();
      input.focus();
    },
    isOpen: () => stashing !== null,
    accept() {
      const shown = stashing;
      if (shown === null) {
        return;
      }
      const note = input.value.trim();
      hide();
      deps.stash(shown.target.sessionId, note === '' ? null : note);
    },
    cancel() {
      if (stashing !== null) {
        hide();
      }
    },
    redraw() {
      dialog.redrawFrame();
      if (stashing !== null) {
        drawBody(stashing.target);
      }
    },
  };
  return noteDialog;
}
