import type { ChatImage } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { iconButton } from '../../../shared/page/ui/icon-button';

// The image types a message can carry.
export const IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

// The API's per-image cap, measured on the base64 text it receives.
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

// Why an image of `type` whose base64 text is `base64Length` long cannot be
// attached; null when it can.
export function refusalOf(type: string, base64Length: number): string | null {
  if (!IMAGE_TYPES.includes(type)) {
    return 'Only PNG, JPEG, GIF and WebP images can be attached';
  }
  if (base64Length > MAX_IMAGE_BASE64) {
    return 'Images over 5 MB cannot be attached';
  }
  return null;
}

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

// A thumbnail per attached image, each with its remove button, redrawn on
// each change and hidden while nothing is attached.
export function buildAttachmentStrip(attachments: Attachments): HTMLElement {
  const strip = element('div', 'chat-attachments');
  strip.hidden = true;
  attachments.onChange((images) => {
    strip.hidden = images.length === 0;
    strip.replaceChildren(
      ...images.map((image, index) => {
        const held = element('div', 'chat-attachment');
        const thumbnail = element('img', 'chat-attachment-image');
        thumbnail.src = imageUrl(image);
        thumbnail.alt = `Attached image ${index + 1}`;
        const remove = iconButton(
          'close',
          'Remove the image',
          () => attachments.removeAt(index),
          'sm',
        );
        remove.classList.add('chat-attachment-remove');
        held.append(thumbnail, remove);
        return held;
      }),
    );
  });
  return strip;
}

// The Chat tab images attach to: its name for the log, whether its session
// ended, and its attachments.
export interface ImageTab {
  readonly name: string;
  readonly ended: boolean;
  readonly attachments: Attachments;
}

export interface ImageListenerDeps {
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// Attaches the image files pasted into the composer or dropped on the tab.
// The composer hears paste in the capture phase, ahead of the editor; a paste
// with no files, or one that also holds text, reaches the editor untouched
// (Excel, Numbers, Word and Pages put a picture beside copied text). The
// whole tab hears drop, so a file dropped just outside the composer attaches
// instead of the window navigating to it. An ended tab takes no files and logs
// it.
export function listenForImages(
  tab: ImageTab,
  composer: HTMLElement,
  root: HTMLElement,
  deps: ImageListenerDeps,
) {
  const { log } = deps;
  const take = (event: Event, files: File[], how: string) => {
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    if (tab.ended) {
      log('chat', `${how} files ignored: ${tab.name} has ended`);
      return;
    }
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
  composer.addEventListener(
    'paste',
    (event) => {
      if (!holdsText(event.clipboardData)) {
        take(event, filesOf(event.clipboardData), 'pasted');
      }
    },
    { capture: true },
  );
  root.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files') === true) {
      event.preventDefault();
    }
  });
  root.addEventListener('drop', (event) =>
    take(event, filesOf(event.dataTransfer), 'dropped'),
  );
}

function holdsText(transfer: DataTransfer | null): boolean {
  return transfer !== null && transfer.getData('text/plain') !== '';
}

function filesOf(transfer: DataTransfer | null): File[] {
  return transfer === null ? [] : [...transfer.files];
}
