import path from 'node:path';

// The name of the git worktree holding the file at `filePath`, by the two
// folders worktrees are made in: `.worktrees/<name>/` and Claude Code's own
// `.claude/worktrees/<name>/`, matched case-insensitively as Windows paths
// compare. Null for a file in neither.
export function worktreeNameOf(filePath: string): string | null {
  const segments = path.normalize(filePath).split(path.sep);
  const folder = (index: number) => segments[index]?.toLowerCase();
  // The last match wins, so a worktree nested in another names the inner one.
  for (let index = segments.length - 3; index >= 0; index -= 1) {
    const isWorktrees =
      folder(index) === '.worktrees' ||
      (folder(index) === 'worktrees' && folder(index - 1) === '.claude');
    if (isWorktrees) {
      return segments[index + 1];
    }
  }
  return null;
}

// The name (last segment) of each root whose full path `command` holds,
// matched case-insensitively as `worktreeNameOf` matches, in the order of
// `roots`, each once. A root counts where the text after it ends or goes on
// with a character no file name segment continues with.
export function worktreesInCommand(
  command: string,
  roots: readonly string[],
): string[] {
  const names: string[] = [];
  for (const root of roots) {
    const name = path.basename(root);
    if (holdsRoot(command, root) && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// Each of `roots`, then that root under `folder`'s own spelling when it
// differs: `realFolder` is `folder` with its symlinks resolved, and git lists
// roots resolved, so `/tmp/repo-wt` follows `/private/tmp/repo-wt` for a
// `folder` of `/tmp/repo`. A root outside the resolved part keeps one spelling.
export function rootSpellings(
  roots: readonly string[],
  folder: string,
  realFolder: string,
): string[] {
  let spelledTop = folder;
  let realTop = realFolder;
  // Strips the trailing segments both spellings share, leaving the folders the
  // symlink maps one onto the other.
  while (
    path.basename(spelledTop) !== '' &&
    path.basename(spelledTop).toLowerCase() ===
      path.basename(realTop).toLowerCase()
  ) {
    spelledTop = path.dirname(spelledTop);
    realTop = path.dirname(realTop);
  }
  const spellings: string[] = [];
  for (const root of roots) {
    spellings.push(root);
    const below = path.relative(realTop, root);
    const isUnderRealTop =
      below !== '..' &&
      !below.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(below);
    const spelled = path.join(spelledTop, below);
    if (isUnderRealTop && spelled !== root) {
      spellings.push(spelled);
    }
  }
  return spellings;
}

function holdsRoot(command: string, root: string): boolean {
  const text = command.toLowerCase();
  const sought = root.toLowerCase();
  for (
    let index = text.indexOf(sought);
    index !== -1;
    index = text.indexOf(sought, index + 1)
  ) {
    const next = text.charAt(index + sought.length);
    if (!/[A-Za-z0-9._-]/.test(next)) {
      return true;
    }
  }
  return false;
}
