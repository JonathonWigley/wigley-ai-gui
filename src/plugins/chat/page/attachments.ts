import type { ChatImage } from '../../../contracts/agent';
import type { DroppedFile } from '../../../contracts/drops';
import type { TextEditor } from '../../../contracts/editor';
import { errorText } from '../../../shared/error-text';
import { IMAGE_TYPES, base64Of } from '../../../shared/image-types';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import { pathOf } from '../../../shared/page/file-drop/file-path';
import {
  type EncodableImage,
  type ImageEncoder,
  SHRINK_REFUSED,
  shrinkToFit,
} from '../../../shared/page/file-drop/shrink-image';

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

// What became of each file a Chat tab took: an image `attached` or `refused`,
// a file whose bytes were not `read` or that was not `saved`, and the paths
// `inserted` into the box.
export interface AttachReport {
  attached(image: ChatImage): void;
  refused(reason: string): void;
  failed(name: string, what: 'read' | 'saved', error: string): void;
  inserted(paths: readonly string[]): void;
}

export interface ChatDropDeps {
  attachments: Pick<Attachments, 'add'>;
  box: Pick<TextEditor, 'insert' | 'charBeforeCursor'>;
  savePasted(file: DroppedFile): Promise<string>;
  encoder: ImageEncoder;
  report: AttachReport;
}

// Takes the files dropped or pasted on a Chat tab in the order given: each
// image attaches, shrunk to fit the cap, and every other file's path (a
// pasted one's once saved) goes into the box in one insert after the walk.
// One file's failure leaves the rest.
export async function takeChatFiles(
  files: readonly DroppedFile[],
  deps: ChatDropDeps,
): Promise<void> {
  const paths: string[] = [];
  for (const file of files) {
    if (IMAGE_TYPES.includes(file.mediaType)) {
      await attachImage(file, deps);
      continue;
    }
    const path = await pathOf(file, deps.savePasted, (failed, error) =>
      deps.report.failed(failed.name, 'saved', error),
    );
    if (path !== null) {
      paths.push(path);
    }
  }
  if (paths.length > 0) {
    deps.box.insert(insertionText(paths, deps.box.charBeforeCursor()));
    deps.report.inserted(paths);
  }
}

async function attachImage(
  file: DroppedFile,
  deps: Pick<ChatDropDeps, 'attachments' | 'encoder' | 'report'>,
): Promise<void> {
  let shrunk: EncodableImage | null;
  try {
    const bytes = await file.bytes();
    shrunk = await shrinkToFit(
      { bytes, mediaType: file.mediaType },
      deps.encoder,
    );
  } catch (error) {
    deps.report.failed(file.name, 'read', errorText(error));
    return;
  }
  if (shrunk === null) {
    deps.report.refused(SHRINK_REFUSED);
    return;
  }
  const image: ChatImage = {
    mediaType: shrunk.mediaType,
    data: base64Of(shrunk.bytes),
  };
  deps.attachments.add(image);
  deps.report.attached(image);
}

// The image as a `data:` URL an `<img>` shows.
export function imageUrl(image: ChatImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}
