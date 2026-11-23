# 02 — Pull-request service over gh

Status: not started
Type: Task
Rung: hard · adds the `PullRequests` contract and `MainServices.pullRequests`, which 07 consumes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/contracts/pull-requests.ts`
- create `src/main/pull-requests/gh-pull-requests.ts`
- test `src/main/pull-requests/gh-pull-requests.test.ts`
- modify `src/contracts/plugin.ts`
- modify `src/main/main.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `scripts/check-layers.mts`

Consumes:  `ProcessRunner.run` (`src/contracts/processes.ts`) · `FakeProcesses` (`src/shared/fake-processes.ts`) for the test
Produces:
- In `src/contracts/pull-requests.ts`:
  - `export interface PullRequestInfo { number: number; title: string; url: string; headBranch: string; state: 'open' | 'merged' | 'closed'; updatedAt: string }`
  - `export interface PullRequests { forRepo(folder: string): Promise<PullRequestInfo[] | null> }`
- In `src/main/pull-requests/gh-pull-requests.ts`:
  - `export function createGhPullRequests(deps: { processes: ProcessRunner }): PullRequests`
  - `export const PR_LIST_LIMIT = 100`
  - `export const PR_LIST_TIMEOUT_MS = 15_000`
- `pullRequests: PullRequests;` on `MainServices` in `src/contracts/plugin.ts`, directly after `git: Git;`

## Decisions

- **The seam** follows the plan's boundary rule. `gh` runs only in `gh-pull-requests.ts`, the way `git` runs only in
  `process-git.ts` (AGENTS.md § A third-party tool). The contract file imports nothing. Its comment states what null
  means.
- **The gh call** is one `processes.run` per `forRepo`, with these pinned args and options:

  ```
  gh pr list --state all --json number,title,url,headRefName,state,updatedAt --limit 100
  options: { cwd: folder, timeoutMs: 15_000, setEnv: { GH_PROMPT_DISABLED: '1' } }
  ```

  - Checked against https://cli.github.com/manual/gh_pr_list on 2026-11-23:
    - `--state` takes `open|closed|merged|all`.
    - The default `--limit` is 30.
    - `number`, `title`, `url`, `headRefName`, `state` and `updatedAt` are all `--json` fields.
  - `GH_PROMPT_DISABLED` ("set to any value to disable interactive prompting", `gh help environment`) keeps gh from
    waiting on a prompt the app can never answer.
  - `gh` is run as a bare name, as `git` is. `ProcessRunner` looks it up on the PATH, which main swaps for the login
    shell's at a Finder start (AGENTS.md § Dev quirks). On Windows it looks it up over PATH × PATHEXT.
  - The run goes through the root runner (`processes` in `main.ts`), not a per-plugin view, as `git` does. A plugin's
    stop does not abort it. The 15 s timeout bounds it.
- **Limit 100** is the most one GitHub API page returns. It covers a repo's recent PRs across all states for detection.
  Detection only needs PRs whose head branch carries a card's key, and those are recent.
- **Mapping.** Each JSON record becomes `{ number, title, url, headBranch: headRefName, state, updatedAt }`.
  - `state` maps `OPEN` → `open`, `MERGED` → `merged`, `CLOSED` → `closed`. gh prints these upper-case values.
  - A record with any other state, or a field of the wrong type, is dropped, and the rest are kept. Fail closed per
    record.
  - `updatedAt` stays gh's ISO string.
  - Order is gh's output order.
- **Null, never a rejection.** `forRepo` never rejects. It resolves null when:
  - the run rejects (gh is not installed: `Could not run gh: …`)
  - the run times out (`timedOut`)
  - gh exits non-zero: exit 4 is "requires authentication" (`gh help exit-codes`), and exit 1 covers a folder with no
    GitHub remote, a folder that is no clone, and a network failure
  - stdout is not a JSON array

  The caller cannot tell these apart from gh's output alone, and detection treats every one as "no PR signal this
  sweep". An empty array resolves `[]`, which is a GitHub repo with no PRs.
  - Contract comment: "The newest PRs of the GitHub repo the clone holding `folder` points at, in every state; null
    when that cannot be read: the tool is missing or signed out, the folder has no GitHub remote or is in no clone,
    or the read failed or timed out. Never rejects."
- **Wiring in `main.ts`.** Make `const pullRequests = createGhPullRequests({ processes });` directly below
  `const git = createProcessGit(…)` (line 485). Pass `pullRequests` beside `git` in the `startMainParts` services
  record (line 1276).
  - It is one instance for every run mode, as `git` is.
  - The two builds near lines 359 and 387 (`liveServices`, `offscreenRunServices`) are `ModeServices.forWindow`, a
    `Pick` of window-bound services. They stay untouched, and `pullRequests` does not join that `Pick`.
  - The self-test and drive runs watch no real repo, since their homes hold no chat projects. So nothing calls gh
    there.
- **Fakes the typecheck names.** The only full `MainServices` literal outside `main.ts` is the part harness in
  `src/shared/plugin-part-harness.test-support.ts`. Add `pullRequests: notFaked<PullRequests>('pullRequests')` beside
  `git: notFaked<Git>('git')`, so a test that does not fake it throws on use.
  - Every other test hands `services` as a partial cast: `as unknown as Parameters<…>[0]` or `as never`. These need no
    edit.
  - `src/main/plugins/main-api.ts` spreads `deps.services`, so it carries the new member unchanged.
- **Layers.** Add a `CORE_LAYERS` entry in `scripts/check-layers.mts`:
  - `'src/main/pull-requests': { layers: ['src/contracts'] }`
  - its test `'src/main/pull-requests/gh-pull-requests.test.ts': { layers: ['src/contracts', 'src/shared', 'src/main/pull-requests'] }`
  - `'src/main/pull-requests'` in the `src/main/main.ts` entry's list, after `'src/main/git'`

  This follows the `src/main/git` entries at lines 753–765. AGENTS.md § Architecture says a new core adapter gets an
  entry and the composition root's entry lists it.
- **Not here:** AGENTS.md's layout block and services list gain the adapter in task 13, with the code landed.

GIVEN gh prints two PRs WHEN `forRepo` runs THEN it resolves both, `headRefName` as `headBranch` and the state lower-cased
GIVEN gh prints a record with state `DRAFT` WHEN `forRepo` runs THEN that record is dropped and the others are kept
GIVEN gh exits 4, or 1 WHEN `forRepo` runs THEN it resolves null
GIVEN gh cannot start WHEN `forRepo` runs THEN it resolves null and does not reject
GIVEN the run times out WHEN `forRepo` runs THEN it resolves null
GIVEN gh prints text that is not a JSON array WHEN `forRepo` runs THEN it resolves null
GIVEN gh prints `[]` WHEN `forRepo` runs THEN it resolves `[]`

## Tests

New file `src/main/pull-requests/gh-pull-requests.test.ts`, over `FakeProcesses`, scripted on the pinned args.

- `forRepo_GhOutput_MapsEachRecord`: output holds an `OPEN` and a `MERGED` record. The result equals the two mapped
  records in order. `processes.runs[0]` has `command: 'gh'`, the pinned args, `cwd: '/r'`, `timeoutMs: 15000` and
  `setEnv: { GH_PROMPT_DISABLED: '1' }`.
- `forRepo_UnreadableRecord_DropsOnlyIt`, a table of three rows: state `DRAFT`, `number` a string, and `headRefName`
  missing. Each row's output holds one valid `CLOSED` record beside the bad one, and the result is the valid record
  alone.
- `forRepo_GhCannotAnswer_Null`, a table with one row per null cause:
  - exit 4 with stderr `gh auth login`
  - exit 1 with stderr `none of the git remotes configured for this repository point to a known GitHub host`
  - a scripted `Error('Could not run gh: ENOENT')`
  - `timedOut: true` with code -1
  - exit 0 with stdout `not json`
  - exit 0 with stdout `{}`
- `forRepo_NoPullRequests_EmptyList`: exit 0 with `[]` resolves `[]`.

Done when: `npm run typecheck` and `npm run lint` pass (the layer check included), and the test gate runs the tests
above. The live `gh` read is checked in [14 — Final verification](14-final-verification.md).
Commit:    one commit for the group

## Proof

