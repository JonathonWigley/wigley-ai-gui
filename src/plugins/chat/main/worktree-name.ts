import path from 'node:path';
import type { Paths } from '../../../contracts/paths';

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
  const text = command.toLowerCase();
  const names: string[] = [];
  for (const root of roots) {
    const name = path.basename(root);
    if (!names.includes(name) && holdsRoot(text, root.toLowerCase())) {
      names.push(name);
    }
  }
  return names;
}

// True for a command that runs `git worktree`, git's own options allowed
// between the two words: a flag (`--no-pager`, `--git-dir=<path>`) or an
// option with its value as the next word (`-C <path>`, `-c <name>=<value>`,
// `--git-dir <path>`, `--work-tree <path>`, `--namespace <name>`,
// `--config-env <name>=<var>`).
export function runsGitWorktree(command: string): boolean {
  return GIT_WORKTREE.test(command);
}

const GIT_WORKTREE =
  /(?:^|[\s;&|(/`])git(?:\s+(?:-[Cc]|--(?:git-dir|work-tree|namespace|config-env))\s+(?:"[^"]*"|'[^']*'|\S+)|\s+-\S+)*\s+worktree(?=[\s;&|)`]|$)/;

// A folder and its path with every symlink resolved.
export interface ResolvedFolder {
  readonly folder: string;
  readonly realFolder: string;
}

// Each of `roots`, then that root under the row folder's own spelling when it
// differs. `folders` holds the row folder and each folder above it, deepest
// first, each with its resolved path; git lists roots resolved, so a root
// under a folder's resolved path is spelled through the deepest such folder:
// `/private/tmp/repo-wt` gains `/tmp/repo-wt` for a row folder `/tmp/repo`.
// A root no folder in `folders` resolves onto keeps one spelling.
export function rootSpellings(
  roots: readonly string[],
  folders: readonly ResolvedFolder[],
  paths: Pick<Paths, 'join' | 'segmentsBelow'>,
): string[] {
  const spellings: string[] = [];
  for (const root of roots) {
    spellings.push(root);
    const spelled = spellingThroughFolders(root, folders, paths);
    if (spelled !== null && spelled !== root) {
      spellings.push(spelled);
    }
  }
  return spellings;
}

function spellingThroughFolders(
  root: string,
  folders: readonly ResolvedFolder[],
  paths: Pick<Paths, 'join' | 'segmentsBelow'>,
): string | null {
  for (const { folder, realFolder } of folders) {
    const below = paths.segmentsBelow(root, realFolder);
    if (below !== null) {
      return paths.join(folder, ...below);
    }
  }
  return null;
}

// `text` and `sought` are both lowercased.
function holdsRoot(text: string, sought: string): boolean {
  for (
    let index = text.indexOf(sought);
    index !== -1;
    index = text.indexOf(sought, index + 1)
  ) {
    const next = text.charAt(index + sought.length);
    if (!/[a-z0-9._-]/.test(next)) {
      return true;
    }
  }
  return false;
}
