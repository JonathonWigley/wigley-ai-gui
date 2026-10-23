import type { ChatImage } from '../../../contracts/agent';
import { errorText } from '../../../shared/error-text';

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

// `refused` hears why a file was not attached; `failed` hears a read that
// failed, with the file's name.
export interface AttachReport {
  attached(image: ChatImage): void;
  refused(reason: string): void;
  failed(name: string, error: string): void;
}

// Reads each file as base64 and attaches it, or reports its refusal or read
// failure; each file is read on its own, so one failure leaves the rest.
export function attachFiles(
  files: readonly File[],
  attachments: Pick<Attachments, 'add'>,
  report: AttachReport,
) {
  for (const file of files) {
    void readBase64(file).then(
      (data) => {
        const refusal = refusalOf(file.type, data.length);
        if (refusal !== null) {
          report.refused(refusal);
          return;
        }
        const image: ChatImage = { mediaType: file.type, data };
        attachments.add(image);
        report.attached(image);
      },
      (error: unknown) => report.failed(file.name, errorText(error)),
    );
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
