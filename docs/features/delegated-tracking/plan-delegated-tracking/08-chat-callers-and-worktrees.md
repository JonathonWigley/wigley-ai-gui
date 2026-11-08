# 08 — Chat names each call's agent and each touched worktree

Status: done
Type: Batch
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/tool-callers.ts` · test `src/plugins/chat/main/tool-callers.test.ts` ·
           modify `src/plugins/chat/main/worktree-name.ts` · test `src/plugins/chat/main/worktree-name.test.ts` ·
           modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` ·
           modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts` ·
           modify `src/plugins/chat/contract.ts` (one comment)

Reads:     `AGENTS.md` § Architecture, the bullets "A registration", "An agent event", "An MCP tool" (already
           updated), "An ambient service" and "A path", and the src tree entry `chat/`.
           `docs/features/workflow/design.md` § Signals, the paragraph on the tools (already updated).

Consumes:  `addToolCallGuard(guard: ToolCallGuard): Disposable` ← 03 ·
           `export type ToolCallGuard = (call: GuardedToolCall) => Promise<ToolCallVerdict>;` ← 03 ·
           `GuardedToolCall` and `ToolCallVerdict` in `src/plugins/sessions/contract.ts` ← 03 ·
           `worktrees(root: string): Promise<GitWorktree[]>;` ← 02 ·
           `export interface GitWorktree { readonly path: string; readonly branch: string | null; readonly isMain: boolean }` ← 02 ·
           `Timers` (`set(run, ms): number; clear(handle): void`) in `src/contracts/ambient.ts`, which the tree holds ·
           `ChatSessions.hostSessionIdOf(sessionId: string): string | null`, which the tree holds ·
           the `toolStarted` member of `AgentEvent` (`agentId`, `toolUseId`) and the `tool` `ChatEntry`
           (`agentId`, `name`, `input`) in `src/contracts/agent.ts`, which the tree holds

Produces:  in `src/plugins/chat/main/tool-callers.ts`:

```ts
export const CALLER_WAIT_MS = 2_000;
export const SUBAGENT_CALL_TEXT =
  "Only the main agent's call changes this session, so this call changed nothing.";
export interface ToolCallers {
  noteToolStarted(sessionId: string, toolUseId: string, agentId: string): void;
  agentOf(sessionId: string, toolUseId: string): Promise<string | null>;
  forget(sessionId: string): void;
  stop(): void;
}
export function createToolCallers(timers: Timers): ToolCallers;
export interface CallerGuardDeps {
  readonly callers: Pick<ToolCallers, 'agentOf'>;
  // True for a row chat holds.
  owns(sessionId: string): boolean;
}
export function callerGuard(deps: CallerGuardDeps): ToolCallGuard;
```

           in `src/plugins/chat/main/worktree-name.ts`:

```ts
export function worktreesInCommand(command: string, roots: readonly string[]): string[];
```

           `ChatSessionsDeps` in `chat-sessions.ts` gains `toolCallers: Pick<ToolCallers, 'noteToolStarted'>`, and its
           `git` becomes `Pick<Git, 'topLevel' | 'currentBranch' | 'worktrees'>`.

## Part A — which agent made a call

Decisions:
- Chat keeps the map, since sessions cannot hear `chat.agentEvent`: sessions' manifest depends on nothing, and chat
  depends on sessions (design review; verified at plan time in `chat/manifest.ts`).
- `ToolCallers` keeps, per row id (the app's session id), a map from tool-use id to agent id.
  - `noteToolStarted` adds the pair. It resolves every `agentOf` read that waits for that row and that tool-use id with
    the agent id, and clears each one's timer.
  - `agentOf` resolves the noted agent id at once when the pair is noted. Otherwise it sets one timer of
    `CALLER_WAIT_MS` through the injected `Timers` and waits. A note that arrives first resolves it with the agent id.
    The timer firing first resolves it with null.
  - The map lasts for the row's life. `agentFinished` does not remove a pair, so a late call from an ended subagent
    still reads as that subagent's.
  - `forget(sessionId)` drops the row's map, resolves the row's waiting reads with null, and clears their timers.
  - `stop()` does `forget` for every row.
- The clock is not needed: the wait is one timer (AGENTS.md "An ambient service"). The plugin's own timers view clears a
  pending timer at the plugin's stop, so `stop()` resolves the waiting reads first and no read stays open.
- `callerGuard` answers, in this order:
  1. `mainAgentOnly` false → `{ kind: 'run' }`. It does not read the map.
  2. `toolUseId` null → `{ kind: 'run' }`.
  3. `owns(sessionId)` false → `{ kind: 'run' }`: a session chat does not own has no stream (a terminal session).
  4. Otherwise it awaits `agentOf(sessionId, toolUseId)`. Null (no note in 2000 ms) or `MAIN_AGENT_ID` →
     `{ kind: 'run' }`. Any other agent id → `{ kind: 'skip', text: SUBAGENT_CALL_TEXT }`.
- Chat names no tool: the guard reads only the `mainAgentOnly` flag the call carries (plan.md § Boundary rules).
- `chat-sessions.ts`, the `agentEvent(event)` handler in `processEvents` (near line 1241): when `isLiveEvent` holds and
  `event.type === 'toolStarted'`, call `deps.toolCallers.noteToolStarted(sessionId, event.toolUseId, event.agentId)`
  before the `deps.emit('agentEvent', …)` call. A replayed event (a re-attach) is noted too, so a call from a subagent
  that ran while the app was closed still reads as that subagent's.
- `start.ts`:
  - create `const toolCallers = createToolCallers(services.timers)` before `createChatSessions`, and pass it as
    `toolCallers`.
  - register `sessions.addToolCallGuard(callerGuard({ callers: toolCallers, owns: (sessionId) =>
    chat.hostSessionIdOf(sessionId) !== null }))`. Sessions' view files it, so the part's stop disposes it.
  - in the existing `sessions.ended` listener, call `toolCallers.forget(sessionId)`.
  - in `dispose`, call `toolCallers.stop()`.
- The order of the MCP call and the stream's `toolStarted` is not fixed. `claude-stream.md` says the assistant
  `tool_use` line prints before the tool runs, but nothing orders it against the MCP call, so an unseen id waits
  (design review).

GIVEN a row where `toolStarted` noted `t1` for agent `sub-1` WHEN `agentOf(row, 't1')` runs THEN it resolves `sub-1`
at once.
GIVEN no note for `t1` WHEN `agentOf(row, 't1')` runs and the note for `t1` and `sub-1` arrives before the timer fires
THEN it resolves `sub-1` and the timer is cleared.
GIVEN no note for `t1` WHEN `agentOf(row, 't1')` runs and the 2000 ms timer fires THEN it resolves null.
GIVEN a read that waits WHEN `forget(row)` runs THEN the read resolves null; and a later `agentOf(row, 't1')` for a pair
noted before the forget waits again.
GIVEN a note for `t1` in row `r1` WHEN `agentOf('r2', 't1')` runs THEN it waits and resolves null when the timer fires.
GIVEN a held row and a subagent's `toolStarted` for `t1` WHEN the subagent calls `set_workflow_step` with tool-use id
`t1` THEN the call succeeds with `Only the main agent's call changes this session, so this call changed nothing.` and
the step does not change.

Tests:
- `tool-callers.test.ts`, `it.each` `agentOf_$case`, with a fake `Timers` the test fires by hand (the shape of the
  `timers` fake in `chat/main/start.test.ts` near line 277). Rows: noted before the read → the agent id, no timer set;
  noted during the wait → the agent id, timer cleared; timer fires → null; forgotten during the wait → null, timer
  cleared; noted in another row → null when the timer fires; noted, forgotten, then read → waits, null; `stop` during
  the wait → null. Break caught: a note that does not wake a waiting read, a wait that never ends, a map shared across
  rows, a forget that leaves pairs or open reads.
- `tool-callers.test.ts`, `it.each` `callerGuard_$case`, with `agentOf` and `owns` faked. Rows: not main-agent-only →
  run, `agentOf` not asked; null tool-use id → run; a row chat does not own → run, `agentOf` not asked; agent
  `MAIN_AGENT_ID` → run; agent `sub-1` → skip with `SUBAGENT_CALL_TEXT`; `agentOf` resolves null → run. Break caught:
  a flipped check, a main-agent call skipped, a subagent's call run, an unowned session made to wait.
- `chat-sessions.test.ts`, new `agentEvent_ToolStarted_NotesItsAgentBeforeTheEmit`: a `toolStarted` with
  `toolUseId: 't1'` and `agentId: 'subagent-1'` gives one note `(ROW_ID, 't1', 'subagent-1')`, recorded before the
  `agentEvent` emit (the fake records both in one list). Break caught: the note dropped or made after listeners act.
  The `setUp` deps (near line 463) gain a `toolCallers` fake that records each note.
- `chat/main/start.test.ts`, new `toolCallGuard_SubagentCall_SkipsUntilTheRowEnds`: the fake sessions (near line 296)
  gain `addToolCallGuard`, which records the guard. Start a chat session, emit a subagent's `toolStarted` for `t1` from
  its process, and ask the recorded guard about `{ sessionId: <row>, tool: 'set_workflow_step', toolUseId: 't1',
  mainAgentOnly: true }`: the verdict is `skip` with `SUBAGENT_CALL_TEXT`. Then end the row (`sessions.ended`) and ask
  again under fake timers: the guard sets a `CALLER_WAIT_MS` timer, since the id is no longer known, and the verdict is
  `run` once the timer fires. Break caught: the guard not registered, the map not fed from the stream, the map not
  cleared at the row's end.

## Part B — worktrees touched through Bash

Decisions:
- The input field of a Bash tool call is `command` (verified at plan time: `src/main/claude-code/tool-summary.ts` maps
  `Bash: 'command'`, and `stream-decoder.ts` reads `.command` from a tool entry's input).
- `worktreesInCommand(command, roots)` returns the name of each root whose full path text appears in `command`, in the
  order of `roots`, each name once. A root counts at a position when the character after it is the end of the text or
  is not one of `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_` or `-`. So `/r/.worktrees/a` counts in `ls /r/.worktrees/a`,
  `cd /r/.worktrees/a && ls`, `"/r/.worktrees/a/src"` and `git -C /r/.worktrees/a log;`, and does not count in
  `/r/.worktrees/ab` or `/r/.worktrees/a.bak`. The character before the root is not checked. The name is the root's
  last segment (`path.basename`), which equals what `worktreeNameOf` gives for a root at `.worktrees/<name>`.
- The match is on the text as given: case-sensitive, with the separators `git worktree list` prints. A relative path
  (`cd .worktrees/a`) or a `~` path does not count.
- A read-only command counts (design review).
- A Bash touch lists any linked worktree root by its last segment, wherever the root sits; `fileWritten` lists only a
  path under `.worktrees/` or `.claude/worktrees/` (`worktreeNameOf`). The Bash match is the broader one on purpose: it
  reads git's own worktree list, so a root outside those folders is still a worktree.
- `chat-sessions.ts`, `HeldSession` gains `worktreeRoots: readonly string[]` (starts `[]`) and `worktreeReads: number`
  (starts 0, numbers the reads as `branchReads` does), and `bashCommands: string[]` (starts `[]`), the `command` of each
  Bash entry the row has seen, each text once.
- New `readWorktreeRoots(session)` in `chat-sessions.ts`, called at each place `readBranch(session)` is called today:
  once in the row's open (near line 1454) and at each live turn end that is not a replay (near line 1264). It reads
  `deps.git.topLevel(projectDir)`. For null it sets the roots to `[]`. Otherwise it reads `deps.git.worktrees(top)` and
  keeps the `path` of each worktree whose `isMain` is false. Only the latest read applies. A read that settles after the
  row closed or after `detachAll` changes nothing. A rejection logs `worktrees not read in <folder name>: <error text>`
  and keeps the roots it had. When a read applies, match every text in `bashCommands` against the new roots and call
  `addWorktree` for each name. So a Bash entry that arrived before a read settled (a fresh row's first entries, or the
  entries a re-attach replays) still lists its worktree once the roots land.
- `noteWorktree(session, filePath)` splits: a new `addWorktree(session, name)` holds today's add (no duplicate, order of
  first touch, `setInfo({ worktrees })`). `noteWorktree` calls it with `worktreeNameOf(filePath)` when not null.
- The `entry(entry)` handler in `processEvents` (near line 1187): when `isLive(session, processStart)` holds,
  `entry.kind === 'tool'`, `entry.name === 'Bash'` and `entry.input` holds a string `command`, push `command` to
  `bashCommands` when it is not there yet, and call `addWorktree` for each name
  `worktreesInCommand(command, session.worktreeRoots)` returns. Every agent's Bash call counts, as every
  agent's `fileWritten` does. A tool entry put again (its result landing) adds nothing new, since a listed name is not
  added twice.
- A worktree made mid-turn joins the roots in the same turn: when a Bash entry arrives with `entry.result !== null`,
  `command.includes('worktree')` (case-sensitive) and no replay running (`!replay.isReplaying`, the same rule as the
  turn-end read), call `readWorktreeRoots(session)`. A later put of the same entry reads again; that costs one git call
  and changes nothing. `wigley:make` lead turns run for hours
  and add worktrees inside one turn, so a read only at turn end misses every command of that turn. The command that
  makes a worktree and names it in the same text is not matched; the commands after its result are.
- `chat/contract.ts`, the comment on `worktrees` (today: `The git worktrees the session's agents wrote files in …`):
  say the session's agents wrote files in them or named their root in a Bash command; reword "first write" to "first
  touch" and "until a write lands in one" to "until one is touched".
- Test fakes for `ChatSessionsDeps['git']` gain `worktrees`: `NO_CLONE` (near line 333) and `cloneGit` (near line 3566)
  in `chat-sessions.test.ts` return `[]`. The `git` fake in `chat/main/start.test.ts` (near line 1055) is cast
  `as never`; add `worktrees: () => Promise.resolve([])` so the read does not log a failure.

GIVEN roots `['/repos/.worktrees/fix']` from a git whose top is `/repos/clone` and whose worktrees are the main tree
`/repos/clone` and `/repos/.worktrees/fix` WHEN a Bash entry with command `ls /repos/.worktrees/fix` arrives THEN the
row's `worktrees` is `['fix']`.
GIVEN the same row WHEN a Bash entry `ls /repos/clone` arrives, and a `Read` entry whose input names
`/repos/.worktrees/fix` THEN neither adds a name.
GIVEN a row whose git lists no linked worktree at open WHEN a worktree `/repos/.worktrees/late` is added, a turn ends,
and then a Bash entry names it THEN the row's `worktrees` is `['late']`.
GIVEN the same row, with no turn end WHEN a Bash entry `git worktree add /repos/.worktrees/late` is put with its result,
the roots read settles, and then a Bash entry `ls /repos/.worktrees/late` arrives THEN the row's `worktrees` is
`['late']`.

Tests:
- `worktree-name.test.ts`, new `it.each` `worktreesInCommand_$case`, rows as `{ command, roots, expected }`:
  `ls /r/.worktrees/a` → `['a']`; `cd /r/.worktrees/a && git status` → `['a']`; `cat "/r/.worktrees/a/src/x.ts"` →
  `['a']`; `git -C /r/.worktrees/a log;` → `['a']`; `ls /r/.worktrees/ab` with root `/r/.worktrees/a` → `[]`;
  `ls /r/.worktrees/a.bak` → `[]`; a command naming `/r/.worktrees/b` and then `/r/.worktrees/a`, roots `a` then `b` →
  `['a', 'b']`; root `/u/dev/feature-x` outside any `.worktrees` folder named → `['feature-x']`; a command naming a
  root twice → one name; no root named → `[]`; empty roots → `[]`. Break caught: a prefix match that takes a longer
  name, a boundary that drops a quoted or slash-followed path, duplicate names, the wrong segment as the name.
- `chat-sessions.test.ts`, new `bashEntry_NamesALinkedWorktreeRoot_ListsIt`, beside
  `fileWritten_InWorktrees_ListsEachWorktreeOnceInWriteOrder`: the git fake from the first GIVEN; put the Bash entry
  for `/repos/.worktrees/fix`, a Bash entry for `/repos/clone`, and a `Read` entry naming the fix path; expect
  `worktrees` `['fix']`. Break caught: the main tree kept, a non-Bash entry matched, the roots never read.
- `chat-sessions.test.ts`, new `agentEvent_TurnEnded_ReadsTheWorktreeRootsAgain`, in `describe('createChatSessions
  branch')`: the third GIVEN. Break caught: the roots read only at open.
- `chat-sessions.test.ts`, new `bashWorktreeCommand_ResultLands_ReadsTheWorktreeRootsAgain`, beside it: the fourth
  GIVEN. Break caught: the roots read only at turn end, so a make lead turn's worktrees never list.
- `chat-sessions.test.ts`, new `it.each` `bashEntry_$case_ListsNothing` rows: an entry whose `input` is null; an
  entry whose `command` is a number; the fix entry put twice (lists `['fix']` once). Break caught: a throw on a
  non-string command, a duplicate name.
- `chat-sessions.test.ts`, new `bashEntry_BeforeTheRootsRead_ListsOnceTheReadLands`: a git fake whose `worktrees`
  resolves only when the test lets it; put the fix Bash entry first, then let the read settle; expect `['fix']`. Break
  caught: early and replayed Bash entries matched only against `[]`.
- `chat-sessions.test.ts`, the existing stale-read table beside `branchRead_StaleRead_ChangesNothing`: add a row where
  the roots read settles after the row closed; it adds no name. Break caught: a late read applied to a closed row.
- `chat-sessions.test.ts`, the existing `branchRead_$case` table: add a row `worktrees rejects` whose git has a top and
  whose `worktrees` rejects with `git did not start`; it logs `worktrees not read in app: git did not start` and the
  branch row still lands. Break caught: a worktree read failure that blocks the branch read, or an unhandled rejection.

Done when: the code compiles; the test gate runs the tests above. The live checks are task 10's check 4, "A
subagent's step report changes nothing", and check 6, "The Worktrees fact catches a Bash touch".
Commit:    one commit for the group

## Proof

Commit 4b3f3339 · proof: diff read; Produces present (createToolCallers, callerGuard, worktreesInCommand, guard wired in start.ts); chat tests 46 files 1454 passed; full typecheck/lint held for 06's in-progress heavy files · concerns: doc sentence on the worktree-add command not matching is untrue: the post-result roots read re-matches that command, so the new worktree lists from the add itself; stale-read row is a timeline check; startChatPart fixture has no services.git, so open-time reads log rejections
