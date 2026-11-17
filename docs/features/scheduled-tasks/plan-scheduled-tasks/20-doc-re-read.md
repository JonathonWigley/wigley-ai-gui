# 20 — Doc re-read

Status: in progress
Type: Task
Wave: 6 · Depends on: 01–19 (re-reads every task's docs), 22–25 (re-reads every task's docs)
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale: `docs/features/scheduled-tasks/design.md` ·
           `docs/features/session-host/design.md` · `AGENTS.md` · `docs/features/followups.md` ·
           `src/plugins/chat/contract.ts` (the `ChatSessionInfo.projectDir` comment) ·
           `docs/features/layouts/design.md` (the `scheduling` Adopters row) — all in `<gui>` ·
           `<market>/plugins/wigley/scripts/forms/README.md` (the relay README, in this same worktree)
Consumes:  the landed code of tasks 01–19 and 22–25 · the docs commit plan.md § Docs written ahead names
Produces:  no code; each doc above true to the landed code; at most one fix commit per folder

## Decisions

- **Why.** Every doc above was written before the code, so each is a hypothesis (`wigley:writing-for-agents` §
  Doctrine before code). This task reads each one line by line against the landed code and fixes every stale line.
- **Read each doc whole.** For each doc, list each claim it makes about a name, a path, a shape, a number, a rule or a
  key, and check each against the tree in one batched call of greps (`~/wigley-agents/AGENTS.md` § Tools). Read
  `<gui>/AGENTS.md` only at the lines the docs commit changed (`git -C <gui> show <docs commit> -- AGENTS.md`), since
  the file is 125k characters.
- **What to check, per doc.** Each item below is a claim the doc holds and the code that settles it:
  - `scheduled-tasks/design.md`: the task file path, its JSON shape and its example against `readTaskFile` (03) —
    the example must parse; the six schedule kinds, the cron dialect and the DST rules against `schedule.ts` (03);
    who fires, the catch-up window, one run per task and the re-plan triggers against `main/start.ts` (17) and
    `planner.ts` (10); the overlap skip against `pending-queue.ts` (07); the carried env names against
    `claude-launch.ts` (08); the offline answers table against each contributor (09) and plan.md § Offline answers per
    tool; adoption and `replayCalls` against 14 and 05; login start against the adapter `main.ts` picks (18) — name
    the adapter task 01 recorded; the keys against `src/plugins/keymap.ts` (12); the history file and its cap against
    `history-store.ts` (11); the unviewed mark kept in history's `viewed` against `main/start.ts` (17); a prepare
    refusal as a failed history entry with its reason (17); the login entry `--start-session-host` against `main.ts`
    (18); `r` Run now and `p` Pause/Resume against `keymap.ts` (12); the four tools and the refusal text against
    `task-tools.ts` (15). It must also say that a
    hand edit keeps the file's `updatedAt` (11's Decisions), that the task file refuses app writes while it fails to
    parse (11), and that a run row restored under a new row id stops counting as a run row (17); add each line that
    is missing.
    Also check, each against the task named: the `CLAUDE_CONFIG_DIR` reason sentence in § The environment of a run
    reads "a profile with no folder of its own" (`profileDir` null), against `claudeEnv` and `claudeUnsetEnv` (02,
    08); the history line texts (`Running`, `Finished`, `Skipped, previous run still going`, `Failed to start:
    <reason>`, `No runs yet.`), the linking rule (a line links only while its run row is open), the notices and the
    env note's place (under the editor's rows) against 12's Decisions and `schedules-state.ts`; the catch-up lines (a
    hand-written task with an old `updatedAt` catches up once; no catch-up in a start whose `history.json` did not
    load) against `planner.ts` (10) and `main/start.ts` (17); a deleted task file empties the list (11); a `once`
    time a DST gap skips is refused (03); the finished-at-adoption rule (a relay row's run
    finished at adoption included) and the re-plan triggers (`chat.onInstructionsChanged` included; the
    `claude.command` path, profiles and projects reaching a pending run only at its next re-prepare) against
    `main/start.ts` (17); § Adoption's already-open rule (`adopt` resolves to the row that holds the host session
    id) and the rejection rule against 14 and 17; the spawn-error reason text against `run-records.ts` (17); the
    replay wording (callers noted by the attach replay or the resting row's history read; an un-noted replayed
    main-agent-only call skipped, no wait) in § Flow and § With the app closed against 05 and 14; the login-start condition (a task not
    paused with a planned run) against 17; a project's own profile as the tools' default and the update re-cap
    against `task-tools.ts` (15).
  - `session-host/design.md`: the overlay and `unsetEnv` rule against `process-table.ts` (02); the pending queue,
    the skip rule, the runs record, the exit rule, the file names `pending-v4.json` and `runs-v4.json`, and protocol
    4 against 07 and `session-host-protocol.ts`; the drain dropping pending and freezing the runs file, and the new
    host's import of older runs files at load and before each `listRuns`, against 07; the re-send on connect after the
    drain, and `onConnected`, against 13; the login start platforms and the `--start-session-host` entry against 18.
  - `session-host/design.md`, again for tasks 24 and 25, which edit it: the one-host lock (`<channel>.lock`, its pid, the
    stale-lock takeover, `shutDown` removing the record only when it holds its own pid) against 24, the two "known
    limits" bullets it rewrote, and the turn-state rule (open stdin messages, an open main turn, `local_agent`
    background work, `isIdle`) against `process-table.ts` and `claude-launch.ts` (25).
  - `src/contracts/files.ts`'s `watch` comment: the temp-name rule (a `.<name>.<8hex>.tmp` event debounced under its
    target, the target reported only when it exists at the end of the quiet window) against 22.
  - `layouts/design.md`: the `scheduling` Adopters row against `src/plugins/scheduling/layouts/layout.d.ts` (12).
  - `AGENTS.md`: the tree lines for `src/plugins/scheduling/`, `src/main/login-start/` and
    `src/session-host/pending-queue.ts` against the files on disk; the MCP tool bullet's `offline` option against
    `ContributeToolsOptions` (05); `scheduled-tasks.json` in the user config folder bullet; `<Leader>kt`; the stable
    and dev app line against 17's `fires` rule. When task 19 added a self-test script, add its path to the
    § Running and testing list of self-test scripts in the same form as the others. These lines list members the
    landed code adds and the docs commit did not touch; add each new member where the line lists its siblings:
    chat's main-exports sentence (gains `prepareLaunch`, `adopt`, `projects`; `grep -n 'defaultProfile' AGENTS.md`
    finds it), the sessions plugin entry (gains `offlineEnv`, `replayCalls`), § An agent harness (gains `prepareRun`,
    `startControls`, `capControls`), the `src/shared` listing (gains `permission-cap.ts`, `fake-login-start.ts`), and
    the ambient-services sentence (gains the main-only `loginStart`). Find each with one batched grep.
  - `followups.md`: the Windows login start item is present once, in the file's item shape.
  - `chat/contract.ts`: the `projectDir` comment says what is true; `grep -n 'row moves once'
    src/plugins/chat/contract.ts` finds nothing.
  - `<market>` README § The relay › Offline mode: the env var, the `offline.json` shape, the calls-file line shape,
    the error text `The app is closed: <tool> did not run.`, the deny for a left-out `permission_prompt`, a missing or
    unreadable `offline.json`, a null hello `session_id`, and the reconnect against `relay.py` (04); § Boundary rules
    still true. Also the three other places the written-ahead commits changed: the Starting the app sentence ("in
    offline mode it answers from the app's table instead"), the App gone mid-call sentence (the relay starts no app at
    the end of the 30 s), and the test-suite list, each against `relay.py` and `tests/test_relay.py`. Read and fix the
    README in `<market>`: it sits in this worktree, on the branch task 21 lands.
- **A fix** rewrites the stale line to what the code does, in the doc's own present tense, and keeps the doc's
  shape. When the code is wrong and the doc is right, do not change the doc: report it to the lead as a concern.
- **Commits.** One commit for the `<gui>` doc fixes and one for the `<market>` README, each by pathspec on this
  worktree's branch (task 21 lands it). A folder
  with no fix gets no commit. The commit message lists each fixed doc and what was stale.

GIVEN the docs written ahead and the landed code WHEN this task ends THEN every claim listed above matches the code,
and each stale line is fixed in a commit

## Tests

None: a doc change no test can check. The re-read is the check.

Done when: every check above is done; `grep -n 'row moves once' <gui>/src/plugins/chat/contract.ts` finds nothing;
the task file example in `scheduled-tasks/design.md` meets every `readTaskFile` rule in 03's Decisions, read field
by field; each folder's fix is committed.
Commit:    one commit per folder with a fix

## Proof
