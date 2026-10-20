import { expandTilde, joinPath, normalizePath } from './doc-paths';

// The most completions the path box shows.
export const COMPLETION_LIMIT = 12;

export interface CompletionQuery {
  folder: string;
  prefix: string;
}

export interface Completion {
  name: string;
  isFolder: boolean;
  // `name`, with a trailing '/' for a folder.
  text: string;
}

// The folder to list for the typed text, and the name prefix to match in it.
// A relative folder part, or none, is taken from the home folder.
export function completionQuery(
  typed: string,
  homeDir: string,
): CompletionQuery {
  const folderPart = typedFolderPart(typed);
  const prefix = typed.slice(folderPart.length);
  const expanded = expandTilde(folderPart, homeDir);
  const folder = expanded.startsWith('/')
    ? normalizePath(expanded)
    : joinPath(homeDir, expanded);
  return { folder, prefix };
}

// The folder's entries that start with `prefix` (case-sensitive), dot names
// only for a dot prefix; folders first, each part by name in code-unit order.
export function completions(
  entries: readonly { name: string; isFolder: boolean }[],
  prefix: string,
): Completion[] {
  const showsHidden = prefix.startsWith('.');
  return entries
    .filter(
      (entry) =>
        entry.name.startsWith(prefix) &&
        (showsHidden || !entry.name.startsWith('.')),
    )
    .sort(
      (a, b) =>
        Number(b.isFolder) - Number(a.isFolder) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .map(({ name, isFolder }) => ({
      name,
      isFolder,
      text: isFolder ? `${name}/` : name,
    }));
}

// The typed text after Tab: one match completes whole, several extend to
// their longest common prefix when it is longer than what was typed.
export function completeTyped(
  typed: string,
  matches: readonly Completion[],
): string {
  const folderPart = typedFolderPart(typed);
  if (matches.length === 0) {
    return typed;
  }
  if (matches.length === 1) {
    return folderPart + matches[0].text;
  }
  const common = commonPrefix(matches.map((match) => match.name));
  const prefix = typed.slice(folderPart.length);
  return common.length > prefix.length ? folderPart + common : typed;
}

// The typed text up to and including its last '/'; '' when it has none.
function typedFolderPart(typed: string): string {
  return typed.slice(0, typed.lastIndexOf('/') + 1);
}

function commonPrefix(names: readonly string[]): string {
  let common = names[0];
  for (const name of names.slice(1)) {
    let shared = 0;
    while (shared < common.length && common[shared] === name[shared]) {
      shared++;
    }
    common = common.slice(0, shared);
  }
  return common;
}
