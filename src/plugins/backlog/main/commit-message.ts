import type { FollowupItem } from '../../../shared/followups/followup-file';

const SUBJECT = 'Follow-ups edited in Backlog';

interface MessageParts {
  added: string[];
  edited: string[];
  removed: string[];
  tagged: string[];
}

function sameTags(a: FollowupItem, b: FollowupItem): boolean {
  return a.tags.join('\n') === b.tags.join('\n');
}

function sameText(a: FollowupItem, b: FollowupItem): boolean {
  return a.oneLine === b.oneLine && a.body === b.body && a.done === b.done;
}

function addFileChanges(
  parts: MessageParts,
  before: FollowupItem[],
  after: FollowupItem[],
): void {
  const beforeByTitle = new Map(before.map((item) => [item.title, item]));
  const afterTitles = new Set(after.map((item) => item.title));
  for (const item of after) {
    const old = beforeByTitle.get(item.title);
    if (old === undefined) {
      parts.added.push(item.title);
    } else if (!sameText(old, item)) {
      parts.edited.push(item.title);
    } else if (!sameTags(old, item)) {
      parts.tagged.push(item.title);
    }
  }
  for (const item of before) {
    if (!afterTitles.has(item.title)) {
      parts.removed.push(item.title);
    }
  }
}

// The commit message for each follow-up file's items at HEAD (`before`) and
// on disk (`after`), matched by title, and the changed image folders:
// `Follow-ups edited in Backlog: added …; edited …; removed …; tagged …;
// images …`, an empty part left out; the plain subject alone when no item
// and no image changed (a header edit, a reorder, line endings).
export function commitMessage(
  changes: { before: FollowupItem[]; after: FollowupItem[] }[],
  imageFolders: readonly string[],
): string {
  const parts: MessageParts = {
    added: [],
    edited: [],
    removed: [],
    tagged: [],
  };
  for (const { before, after } of changes) {
    addFileChanges(parts, before, after);
  }
  const written = Object.entries(parts)
    .filter(([, titles]) => titles.length > 0)
    .map(([verb, titles]) => `${verb} ${titles.join(', ')}`);
  if (imageFolders.length > 0) {
    written.push(`images ${imageFolders.join(', ')}`);
  }
  return written.length > 0 ? `${SUBJECT}: ${written.join('; ')}` : SUBJECT;
}
