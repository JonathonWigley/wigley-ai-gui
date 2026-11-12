export interface GitCommit {
  sha: string;
  // Git's folded subject line; empty for a commit with no message.
  subject: string;
  // The committer date in strict ISO 8601 with its offset, as git prints it.
  at: string;
  // The paths the commit touched, from those `log` was asked for.
  paths: string[];
}

// One checkout of a clone: the main tree or a linked worktree.
export interface GitWorktree {
  // The checkout's top folder.
  readonly path: string;
  // The branch checked out, without `refs/heads/`; null on a detached HEAD or
  // a bare clone.
  readonly branch: string | null;
  // True for the main tree only.
  readonly isMain: boolean;
}

// A clone's git state and the one write the app makes to it. `root` is a
// clone's top folder, as `topLevel` returns it; paths in and out are relative
// to it, `/`-separated. Every method but `topLevel`, `originRepoName`,
// `currentBranch`, `hasUpstream`, `fetch` and `lastFetch`
// rejects `git <name> exited <code>: <stderr>` on a failed run; every method
// but `fetch` and `lastFetch` rejects when git cannot start.
export interface Git {
  // The clone's top folder holding `folder`, a full path; null when `folder`
  // is in no clone.
  topLevel(folder: string): Promise<string | null>;
  // The repo name the origin URL of the clone holding `folder` ends in, without
  // `.git`; null when `folder` is in no clone or the clone has no origin.
  originRepoName(folder: string): Promise<string | null>;
  // The branch checked out in the clone holding `folder`; the short commit on
  // a detached HEAD; null in no clone.
  currentBranch(folder: string): Promise<string | null>;
  // True when the clone at `root` is a linked worktree (`git worktree add`),
  // whose git folder sits inside another clone's.
  isLinkedWorktree(root: string): Promise<boolean>;
  // Every checkout of the clone at `root`, the main tree first, then each
  // linked worktree in `git worktree list` order.
  worktrees(root: string): Promise<GitWorktree[]>;
  // The git folder every checkout of the clone at `root` shares, a full path.
  commonDir(root: string): Promise<string>;
  hasUpstream(root: string): Promise<boolean>;
  // Files changed from HEAD or untracked, under `pathspec`; a rename names
  // both its paths.
  changedPaths(root: string, pathspec: string): Promise<string[]>;
  // Files HEAD changed since its merge base with the upstream, under
  // `pathspec`.
  unpushedPaths(root: string, pathspec: string): Promise<string[]>;
  // Path → blob id at the upstream, under `pathspec`.
  upstreamBlobs(root: string, pathspec: string): Promise<Map<string, string>>;
  // True when the fetch failed: a non-zero exit, `timeoutMs` passed, or git
  // did not start. Never rejects.
  fetch(root: string, timeoutMs: number): Promise<boolean>;
  // The full commit sha `ref` (a branch, a remote branch such as
  // `origin/main`, a tag or a sha) names; null when it names no commit.
  // Rejects when git fails otherwise, as in a folder that is no longer a clone.
  resolveCommit(root: string, ref: string): Promise<string | null>;
  // True when commit `ancestor` is `descendant` or one of its ancestors.
  // Rejects when either names no commit.
  isAncestor(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;
  // The modified time of the clone's FETCH_HEAD (ISO); null when never
  // fetched or on any failure. Never rejects.
  lastFetch(root: string): Promise<string | null>;
  // The file's text at HEAD; null when HEAD does not hold it. Rejects when
  // HEAD has no commit yet.
  fileAtHead(root: string, path: string): Promise<string | null>;
  // Stages `paths` and commits only them with `message`; anything else staged
  // stays staged. Rejects on an empty `paths`, committing nothing.
  commitPaths(root: string, paths: string[], message: string): Promise<void>;
  // The newest `limit` non-merge commits touching any of `paths`, newest first;
  // `[]` for a path with no history, and for an empty `paths`, running nothing.
  // Rejects when HEAD has no commit yet.
  log(root: string, paths: string[], limit: number): Promise<GitCommit[]>;
  // The oldest non-merge commit whose diff changed how often `text` occurs in
  // `path` (`git log -S`), which is the one that first added it; its `paths` is
  // `[path]`. `text` is matched as a raw substring, newlines included, so the
  // caller passes enough text to be unique in the file: `### Item` also matches
  // a commit that added `### Item two`. Null when no commit did, and for an
  // empty `text`, running nothing. Rejects when HEAD has no commit yet.
  firstAdded(
    root: string,
    path: string,
    text: string,
  ): Promise<GitCommit | null>;
}
