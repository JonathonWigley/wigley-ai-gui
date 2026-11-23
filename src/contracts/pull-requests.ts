// One pull request of a GitHub repo.
export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  // The branch the PR merges from, without `refs/heads/`.
  headBranch: string;
  state: 'open' | 'merged' | 'closed';
  // When the PR last changed, in ISO 8601 as GitHub prints it.
  updatedAt: string;
}

// A clone's pull requests, read from its GitHub repo.
export interface PullRequests {
  // The 100 most recently created PRs of the GitHub repo the clone holding
  // `folder` points at, in every state, so an older PR is absent; null when
  // that cannot be read: the tool is missing or signed out, the folder has no
  // GitHub remote or is in no clone, or the read failed or timed out. Never
  // rejects.
  forRepo(folder: string): Promise<PullRequestInfo[] | null>;
}
