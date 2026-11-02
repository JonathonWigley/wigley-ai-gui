import type { ChatImage } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  filesOf,
  holdsPastedText,
} from '../../../shared/page/file-drop/pasted-text';
import { refusalOf } from '../image-rules';

// The images attached to one Chat tab's next message, in the order attached.
// Each change tells every `onChange` listener the images held after it.
// `removeLast` reports whether there was an image to remove.
export interface Attachments {
  images(): ChatImage[];
  add(image: ChatImage): void;
  removeAt(index: number): void;
  removeLast(): boolean;
  clear(): void;
  onChange(listener: (images: ChatImage[]) => void): void;
}

export function createAttachments(): Attachments {
  let held: ChatImage[] = [];
  const listeners: ((images: ChatImage[]) => void)[] = [];
  const set = (next: ChatImage[]) => {
    held = next;
    for (const listener of listeners) {
      listener([...held]);
    }
  };
  return {
    images: () => [...held],
    add: (image) => set([...held, image]),
    removeAt: (index) => set(held.filter((_, at) => at !== index)),
    removeLast() {
      if (held.length === 0) {
        return false;
      }
      set(held.slice(0, -1));
      return true;
    },
    clear: () => set([]),
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

// The length of the base64 text `byteCount` bytes encode to.
function base64LengthOf(byteCount: number): number {
  return 4 * Math.ceil(byteCount / 3);
}

// Why `file` cannot be attached, judged from its type and size before it is
// read; null when it can.
export function refusalOfFile(
  file: Pick<File, 'type' | 'size'>,
): string | null {
  return refusalOf(file.type, base64LengthOf(file.size));
}

// `refused` hears why a file was not attached; `failed` hears a read that
// failed, with the file's name.
export interface AttachReport {
  attached(image: ChatImage): void;
  refused(reason: string): void;
  failed(name: string, error: string): void;
}

// Attaches each file as base64 in the order given, or reports its refusal or
// read failure; a refused file is never read, and one failure leaves the rest.
export async function attachFiles(
  files: readonly File[],
  attachments: Pick<Attachments, 'add'>,
  report: AttachReport,
): Promise<void> {
  for (const file of files) {
    const refusal = refusalOfFile(file);
    if (refusal !== null) {
      report.refused(refusal);
      continue;
    }
    let data: string;
    try {
      data = await readBase64(file);
    } catch (error) {
      report.failed(file.name, errorText(error));
      continue;
    }
    const image: ChatImage = { mediaType: file.type, data };
    attachments.add(image);
    report.attached(image);
  }
}

// The file's contents as base64, without the `data:<type>;base64,` prefix
// `readAsDataURL` puts before it.
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('the file could not be read')),
    );
    reader.readAsDataURL(file);
  });
}

// The image as a `data:` URL an `<img>` shows.
export function imageUrl(image: ChatImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

// The Chat tab images attach to: its name for the log and its attachments.
export interface ImageTab {
  readonly name: string;
  readonly attachments: Attachments;
}

export interface ImageListenerDeps {
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// The Chat tab's elements that hear images: `root` the whole tab, `box` the
// message box frame.
export interface ImageTargets {
  root: HTMLElement;
  box: HTMLElement;
}

// Attaches the image files pasted into the message box or dropped on the tab.
// The box frame hears paste in the capture phase, ahead of its editor; a paste
// with no files, or one whose text is more than a file name or a link,
// reaches the editor untouched (Excel, Numbers, Word and Pages put a picture
// beside copied text; a Finder copy or Copy Image puts only a name or URL). The
// whole tab hears drop, so a file dropped just outside the composer attaches
// instead of the window navigating to it.
export function listenForImages(
  tab: ImageTab,
  targets: ImageTargets,
  deps: ImageListenerDeps,
): void {
  const { log } = deps;
  const take = (event: Event, files: File[]) => {
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void attachFiles(files, tab.attachments, {
      attached: (image) =>
        log('chat', `attached a ${image.mediaType} image in ${tab.name}`),
      refused: (reason) => {
        log('chat', `image refused: ${reason}`);
        deps.toast(reason, 'error');
      },
      failed: (name, error) => {
        log('chat', `${name} not read: ${error}`);
        deps.toast(`${name} not read: ${error}`, 'error');
      },
    });
  };
  const { root, box } = targets;
  root.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files') === true) {
      event.preventDefault();
    }
  });
  root.addEventListener('drop', (event) =>
    take(event, filesOf(event.dataTransfer)),
  );
  box.addEventListener(
    'paste',
    (event) => {
      const files = filesOf(event.clipboardData);
      if (!holdsPastedText(event.clipboardData, files)) {
        take(event, files);
      }
    },
    { capture: true },
  );
}
