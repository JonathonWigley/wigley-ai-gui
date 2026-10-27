import { isMissingFile } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import {
  applyFollowupEdit,
  type FollowupDraft,
  type FollowupItem,
  newFollowupsFile,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import type { DocsMainExports } from '../../docs/contract';
import type { BacklogEdit, BacklogWriteResult } from '../contract';

export type FollowupWriteDeps = Pick<DocsMainExports, 'readDoc' | 'writeDoc'>;

// What one write attempt over a known disk text came to: a result to return,
// or the newer disk text the guarded write found.
type Attempt =
  | { type: 'done'; result: BacklogWriteResult }
  | { type: 'changedOnDisk'; diskText: string };

// The file's text; '' when it is missing.
export async function readFollowupText(
  deps: Pick<FollowupWriteDeps, 'readDoc'>,
  path: string,
): Promise<string> {
  try {
    return await deps.readDoc(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return '';
    }
    throw error;
  }
}

function matchesBaseline(item: FollowupItem, baseline: FollowupDraft): boolean {
  return (
    item.title === baseline.title &&
    item.oneLine === baseline.oneLine &&
    item.tags.join('\n') === baseline.tags.join('\n') &&
    item.body === baseline.body
  );
}

// The edited item as `diskText` holds it when it changed from the edit's
// baseline; null when it is unchanged or gone.
function changedOnDisk(
  edit: Extract<BacklogEdit, { type: 'edit' }>,
  diskText: string,
): FollowupDraft | null {
  const item = parseFollowups(diskText).items.find(
    (candidate) => candidate.title === edit.title,
  );
  if (item === undefined || matchesBaseline(item, edit.baseline)) {
    return null;
  }
  const { title, oneLine, tags, body } = item;
  return { title, oneLine, tags, body };
}

async function attempt(
  deps: FollowupWriteDeps,
  path: string,
  edit: BacklogEdit,
  newFileRepo: string | null,
  diskText: string,
): Promise<Attempt> {
  const isNewFile = diskText === '';
  if (isNewFile && newFileRepo === null && edit.type !== 'create') {
    return { type: 'done', result: { type: 'missing', title: edit.title } };
  }
  if (edit.type === 'edit') {
    const changed = changedOnDisk(edit, diskText);
    if (changed !== null) {
      return {
        type: 'done',
        result: { type: 'changed', title: edit.title, item: changed },
      };
    }
  }
  const base =
    isNewFile && newFileRepo !== null
      ? newFollowupsFile(newFileRepo)
      : diskText;
  const result = applyFollowupEdit(base, edit);
  if (result.type !== 'applied') {
    return { type: 'done', result };
  }
  try {
    const written = await deps.writeDoc(path, result.text, diskText);
    return written.type === 'written'
      ? { type: 'done', result }
      : { type: 'changedOnDisk', diskText: written.diskText };
  } catch (error) {
    return {
      type: 'done',
      result: { type: 'refused', reason: errorText(error) },
    };
  }
}

// Applies `edit` to the follow-up file at `path` through Docs' guarded write.
// A missing or empty file starts from `newFollowupsFile(newFileRepo)`; with
// `newFileRepo` null, an edit, setTags or delete there is `missing`. An edit
// whose item on disk differs from its `baseline` is `changed`, carrying the
// item as it reads on disk. When the disk
// changed since the read, the edit re-applies once to the new disk text; a
// second change, or a write the guard refuses, is `refused`.
export async function writeFollowupEdit(
  deps: FollowupWriteDeps,
  path: string,
  edit: BacklogEdit,
  newFileRepo: string | null,
): Promise<BacklogWriteResult> {
  const first = await attempt(
    deps,
    path,
    edit,
    newFileRepo,
    await readFollowupText(deps, path),
  );
  if (first.type === 'done') {
    return first.result;
  }
  const retry = await attempt(deps, path, edit, newFileRepo, first.diskText);
  if (retry.type === 'done') {
    return retry.result;
  }
  return {
    type: 'refused',
    reason: `${path} keeps changing on disk; try again`,
  };
}
