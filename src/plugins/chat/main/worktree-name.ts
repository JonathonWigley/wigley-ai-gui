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
