# 05 — Runs model, run times and focus on close

Status: in progress
Type: Batch
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/page/activity-runs.ts` · test `src/plugins/chat/page/activity-runs.test.ts` · modify `src/plugins/chat/page/entry-focus.ts` · test `src/plugins/chat/page/entry-focus.test.ts`
Consumes:  `ChatEntry` with `at: number` in `src/contracts/agent.ts` ← 04
Produces:  in `src/plugins/chat/page/activity-runs.ts`:
           `export type StepEntry = Extract<ChatEntry, { kind: 'tool' | 'thinking' | 'raw' }>;`
           `export function isStep(entry: ChatEntry): entry is StepEntry`
           `export type ListRow = { kind: 'entry'; entry: ChatEntry } | { kind: 'run'; runId: string; steps: StepEntry[]; live: boolean; startedAt: number; endedAt: number | null };`
           `export type ListStop = { kind: 'entry'; entry: ChatEntry } | { kind: 'activity'; runId: string; steps: readonly StepEntry[] };`
           `export function runIdOf(firstStepId: string): string` — returns `activity:<firstStepId>`
           `export function listRows(entries: readonly ChatEntry[], working: boolean): ListRow[]`
           `export function cursorStops(rows: readonly ListRow[], openRuns: ReadonlySet<string>): string[]`
           in `src/plugins/chat/page/entry-focus.ts`:
           `export function focusAfterClose(focus: EntryFocus, runId: string, stepIds: readonly string[]): EntryFocus`
Decisions: a step is a `tool`, `thinking` or `raw` entry; a run is a maximal sequence of consecutive steps; any other kind ends it (the user's answer)
           **run times** (the user's timer requirement): `startedAt` is the `at` of the entry right before the run (the user message, mid-turn assistant text, or any other entry); a run that opens the list starts at its first step's `at`. `endedAt` is the `at` of the entry right after the run; a live run has `endedAt: null` (its line ticks to now); a finished run that is the last row ends at its last step's `at`, the latest time known for it (design review)
           `listRows` keeps entry order; each run's `runId` is `runIdOf(first step's id)`; `live` is true only for a run that is the last row and only when `working` is true
           `cursorStops`: an entry row gives its entry id; a run row gives its `runId`, then, when `openRuns` holds the `runId`, each step's id in order
           `focusAfterClose`: a focus whose `entryId` is in `stepIds` becomes `{ entryId: runId, following: focus.following }`; any other focus is returned unchanged
           both modules stay pure: no DOM, no layout host (plan.md § Boundary rules)
GIVEN entries user, tool, thinking, assistant WHEN listRows runs THEN the rows are entry, run(tool, thinking), entry
GIVEN entries ending in a tool and working true WHEN listRows runs THEN the last run is live; with working false, or with a result entry after it, it is not
GIVEN user at 1000, tool at 3000, tool at 9000, assistant at 43000 WHEN listRows runs THEN the run has `startedAt: 1000` and `endedAt: 43000`
Tests:     `activity-runs.test.ts`, one `it.each` table for `listRows` (entries by kind and id, `working`, expected rows as `entry:<id>` / `run:<runId>:<live>` strings), with rows: `user,tool,thinking,assistant` → entry, run, entry; `tool,permission,tool` with working → run (not live), entry, run (live); `tool,result` with working → run not live; `raw` alone with working false → run not live; `user,assistant` → no runs
           `activity-runs.test.ts`, one `it.each` table `listRows_RunTimes_<case>` over entries with `at` → expected `startedAt`/`endedAt`: user before and assistant after (1000/43000); the run opens the list (first step's `at`); live (`endedAt` null); finished and last (last step's `at`); a permission before the run (the permission's `at`)
           `activity-runs.test.ts`, one `it.each` table for `cursorStops`: a closed run gives one stop; an open run gives its run id then its step ids; two runs, one open
           `entry-focus.test.ts`, a table for `focusAfterClose`: focus on a closed step → run id with `following` kept (both true and false rows); focus on another entry → unchanged; `START_FOCUS` → unchanged
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

