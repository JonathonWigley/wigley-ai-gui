import type { Files } from '../../contracts/files';
import type { Git } from '../../contracts/git';
import type { Paths } from '../../contracts/paths';
import type { ProcessRunner } from '../../contracts/processes';

interface ProcessGitDeps {
  processes: ProcessRunner;
  files: Files;
  paths: Paths;
}

// `Git` over the `git` on the PATH, one run per call (two for `fileAtHead` and
// `commitPaths`, up to two for `currentBranch`), each as `git -C <root> …`.
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
    commitPaths: async (root, paths, message) => {
      if (paths.length === 0) {
        throw new Error(`commitPaths in ${root}: no paths to commit`);
      }
      // `--literal-pathspecs` keeps a `*`, `?`, `[` or leading `:` in a path
      // from matching other files.
      await gitOutput(processes, 'add', [
        '-C',
        root,
        '--literal-pathspecs',
        'add',
        '--',
        ...paths,
      ]);
      await gitOutput(processes, 'commit', [
        '-C',
        root,
        '--literal-pathspecs',
        'commit',
        '--only',
        '-m',
        message,
        '--',
        ...paths,
      ]);
    },
  };
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
