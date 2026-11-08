import path from 'node:path';

// The name of the git worktree holding `filePath`, by the two folders worktrees
// are made in: a `.worktrees/<name>/` folder (the wigley repos' landing makes
// its worktrees beside the clones there) and Claude Code's own
// `.claude/worktrees/<name>/`. Null for a path in neither, and for the
// worktree folder itself.
export function worktreeNameOf(filePath: string): string | null {
  const segments = path.normalize(filePath).split(path.sep);
  // The last match wins, so a worktree nested in another names the inner one.
  for (let index = segments.length - 3; index >= 0; index -= 1) {
    const isWorktrees =
      segments[index] === '.worktrees' ||
      (segments[index] === 'worktrees' && segments[index - 1] === '.claude');
    if (isWorktrees && segments[index + 1] !== '') {
      return segments[index + 1];
    }
  }
  return null;
}
