import type { PushedScope } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import type { DrawDialogFrame } from '../../../shared/page/ui/dialog';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { textBoxInput } from '../../../shared/page/text-box';
import {
  createDialog,
  restoreFocusAfterDialog,
} from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ImportBoxInput, PracticePane } from '../layouts/layout';
import type { PracticeViewDeps } from './practice-view';

const HINT =
  'Describe the problems to add, for example "add the Blind 75 graph problems". An agent session imports them.';

// `pushScope` pushes the `import` scope, whose Enter and Esc run `accept` and
// `cancel`; `drawBody` draws the `importBox` part into `parent`, `frame` its
// `textBox`; `drawFrame` draws the dialog's frame, the `dialogFrame` part.
export interface ImportBoxDeps extends Pick<
  PracticeViewDeps,
  'channel' | 'log' | 'toast'
> {
  pushScope(): PushedScope;
  drawFrame: DrawDialogFrame;
  drawBody(
    parent: HTMLElement,
    input: ImportBoxInput,
    frame: HTMLElement,
  ): DrawnPart<PracticePane>;
}

// The import dialog: one box where the user says what to import. `open`
// shows it empty; it does nothing while the dialog is open. `accept` starts
// the import session with the typed request and closes once main has started
// it; an empty request, or main refusing it, keeps the dialog open with the
// reason under the box, until the next edit. `cancel` closes it and starts
// nothing, as the base scope changing under it does. Closing gives focus back
// to what held it as the dialog opened, unless focus moved elsewhere
// meanwhile. `redraw` draws the dialog's frame again, and the open dialog's
// body, for changed layouts.
export interface ImportBox {
  element: HTMLElement;
  open(): void;
  isOpen(): boolean;
  accept(): void;
  cancel(): void;
  redraw(): void;
}

interface Importing {
  scope: PushedScope;
  focusedBefore: Element | null;
}

export function createImportBox(deps: ImportBoxDeps): ImportBox {
  const { log } = deps;
  const dialog = createDialog('Import problems', {
    hasActions: false,
    drawFrame: deps.drawFrame,
  });
  const frame = inputFrame();
  const input = textBoxInput('practice-import-input');
  frame.append(input);

  let importing: Importing | null = null;
  let isAccepting = false;
  let problem: string | null = null;
  let drawnBody: DrawnPart<PracticePane> | null = null;

  const disposeBody = () => {
    drawnBody?.dispose();
    drawnBody?.built.element.remove();
    drawnBody = null;
  };

  const drawBody = () => {
    keepingFocusAndScroll(dialog.body, [], () => {
      disposeBody();
      drawnBody = deps.drawBody(dialog.body, { problem, hint: HINT }, frame);
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

  const hide = () => {
    const shown = importing;
    dialog.hide();
    disposeBody();
    // An answer landing after the plugin stopped closes here too, so no `pop`.
    shown?.scope.dispose();
    importing = null;
    isAccepting = false;
    restoreFocusAfterDialog(dialog, shown?.focusedBefore ?? null);
    log('import box closed');
  };

  const importBox: ImportBox = {
    element: dialog.element,
    open() {
      if (importing !== null) {
        return;
      }
      const focusedBefore = document.activeElement;
      const scope = deps.pushScope();
      scope.onBaseChanged(() => {
        if (importing?.scope === scope) {
          importBox.cancel();
        }
      });
      importing = { scope, focusedBefore };
      input.value = '';
      problem = null;
      drawBody();
      dialog.show();
      input.focus();
      log('import box opened');
    },
    isOpen: () => importing !== null,
    accept() {
      const shown = importing;
      if (shown === null || isAccepting) {
        return;
      }
      const request = input.value.trim();
      if (request === '') {
        showProblem('Type what to import.');
        log('import refused: empty');
        return;
      }
      isAccepting = true;
      deps.channel.invoke('startImport', request).then(
        () => {
          if (importing === shown) {
            hide();
          }
          deps.toast(
            'Import session started: follow it in Sessions mode',
            'success',
          );
          log(`import started: ${request}`);
        },
        (error: unknown) => {
          log(`import failed: ${errorText(error)}`);
          if (importing !== shown) {
            return;
          }
          isAccepting = false;
          showProblem(errorText(error));
        },
      );
    },
    cancel() {
      if (importing !== null) {
        hide();
      }
    },
    redraw() {
      dialog.redrawFrame();
      if (importing !== null) {
        drawBody();
      }
    },
  };
  return importBox;
}
