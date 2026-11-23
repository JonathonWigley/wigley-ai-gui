# 07 — Work detection

Status: not started
Type: Task
Rung: deep · signals.ts crosses git, gh, chat, sessions and unity-pool through async gathers, slot listeners and a debounce
Wave: 2 · Depends on: 01, 02, 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work/main/detection.ts` · test `src/plugins/work/main/detection.test.ts`
- create `src/plugins/work/main/signals.ts` · test `src/plugins/work/main/signals.test.ts`

Two modules. `detection.ts` is pure: it takes the cards, the signals seen, the settings and the Not yet marks, and
returns the suggestions. `signals.ts` gathers the signals from git, `gh` and the app's sessions, and decides when to
gather again. Task 09 wires both into the main part. The spec is `design.md` § Work detection.

Consumes:
- `GitBranch`, `Git.branches(root)`, `Git.commitsMatching(root, pattern, since)` in `src/contracts/git.ts` ← 01, and
  01's whole-key pattern form `(^|[^A-Za-z0-9])KEY([^0-9]|$)` for git's ERE (01 § Decisions, Regex portability)
- `PullRequestInfo`, `PullRequests.forRepo(folder)` in `src/contracts/pull-requests.ts` ← 02
- `WorkCard`, `WorkSuggestion`, `WorkSignal`, `WorkColumnSetting`, `WorkSignalSetting`, `OTHER_COLUMN`,
  `columnForStatus`, `ticketKeysIn` in `src/plugins/work/contract.ts` ← 04
- `WorkNotYet` in `src/plugins/work/main/store.ts` ← 04
- the work manifest's `dependsOn.main: ['chat', 'sessions']` and `reads.main: ['unity-pool']` ← 04, which let
  `signals.ts` import chat's, sessions' and unity-pool's contracts past the layer check
- From the tree:
  - `Git.topLevel`, `Git.originRepoName` (`src/contracts/git.ts`)
  - `ChatMainExports.projects()`, `ChatProject`, `chatSessionSlot`, `ChatSessionInfo.branch`
    (`src/plugins/chat/contract.ts`)
  - `sessionsRowsSlot`, `SessionRow` (`owner`, `titles.firstMessage`), `editableTitle` (`src/plugins/sessions/contract.ts`)
  - `unityPoolSnapshotSlot`, `PoolSnapshot`, `PoolState.clones[].path` (`src/plugins/unity-pool/contract.ts`)
  - `KeyedSlotReader`, `SlotReader` (`src/contracts/state.ts`), `Clock`, `Timers` (`src/contracts/ambient.ts`),
    `Paths` (`src/contracts/paths.ts`), `PluginLog`, `errorText`

Produces:

`src/plugins/work/main/detection.ts` (pure, no imports beyond the work contract and store types)
```ts
export interface SeenSignal {
  signal: WorkSignal;
  at: string;                 // ISO: branch tip, commit date, PR updatedAt, or a session's first sighting
  reason: string;             // the copy the card shows (Pinned values)
  keys: string[];             // the ticket keys the signal names, upper-case (Decisions, Matching)
  rowId: string | null;       // 'session' signals only: the chat.session key, the row id chat.launch returns
  branch: string | null;      // a branch signal's name, a PR's headBranch, a session's branch; null for a commit
  prState: 'open' | null;     // 'open' on a pr_opened signal, null on every other
}
export interface DetectionInput {
  cards: readonly WorkCard[];
  seen: readonly SeenSignal[];
  signals: Readonly<WorkSignalSetting>;     // work.signals
  columns: readonly WorkColumnSetting[];    // work.columns
  notYet: readonly WorkNotYet[];            // WorkFile.notYet
}
export function detectSuggestions(input: DetectionInput): WorkSuggestion[]
export function signalKeys(text: string): string[]           // ticketKeysIn(text.toUpperCase())
export function commitKeyPattern(key: string): string | null  // null for a key ticketKeysIn does not give back whole
```

`src/plugins/work/main/signals.ts`
```ts
export interface SignalDeps {
  git: Pick<Git, 'topLevel' | 'originRepoName' | 'branches' | 'commitsMatching'>;
  pullRequests: PullRequests;
  chat: Pick<ChatMainExports, 'projects'>;
  chatSessions: KeyedSlotReader<ChatSessionInfo>;    // api.state.read(chatSessionSlot)
  sessionRows: KeyedSlotReader<SessionRow>;          // api.state.read(sessionsRowsSlot)
  pools: SlotReader<PoolSnapshot>;                   // api.state.read(unityPoolSnapshotSlot)
  repoFolders(): readonly string[];                  // work.repoFolders, read at each gather
  cards(): readonly WorkCard[];                      // store.file().cards, read at each gather
  homeDir: string;
  paths: Paths;
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  onSeen(seen: readonly SeenSignal[]): void;         // each finished gather, and each seed
}
export interface SignalWatch {
  refresh(): void;                                   // gather now, coalesced
  seed(seen: readonly SeenSignal[]): void;           // the self-test and drive fixture's signals
  latest(): readonly SeenSignal[];
  dispose(): void;
}
export function createSignalWatch(deps: SignalDeps): SignalWatch
export function watchedRoots(
  deps: Pick<SignalDeps, 'git' | 'chat' | 'pools' | 'repoFolders' | 'homeDir' | 'paths'>,
): Promise<string[]>                                 // exported for its test
export const BRANCH_CHANGE_DEBOUNCE_MS = 5000
export const COMMIT_LOOKBACK_DAYS = 30
```

Decisions:
- **Matching (detection.ts).** The app has one key pattern, 04's `ticketKeysIn`.
  - `signalKeys(text)` is `ticketKeysIn(text.toUpperCase())`. Upper-casing first lets a lower-case branch name
    match, since branches are often lower case (`abc-12-fix`).
  - So `feature/abc-12-fix` and `ABC-12: tidy` name `ABC-12`. `ABC-123` and `XABC-12` do not, because
    `ticketKeysIn` gives them back as other keys. `abc-12_fix` names no key, because `ticketKeysIn`'s `\b` treats `_`
    as a word character. This is accepted: one rule for the whole app.
  - Each `SeenSignal` carries its `keys`, worked out at gather time. Detection compares `keys` with a Jira card's
    `key`, upper-cased, and reads no text itself.
- **`commitKeyPattern(key)`** is 01's form with the key put in: `(^|[^A-Za-z0-9])<KEY>([^0-9]|$)`. git matches it
  case-insensitively (01 passes `--regexp-ignore-case`). It returns null unless `ticketKeysIn(key)` is `[key]`, so no
  key needs escaping.
- **A signal belongs to a card** when any of these holds:
  1. The card is a Jira card, and the signal's `keys` hold `card.key`, both upper-cased.
  2. The signal's `rowId` is in `card.linkedSessionIds`.
  3. The signal is a PR signal (`pr_opened` or `pr_merged`), and its `branch` equals the `branch` of a `session`
     signal that belongs to the card by rule 2. This is how a local task's linked session makes "its branch and work
     count" (design § Spin-up). Rule 3 applies to PR signals only, so a linked session on `main` does not make every
     `main` branch signal match.
- A `pr_merged` signal does not count for a card while an open PR signal (`prState === 'open'`) also belongs to that
  card ("PR merged, none open").
- **A commit counts only after the card's last move** (design.md § Work detection, the Commit row). A `commit` signal
  counts for a card only when `card.movedAt` is null or the signal's `at` is later than it. `signals.ts` bounds the
  search the same way (Gathering), and detection checks again because a card can move after a gather.
- **The card's column** is 04's rule. A Jira card's column is `columnForStatus(card.jiraStatus, columns)`, and a local
  task's is its own `column`. Detection does not read a Jira card's stored `column`, which 06 leaves `''`.
- **Each signal's column** comes from `signals[signal]`. `'off'` drops the signal. A name that is not in `columns`
  drops it too, the same as off.
- **One entry per card at most.** For each card, detection takes the counting signal whose column sits furthest along
  `columns`. A tie goes to the newest `at`. Then:
  - **The column is after the card's column**: one `WorkSuggestion` `{ cardId: card.id, signal, column, reason, at,
    state: 'suggested' }`.
  - **The column equals a Jira card's column**: one `WorkSuggestion` with `state: 'done'` and that column. This is
    the move Jira's own automation already made, which the views show as done with no Accept and no Not yet (10, 11
    read `WorkSuggestion.state`).
  - **The column equals a local task's column, or sits before the card's column**: nothing.
- **No entry, of either state,** is made for a card:
  - in `OTHER_COLUMN`, since its place in the order is unknown
  - whose `movingTo` is not null, since a move is already under way
- **Not yet** (`WorkNotYet { cardId, signal, at }`, 04). A card's mark hides its entry when the chosen signal's `at`
  is at or before the mark's `at`. A newer signal shows again.
  - A `session` signal's `at` is the first sighting in this run, so a restart re-stamps it (Gathering). So a mark
    whose `signal` is `session` also hides any chosen `session` signal, whatever its `at`. 04's mark has no reason
    field, and this keeps a Not yet on a session suggestion across a restart.
  - Marks are written and removed by 08. Detection only reads them.
- The output is ordered by card, in input order.
- **Where the output goes.** 09 stores it in `WorkFile.suggestions`, and 04's `buildWorkState` publishes it. This task
  writes nothing.

- **Watched roots (signals.ts)** are the union of these folders:
  - each `folder` project's `folder` from `chat.projects()`, with `~` expanded against `homeDir`
  - each clone `path` of the pool a `pool` project names, from the unity-pool snapshot. A snapshot that reads
    `undefined`, as when unity-pool is off, adds none.
  - each `work.repoFolders` entry, `~` expanded

  Each folder maps to `git.topLevel`. A null result is dropped, and the roots are deduped with `paths`, never by
  string compare.
- **Per root.** Every root's work runs in parallel.
  - **Branches.** `git.branches(root)` gives one `branch` signal per branch whose `signalKeys(name)` holds a Jira
    card's key. Its `keys` are those keys, its `branch` the name, and its `at` the tip time.
  - **Commits.** For each Jira card with a key that `commitKeyPattern` accepts, one
    `git.commitsMatching(root, commitKeyPattern(card.key), since)` runs. `since` is the card's `movedAt`. When
    `movedAt` is null, as for every card 06 has not yet seen change status, `since` is `COMMIT_LOOKBACK_DAYS` (30) days
    before `clock.now()`, so a card never seen to move does not search all of history. Each commit gives one `commit`
    signal with `keys: [card.key]`, `branch: null`, and the commit's `at`. The search is per card because `--grep`
    matches the body too, so the subject alone cannot show which key matched. Within one root the card searches run
    one after another, and the roots run in parallel.
  - **Pull requests.** The `originRepoName(root)` call groups the roots by origin name, so one `forRepo` runs per
    origin repo. That keeps four pool clones of one GitHub repo from running `gh` four times. A root with no origin
    runs none. Each PR gives a signal:
    - state `open`: a `pr_opened` signal with `prState: 'open'`
    - state `merged`: a `pr_merged` signal
    - state `closed`: none

    Its `keys` are `signalKeys(title + ' ' + headBranch)`, its `branch` is `headBranch`, and its `at` is `updatedAt`.
    It is kept when its keys hold a Jira card's key, or when its `headBranch` equals a gathered session signal's
    branch.
- **Sessions.**
  - Each `chat.session` entry whose `sessions.rows` row has `owner === null` gives one `session` signal. This leaves
    out the work plugin's own job rows and every other owned row. Its `keys` are
    `signalKeys((branch ?? '') + '\n' + (titles.firstMessage ?? ''))`, its `rowId` is the entry's key, and its
    `branch` is the session's branch.
  - Its `at` is the first gather that saw the row id, stamped from `clock`. The stamp is kept in memory for the
    watch's life.
  - A row with no key gives the signal too. Detection uses it only through a link (rules 2 and 3).
- **Failures.**
  - A rejected `branches`, `commitsMatching` or `topLevel` call logs `signals: <root>: <errorText>`. That part of the
    root is skipped, and the other roots still count.
  - `forRepo` returning null gives no PR signals and logs nothing, because null is the normal "no gh" answer.
- **When it runs.** This is the pinned answer to how often.
  - `refresh()` runs at each sweep's end. 09 calls it when a sweep job ends, done or failed.
  - The watch listens on `chat.session` and `sessions.rows`. A session's `branch` changing, a session appearing with
    a branch, a session leaving, or a session's `titles.firstMessage` changing each re-gathers once
    `BRANCH_CHANGE_DEBOUNCE_MS` of quiet has passed. Each change re-arms the one timer.
  - Gathering does not run when the watch is created. The first sweep's end runs it.
  - Settings, card and Not yet changes run no gather. 09 re-runs `detectSuggestions` on `latest()` for those.
- **Coalescing.** A `refresh` while a gather runs marks one more gather to run after it, and further calls add none.
  `dispose` clears the timer, and a gather that settles after it calls no `onSeen`.
- **Seeding.** `seed(seen)` sets `latest()` and calls `onSeen` with no I/O. It stands until the next gather.

Pinned values:
- `BRANCH_CHANGE_DEBOUNCE_MS = 5000`, `COMMIT_LOOKBACK_DAYS = 30`
- Reason copy, where `<repo>` is the root folder's base name:
  - branch: `Branch <name> in <repo>`
  - commit: `Commit <sha 7> "<subject>" in <repo>`
  - pr_opened: `PR #<number> open: <title>`
  - pr_merged: `PR #<number> merged: <title>`
  - session with a branch: `Session "<editableTitle>" on <branch>`
  - session without one: `Session "<editableTitle>"`
- Log line: `signals: <root>: <errorText>`

GIVEN card `ABC-12` with status `To Do` (Todo) and a branch `abc-12-fix` WHEN detection runs with the default signals THEN it returns one suggestion `{ cardId: 'ABC-12', signal: 'branch', column: 'In Progress', reason: 'Branch abc-12-fix in repo', state: 'suggested' }`
GIVEN card `ABC-12` with status `Done` and a merged PR naming it WHEN detection runs THEN it returns an entry with `column: 'Done'` and `state: 'done'`
GIVEN a Not yet mark at the branch signal's `at` WHEN the same branch is seen again THEN nothing is suggested, and WHEN a PR opens later THEN the `pr_opened` suggestion to In QA shows
GIVEN card `ABC-12` with `movedAt` T and a commit naming it before T WHEN detection runs THEN the commit does not count
GIVEN a local task linked to row S on branch `spike/x`, and an open PR with head `spike/x` WHEN detection runs THEN the local task gets the In QA suggestion
GIVEN two branch changes 1 s apart WHEN 5 s pass after the second THEN one gather runs

Tests:
- `detection.test.ts` › `detectSuggestions` table, each row a card list, seen signals, settings and marks, with the
  expected output:

  | case | expect |
  |---|---|
  | branch key, Todo card | `suggested` to In Progress, branch reason |
  | lower-case `feature/abc-12-fix` | matches |
  | `ABC-123` and `XABC-12` against card `ABC-12` | no match |
  | signal column before the card's | nothing |
  | Jira card already in the signal's column | `done` entry, column equals the card's |
  | local task in the signal's column | nothing |
  | two signals, In Progress and In QA | the In QA one |
  | tie on column | the newer `at` |
  | `pr_merged` while an open PR names the card | the merge ignored; the open PR's In QA |
  | signal set `off`, or naming an unknown column | nothing |
  | commit before the card's `movedAt` | nothing |
  | commit after it, or `movedAt` null | counts |
  | card in Other (unmapped status `Blocked`) | nothing |
  | card with `movingTo` set | nothing |
  | mark with `at` at or after the signal's | hidden |
  | mark older than a newer signal | shown |
  | `session` mark, session signal re-stamped later | hidden |
  | local task, session link by row id | session suggestion |
  | local task, PR on the linked session's branch | PR suggestion |
  | linked session on `main`, unrelated branch `main` signal | no match from rule 3 |
  | status matched case-insensitively (`in qa`) | column In QA |

- `detection.test.ts` › `commitKeyPattern`: `ABC-12` gives `(^|[^A-Za-z0-9])ABC-12([^0-9]|$)`; `ab c-1` and `A-1`
  give null.
- `signals.test.ts`, over fake git, pull requests, slots and timers:
  - `watchedRoots — folders, pool clones and repoFolders deduped by top level`: one folder project, a pool project
    with two clones, a `repoFolders` entry inside the first folder, and a folder in no clone. Expect three roots,
    `~` expanded.
  - `gather — signals per source`: a table of branch, commit, open PR, merged PR, closed PR, an owned row and an
    unowned row, with the expected `SeenSignal`s, their `keys` and their reasons.
  - `gather — one commitsMatching per Jira card, since its movedAt or 30 days back`
  - `gather — one forRepo per origin repo name`
  - `gather — a failing root logs and the others count`
  - `gather — no Jira card runs no commitsMatching`
  - `watch — branch changes debounce to one gather`
  - `watch — refresh during a gather runs one more, not two`
  - `watch — dispose drops a settling gather`
  - `watch — seed reports with no git call`
  - `watch — a session's first sighting keeps its at across gathers`

Done when: `npm run typecheck` and `npm run lint` pass (layers and styles), the test gate runs the tests above, and
runtime checks defer to task 14 (Final verification).
Commit: one commit for the group.

## Proof

