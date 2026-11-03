import type { Files } from '../../../contracts/files';
import type { DriveHost } from '../../../contracts/plugin';
import { argsObject } from '../../../shared/drive-args';
import type { DraftStore } from './draft-store';

export interface NotesDriveDeps {
  store: Pick<DraftStore, 'draft' | 'clear'>;
  // Notes' data folder.
  data: Pick<Files, 'list'>;
}

// `notes.draft` reads the kept draft and the data folder's files back;
// `notes.discard` clears the draft.
export function addDriveActions(drive: DriveHost, deps: NotesDriveDeps): void {
  const { store, data } = deps;
  drive.add('draft', {
    description:
      "Returns the kept note draft and every file in notes' data folder, for checking what the popup saved.",
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      const entries = await data.list('', { recursive: true });
      const files = entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path)
        .sort();
      return { draft: await store.draft(), files };
    },
  });
  drive.add('discard', {
    description:
      'Clears the kept note draft and removes its images, as a sent note does, so a drive check starts fresh.',
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      return { draft: await store.clear() };
    },
  });
}
