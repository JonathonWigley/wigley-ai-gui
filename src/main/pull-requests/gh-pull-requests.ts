import type { ProcessRunner } from '../../contracts/processes';
import type {
  PullRequestInfo,
  PullRequests,
} from '../../contracts/pull-requests';
import { isJsonObject } from '../../shared/json';

interface GhPullRequestsDeps {
  processes: ProcessRunner;
}

// The most PRs one GitHub API page returns.
export const PR_LIST_LIMIT = 100;
export const PR_LIST_TIMEOUT_MS = 15_000;

const PR_LIST_ARGS = [
  'pr',
  'list',
  '--state',
  'all',
  '--json',
  'number,title,url,headRefName,state,updatedAt',
  '--limit',
  String(PR_LIST_LIMIT),
];

// gh prints a PR's state upper-case.
const STATE_OF_GH_STATE: Readonly<Record<string, PullRequestInfo['state']>> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
};

// `PullRequests` over the `gh` on the PATH, one `gh pr list` run per call.
export function createGhPullRequests(deps: GhPullRequestsDeps): PullRequests {
  return {
    forRepo: async (folder) => {
      try {
        const result = await deps.processes.run('gh', PR_LIST_ARGS, {
          cwd: folder,
          timeoutMs: PR_LIST_TIMEOUT_MS,
          // gh skips every interactive prompt when this is set to any value.
          setEnv: { GH_PROMPT_DISABLED: '1' },
        });
        const answered = result.code === 0 && !result.timedOut;
        return answered ? pullRequestsOfOutput(result.stdout) : null;
      } catch {
        return null;
      }
    },
  };
}

// The records of `gh pr list --json` output, each unreadable one dropped;
// null when the output is no JSON array.
function pullRequestsOfOutput(stdout: string): PullRequestInfo[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  return parsed.flatMap((record: unknown) => {
    const pullRequest = pullRequestOfRecord(record);
    return pullRequest === null ? [] : [pullRequest];
  });
}

function pullRequestOfRecord(record: unknown): PullRequestInfo | null {
  if (!isJsonObject(record)) {
    return null;
  }
  const { number, title, url, headRefName, state, updatedAt } = record;
  const hasReadableFields =
    typeof number === 'number' &&
    typeof title === 'string' &&
    typeof url === 'string' &&
    typeof headRefName === 'string' &&
    typeof updatedAt === 'string';
  const mappedState =
    typeof state === 'string' && Object.hasOwn(STATE_OF_GH_STATE, state)
      ? STATE_OF_GH_STATE[state]
      : undefined;
  if (!hasReadableFields || mappedState === undefined) {
    return null;
  }
  return {
    number,
    title,
    url,
    headBranch: headRefName,
    state: mappedState,
    updatedAt,
  };
}
