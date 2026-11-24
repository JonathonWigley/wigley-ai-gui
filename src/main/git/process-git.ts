import type { Files } from '../../contracts/files';
import type {
  Git,
  GitBranch,
  GitCommit,
  GitRemoteHead,
  GitWorktree,
} from '../../contracts/git';
import type { Paths } from '../../contracts/paths';
import type { ProcessRunner } from '../../contracts/processes';

// How long `remoteHeads` waits on origin before it gives up.
const REMOTE_HEADS_TIMEOUT_MS = 15000;

// A sha `commitSubject` runs git for: hex only, so it never reads as an option
// or a ref name.
const SHA = /^[0-9a-f]{4,40}$/i;

interface ProcessGitDeps {
  processes: ProcessRunner;
  files: Files;
  paths: Paths;
}

// `Git` over the `git` on the PATH, one run per call (two for `fileAtHead`, up
// to two for `currentBranch`), each as `git -C <root> …`.
export function createProcessGit(deps: ProcessGitDeps): Git {
  const { processes } = deps;
  return {
    topLevel: async (folder) => {
      const result = await processes.run('git', [
        '-C',
        folder,
        'rev-parse',
        '--show-toplevel',
      ]);
      return result.code === 0
        ? deps.paths.normalize(result.stdout.trim())
        : null;
    },
    originRepoName: async (folder) => {
      const result = await processes.run('git', [
        '-C',
        folder,
        'remote',
        'get-url',
        'origin',
      ]);
      return result.code === 0 ? repoNameOfUrl(result.stdout) : null;
    },
    currentBranch: async (folder) => {
      // An unborn branch's name prints here too; a detached HEAD exits 1.
      const branch = await processes.run('git', [
        '-C',
        folder,
        'symbolic-ref',
        '--short',
        '-q',
        'HEAD',
      ]);
      if (branch.code === 0) {
        return branch.stdout.trim();
      }
      const commit = await processes.run('git', [
        '-C',
        folder,
        'rev-parse',
        '--short',
        'HEAD',
      ]);
      return commit.code === 0 ? commit.stdout.trim() : null;
    },
    isLinkedWorktree: async (root) => {
      const output = await gitOutput(processes, 'rev-parse', [
        '-C',
        root,
        'rev-parse',
        '--git-dir',
        '--git-common-dir',
      ]);
      const [gitDir, commonDir] = output
        .trim()
        .split('\n')
        .map((gitPath) => fullGitPath(root, gitPath, deps.paths));
      return !deps.paths.samePath(gitDir, commonDir);
    },
    worktrees: async (root) =>
      worktreeRecords(
        await gitOutput(processes, 'worktree', [
          '-C',
          root,
          'worktree',
          'list',
          '--porcelain',
        ]),
        deps.paths,
      ),
    commonDir: async (root) => {
      const output = await gitOutput(processes, 'rev-parse', [
        '-C',
        root,
        'rev-parse',
        '--git-common-dir',
      ]);
      return fullGitPath(root, output.trim(), deps.paths);
    },
    hasUpstream: async (root) => {
      const result = await processes.run('git', [
        '-C',
        root,
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{u}',
      ]);
      return result.code === 0;
    },
    changedPaths: async (root, pathspec) =>
      porcelainPaths(
        await gitOutput(processes, 'status', [
          '-C',
          root,
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          pathspec,
        ]),
      ),
    unpushedPaths: async (root, pathspec) =>
      nulFields(
        await gitOutput(processes, 'diff', [
          '-C',
          root,
          'diff',
          '--name-only',
          '-z',
          '@{u}...HEAD',
          '--',
          pathspec,
        ]),
      ),
    upstreamBlobs: async (root, pathspec) =>
      treeBlobs(
        await gitOutput(processes, 'ls-tree', [
          '-C',
          root,
          'ls-tree',
          '-r',
          '-z',
          '@{u}',
          '--',
          pathspec,
        ]),
      ),
    fetch: async (root, timeoutMs) => {
      try {
        const result = await processes.run(
          'git',
          ['-C', root, 'fetch', '--quiet'],
          { timeoutMs },
        );
        return result.code !== 0 || result.timedOut;
      } catch {
        return true;
      }
    },
    resolveCommit: async (root, ref) => {
      const result = await processes.run('git', [
        '-C',
        root,
        'rev-parse',
        '--verify',
        '--quiet',
        `${ref}^{commit}`,
      ]);
      // With `--quiet`, a ref that names no commit exits 1; above 1 is a
      // broken or missing clone, which must not read as "no such ref".
      if (result.code === 0) {
        return result.stdout.trim();
      }
      if (result.code === 1) {
        return null;
      }
      throw new Error(
        `git rev-parse exited ${String(result.code)}: ${result.stderr.trim()}`,
      );
    },
    isAncestor: async (root, ancestor, descendant) => {
      // Exits 0 for an ancestor, 1 for none, and above 1 on an error.
      const result = await processes.run('git', [
        '-C',
        root,
        'merge-base',
        '--is-ancestor',
        ancestor,
        descendant,
      ]);
      if (result.code === 0 || result.code === 1) {
        return result.code === 0;
      }
      throw new Error(
        `git merge-base exited ${String(result.code)}: ${result.stderr.trim()}`,
      );
    },
    lastFetch: (root) => lastFetch(root, deps),
    fileAtHead: async (root, path) => {
      // `--literal-pathspecs` keeps a `*`, `?`, `[` or leading `:` in `path`
      // from matching other files.
      const tree = await gitOutput(processes, 'ls-tree', [
        '-C',
        root,
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        'HEAD',
        '--',
        path,
      ]);
      const sha = treeBlobs(tree).get(path);
      if (sha === undefined) {
        return null;
      }
      return gitOutput(processes, 'cat-file', [
        '-C',
        root,
        'cat-file',
        'blob',
        sha,
      ]);
    },
    log: async (root, paths, limit) => {
      if (paths.length === 0) {
        return [];
      }
      // `--literal-pathspecs` keeps a `*`, `?`, `[` or leading `:` in a path
      // from matching other files. `-z` turns off path quoting.
      return logCommits(
        await gitOutput(processes, 'log', [
          '-C',
          root,
          '--literal-pathspecs',
          'log',
          '--no-show-signature',
          '--no-merges',
          `--max-count=${String(limit)}`,
          '--format=%x00%H%x00%cI%x00%s',
          '-z',
          '--name-only',
          '--',
          ...paths,
        ]),
      );
    },
    firstAdded: async (root, path, text) => {
      if (text === '') {
        return null;
      }
      // `--reverse` lists the oldest first; `--max-count` would apply before
      // it and keep the newest. `-S` is attached so a text starting with `-`
      // is not read as an option.
      const commits = logCommits(
        await gitOutput(processes, 'log', [
          '-C',
          root,
          '--literal-pathspecs',
          'log',
          '--no-show-signature',
          '--no-merges',
          '--reverse',
          `-S${text}`,
          '--format=%x00%H%x00%cI%x00%s',
          '-z',
          '--name-only',
          '--',
          path,
        ]),
      );
      return commits[0] ?? null;
    },
    remoteHeads: async (root, pattern) => {
      try {
        // `refs/heads/` anchors the pattern at the start of the name: git
        // matches a bare pattern against a ref's tail from any `/`.
        const result = await processes.run(
          'git',
          [
            '-C',
            root,
            'ls-remote',
            '--heads',
            'origin',
            `refs/heads/${pattern}`,
          ],
          { timeoutMs: REMOTE_HEADS_TIMEOUT_MS },
        );
        return result.code === 0 && !result.timedOut
          ? remoteHeadRecords(result.stdout)
          : null;
      } catch {
        return null;
      }
    },
    commitSubject: async (root, sha) => {
      if (!SHA.test(sha)) {
        return null;
      }
      const result = await processes.run('git', [
        '-C',
        root,
        'show',
        '-s',
        '--no-show-signature',
        '--format=%s',
        `${sha}^{commit}`,
        '--',
      ]);
      return result.code === 0 ? result.stdout.replace(/\n$/, '') : null;
    },
    branches: async (root) =>
      branchRecords(
        await gitOutput(processes, 'for-each-ref', [
          '-C',
          root,
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname)%00%(symref)%00%(committerdate:iso-strict)',
          'refs/heads',
          'refs/remotes',
        ]),
      ),
    commitsMatching: async (root, pattern, since) => {
      if (pattern === '') {
        return [];
      }
      // `--exclude` applies to the `--all` after it, keeping the stash's
      // `WIP on <branch>` commits out. `--grep` is attached so a pattern
      // starting with `-` is not read as an option.
      const sinceArgs = since === null ? [] : [`--since=${since}`];
      return logCommits(
        await gitOutput(processes, 'log', [
          '-C',
          root,
          'log',
          '--exclude=refs/stash',
          '--all',
          '--no-show-signature',
          '--regexp-ignore-case',
          '--extended-regexp',
          `--grep=${pattern}`,
          ...sinceArgs,
          '--format=%x00%H%x00%cI%x00%s',
          '-z',
        ]),
      );
    },
  };
}

// The heads of an `ls-remote --heads` run, one `<sha>\t<ref>` line each, in
// git's order.
function remoteHeadRecords(output: string): GitRemoteHead[] {
  const heads: GitRemoteHead[] = [];
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    heads.push({
      name: line.slice(tab + 1).replace(/^refs\/heads\//, ''),
      sha: line.slice(0, tab),
    });
  }
  return heads;
}

// The stdout of a git run; throws when it cannot start or exits non-zero.
async function gitOutput(
  processes: ProcessRunner,
  name: string,
  args: string[],
): Promise<string> {
  const result = await processes.run('git', args);
  if (result.code !== 0) {
    throw new Error(
      `git ${name} exited ${String(result.code)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

// The text after a URL's or path's last `/`, `\` or `:`, past any trailing
// separators, without one `.git`; null when nothing is left.
function repoNameOfUrl(url: string): string | null {
  const name = url
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/^.*[/\\:]/, '')
    .replace(/\.git$/, '');
  return name === '' ? null : name;
}

function nulFields(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

// Every path a `status --porcelain=v1 -z` output names: each record is
// `XY <path>`, and a rename or copy (`R` or `C` in either column) is followed
// by the original path, which is named too.
function porcelainPaths(output: string): string[] {
  const fields = nulFields(output);
  const named: string[] = [];
  let index = 0;
  while (index < fields.length) {
    const record = fields[index];
    named.push(record.slice(3));
    const isRenameOrCopy = /[RC]/.test(record.slice(0, 2));
    if (isRenameOrCopy && index + 1 < fields.length) {
      named.push(fields[index + 1]);
      index += 1;
    }
    index += 1;
  }
  return named;
}

// Path → blob sha, from `ls-tree -z` records `<mode> <type> <sha>\t<path>`;
// only blobs count.
function treeBlobs(output: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const record of nulFields(output)) {
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const [, type, sha] = record.slice(0, tab).split(' ');
    if (type === 'blob') {
      blobs.set(record.slice(tab + 1), sha);
    }
  }
  return blobs;
}

// The commits of a `log` run, whose NUL-split fields are an empty field, then
// sha, date and subject by position, then paths up to the next empty field;
// git prints one `\n` before each commit's first path.
function logCommits(output: string): GitCommit[] {
  const fields = output.split('\0');
  const commits: GitCommit[] = [];
  let index = 0;
  while (index + 3 < fields.length) {
    const [sha, at, subject] = fields.slice(index + 1, index + 4);
    const paths: string[] = [];
    index += 4;
    while (index < fields.length && fields[index] !== '') {
      const isFirstPath = paths.length === 0;
      paths.push(
        isFirstPath ? fields[index].replace(/^\n/, '') : fields[index],
      );
      index += 1;
    }
    commits.push({ sha, subject, at, paths });
  }
  return commits;
}

// The branches of a `for-each-ref` run, one `<refname>\0<symref>\0<date>`
// line per ref; a symbolic ref (a remote's `HEAD`) is skipped.
function branchRecords(output: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of output.split('\n')) {
    if (line === '') {
      continue;
    }
    const [refName, symref, at] = line.split('\0');
    if (symref !== '') {
      continue;
    }
    const isRemote = refName.startsWith('refs/remotes/');
    const name = refName.replace(/^refs\/(heads|remotes)\//, '');
    branches.push({ name, at, isRemote });
  }
  return branches;
}

// The checkouts of a `worktree list --porcelain` run, whose records end at an
// empty line and hold `<label>` or `<label> <value>` lines; git lists the main
// tree first. A record with no `worktree` line is skipped.
function worktreeRecords(output: string, paths: Paths): GitWorktree[] {
  const trees: GitWorktree[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const endRecord = () => {
    if (path !== null) {
      trees.push({ path, branch, isMain: trees.length === 0 });
    }
    path = null;
    branch = null;
  };
  for (const line of output.split('\n')) {
    if (line === '') {
      endRecord();
      continue;
    }
    const space = line.indexOf(' ');
    const label = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (label === 'worktree') {
      path = paths.normalize(value);
    } else if (label === 'branch') {
      branch = value.replace(/^refs\/heads\//, '');
    }
  }
  endRecord();
  return trees;
}

// A path `git -C <root> rev-parse` printed, which is relative to `root`
// unless absolute.
function fullGitPath(root: string, gitPath: string, paths: Paths): string {
  return paths.isAbsolute(gitPath)
    ? paths.normalize(gitPath)
    : paths.join(root, gitPath);
}

async function lastFetch(
  root: string,
  deps: ProcessGitDeps,
): Promise<string | null> {
  try {
    const result = await deps.processes.run('git', [
      '-C',
      root,
      'rev-parse',
      '--git-path',
      'FETCH_HEAD',
    ]);
    if (result.code !== 0) {
      return null;
    }
    const fetchHead = fullGitPath(root, result.stdout.trim(), deps.paths);
    return new Date(await deps.files.modified(fetchHead)).toISOString();
  } catch {
    return null;
  }
}
