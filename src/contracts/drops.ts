import type { Disposable } from './disposable';

// One file dropped or pasted on the page.
export interface DroppedFile {
  // The file's name, or a made-up one for a pasted file ("image.png").
  readonly name: string;
  // `File.type`; '' when the OS gave none (a folder).
  readonly mediaType: string;
  // The full path on disk; '' for a pasted file.
  readonly path: string;
  bytes(): Promise<Uint8Array>;
}

// An element a plugin registers with the core, and what it does with the
// files dropped or pasted on it.
export interface DropTarget {
  readonly element: HTMLElement;
  take(files: readonly DroppedFile[]): void;
}

export interface PageDrops {
  addTarget(target: DropTarget): Disposable;
  // Saves a file with no path under the app's pasted/ folder and returns its
  // full path.
  savePasted(file: DroppedFile): Promise<string>;
}

// The toast for a drop no box takes.
export const NOTHING_TAKES_FILES = 'Nothing here takes files';
