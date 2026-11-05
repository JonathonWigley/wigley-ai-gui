import type { Paths } from '../../contracts/paths';
import { codeUnitOrder } from './code-unit-order';

// The most completions the path box shows.
export const COMPLETION_LIMIT = 12;

export interface CompletionQuery {
  folder: string;
  prefix: string;
}

export interface Completion {
  name: string;
  isFolder: boolean;
  // `name`, with a trailing separator for a folder.
  text: string;
}

// The folder to list for the typed text, and the name prefix to match in it.
// A relative folder part, or none, is taken from the home folder.
export function completionQuery(
  typed: string,
  homeDir: string,
  paths: Paths,
): CompletionQuery {
  const folderPart = typedFolderPart(typed, paths);
  const prefix = typed.slice(folderPart.length);
  const expanded = paths.expandTilde(folderPart, homeDir);
  const folder = paths.isAbsolute(expanded)
    ? paths.normalize(expanded)
    : paths.join(homeDir, expanded);
  return { folder, prefix };
}

// The folder's entries that start with `prefix` ignoring case, on every OS,
// dot names only for a dot prefix; folders first, each part by name ignoring
// case, names equal but for case in code-unit order.
export function completions(
  entries: readonly { name: string; isFolder: boolean }[],
  prefix: string,
  paths: Paths,
): Completion[] {
  const showsHidden = prefix.startsWith('.');
  const foldedPrefix = prefix.toLowerCase();
  return entries
    .filter(
      (entry) =>
        entry.name.toLowerCase().startsWith(foldedPrefix) &&
        (showsHidden || !entry.name.startsWith('.')),
    )
    .sort(
      (a, b) =>
        Number(b.isFolder) - Number(a.isFolder) ||
        codeUnitOrder(a.name.toLowerCase(), b.name.toLowerCase()) ||
        codeUnitOrder(a.name, b.name),
    )
    .map(({ name, isFolder }) => ({
      name,
      isFolder,
      text: isFolder ? `${name}${paths.separator}` : name,
    }));
}

// The typed text after Tab, the typed name replaced by the names' own case:
// one match completes whole, several extend to the longest prefix they share
// in exact case when it is longer than what was typed.
export function completeTyped(
  typed: string,
  matches: readonly Completion[],
  paths: Paths,
): string {
  const folderPart = typedFolderPart(typed, paths);
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

// The typed text up to and including its last '/' or OS separator; '' when it
// has neither.
function typedFolderPart(typed: string, paths: Paths): string {
  const lastSeparator = Math.max(
    typed.lastIndexOf('/'),
    typed.lastIndexOf(paths.separator),
  );
  return typed.slice(0, lastSeparator + 1);
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
