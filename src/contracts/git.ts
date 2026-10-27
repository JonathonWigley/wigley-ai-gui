// A clone's git state and the one write the app makes to it. `root` is a
// clone's top folder, as `topLevel` returns it; paths in and out are relative
// to it, `/`-separated. Every method but `topLevel`,
// `hasUpstream`, `fetch` and `lastFetch` rejects
// `git <name> exited <code>: <stderr>` on a failed run; every method but
// `fetch` and `lastFetch` rejects when git cannot start.
export interface Git {
  // The clone's top folder holding `folder`, a full path; null when `folder`
  // is in no clone.
  topLevel(folder: string): Promise<string | null>;
  // True when the clone at `root` is a linked worktree (`git worktree add`),
  // whose git folder sits inside another clone's.
  isLinkedWorktree(root: string): Promise<boolean>;
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
  // The modified time of the clone's FETCH_HEAD (ISO); null when never
  // fetched or on any failure. Never rejects.
  lastFetch(root: string): Promise<string | null>;
  // The file's text at HEAD; null when HEAD does not hold it. Rejects when
  // HEAD has no commit yet.
  fileAtHead(root: string, path: string): Promise<string | null>;
  // Stages `paths` and commits only them with `message`; anything else staged
  // stays staged. Rejects on an empty `paths`, committing nothing.
  commitPaths(root: string, paths: string[], message: string): Promise<void>;
}
