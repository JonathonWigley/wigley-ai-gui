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

// The name (last segment) of each root whose full path `command` holds, in the
// order of `roots`, each once. A root counts where the text after it ends or
// goes on with a character no file name segment continues with.
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

function holdsRoot(command: string, root: string): boolean {
  for (
    let index = command.indexOf(root);
    index !== -1;
    index = command.indexOf(root, index + 1)
  ) {
    const next = command.charAt(index + root.length);
    if (!/[A-Za-z0-9._-]/.test(next)) {
      return true;
    }
  }
  return false;
}
