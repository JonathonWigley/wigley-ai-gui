import type { Bridge } from '../contracts/bridge';
import {
  type DropTarget,
  type DroppedFile,
  NOTHING_TAKES_FILES,
  type PageDrops,
} from '../contracts/drops';
import type { ToastTone } from '../contracts/plugin';
import { holdsTextEntry } from '../shared/page/dom';
import { insertionText } from '../shared/page/file-drop/file-chips';
import { pathOf } from '../shared/page/file-drop/file-path';
import { filesOf, holdsPastedText } from '../shared/page/file-drop/pasted-text';

// `isShown` tells whether a target's element is on screen, for a paste that
// falls back to the target that last held focus.
export interface DropTargetsDeps {
  document: Document;
  bridge: Pick<Bridge, 'pathForFile' | 'savePasted'>;
  toast(text: string, tone: ToastTone): void;
  isShown(element: HTMLElement): boolean;
}

type OneLineInput = HTMLInputElement | HTMLTextAreaElement;

// One `addTarget` call, so a target registered twice is two registrations.
interface Registration {
  readonly target: DropTarget;
}

const WHITESPACE = /\s/;

const ONE_LINE_INPUT_TYPES = new Set(['text', 'search', 'url']);

// The toast for a file drag that holds no File, such as a folder the OS gives
// none for.
export const NO_FILES_CARRIED = 'This drag carried no files';

// The page core's drop registry. It listens on `deps.document` in the capture
// phase, ahead of the editor's own drop and paste handlers, and cancels every
// file `dragover` and `drop` so no drop navigates the window. A drop goes to a
// one-line input under the pointer, else the innermost target under it, else
// toasts `NOTHING_TAKES_FILES`; a file drag holding no File toasts
// `NO_FILES_CARRIED` wherever it lands. A paste of files whose text is no real
// text goes to a focused one-line input, else the innermost target holding
// focus, else, while no other editable field holds focus, the target that last
// held focus while it is shown; with none it stays a paste. A one-line input
// takes plain paths at its caret, spaced off the text on either side, saving
// each pathless file first, and hears one `input` event.
export function createDropTargets(deps: DropTargetsDeps): PageDrops {
  const registrations = new Set<Registration>();
  let lastFocused: Registration | null = null;

  const innermostHolding = (node: EventTarget | null): Registration | null => {
    let innermost: Registration | null = null;
    for (const registration of registrations) {
      const holds = registration.target.element.contains(node as Node | null);
      const liesInside =
        innermost === null ||
        innermost.target.element.contains(registration.target.element);
      if (holds && liesInside) {
        innermost = registration;
      }
    }
    return innermost;
  };

  const savePasted = async (file: DroppedFile): Promise<string> =>
    deps.bridge.savePasted(await file.bytes(), file.mediaType);

  const insertIntoInput = async (
    input: OneLineInput,
    files: readonly DroppedFile[],
  ): Promise<void> => {
    const paths: string[] = [];
    const saveFailed = (_file: DroppedFile, error: string) =>
      deps.toast(`Pasted file not saved: ${error}`, 'error');
    for (const file of files) {
      const path = await pathOf(file, savePasted, saveFailed);
      if (path === null) {
        return;
      }
      paths.push(path);
    }
    if (!input.isConnected) {
      return;
    }
    const { value } = input;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const next = value[end] ?? '';
    const needsSpaceAfter = next !== '' && !WHITESPACE.test(next);
    const text = insertionText(paths, value[start - 1] ?? '');
    input.setRangeText(needsSpaceAfter ? `${text} ` : text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const lastFocusedShown = (): Registration | null =>
    lastFocused !== null && deps.isShown(lastFocused.target.element)
      ? lastFocused
      : null;

  const droppedFiles = (files: File[]): DroppedFile[] =>
    files.map((file) => droppedFile(file, deps.bridge));

  deps.document.addEventListener(
    'dragover',
    (event) => {
      if (isFileDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    },
    { capture: true },
  );

  deps.document.addEventListener(
    'drop',
    (event) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const files = filesOf(event.dataTransfer);
      const input = asOneLineInput(event.target);
      const registration = innermostHolding(event.target);
      if (files.length === 0) {
        deps.toast(NO_FILES_CARRIED, 'info');
      } else if (input !== null) {
        void insertIntoInput(input, droppedFiles(files));
      } else if (registration !== null) {
        registration.target.take(droppedFiles(files));
      } else {
        deps.toast(NOTHING_TAKES_FILES, 'info');
      }
    },
    { capture: true },
  );

  deps.document.addEventListener(
    'paste',
    (event) => {
      const transfer = event.clipboardData;
      const files = filesOf(transfer);
      if (files.length === 0 || holdsPastedText(transfer, files)) {
        return;
      }
      const focused = deps.document.activeElement;
      const input = asOneLineInput(focused);
      const registration =
        innermostHolding(focused) ??
        (holdsTextEntry(focused) ? null : lastFocusedShown());
      if (input === null && registration === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (input !== null) {
        void insertIntoInput(input, droppedFiles(files));
      } else {
        registration?.target.take(droppedFiles(files));
      }
    },
    { capture: true },
  );

  deps.document.addEventListener(
    'focusin',
    (event) => {
      lastFocused = innermostHolding(event.target) ?? lastFocused;
    },
    { capture: true },
  );

  return {
    addTarget(target) {
      const registration: Registration = { target };
      registrations.add(registration);
      return {
        dispose() {
          registrations.delete(registration);
          if (lastFocused === registration) {
            lastFocused = null;
          }
        },
      };
    },
    savePasted,
  };
}

function isFileDrag(transfer: DataTransfer | null): transfer is DataTransfer {
  return transfer?.types.includes('Files') ?? false;
}

// Read by `tagName`, not `instanceof`, so a test in `node` can hand in a
// plain object.
function asOneLineInput(element: EventTarget | null): OneLineInput | null {
  const input = element as OneLineInput | null;
  const isTextArea = input?.tagName === 'TEXTAREA';
  const isTextInput =
    input?.tagName === 'INPUT' &&
    ONE_LINE_INPUT_TYPES.has((input as HTMLInputElement).type);
  const isEditable = !input?.readOnly && !input?.disabled;
  return (isTextArea || isTextInput) && isEditable ? input : null;
}

function droppedFile(
  file: File,
  bridge: Pick<Bridge, 'pathForFile'>,
): DroppedFile {
  return {
    name: file.name === '' ? 'pasted' : file.name,
    mediaType: file.type,
    path: bridge.pathForFile(file),
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  };
}
