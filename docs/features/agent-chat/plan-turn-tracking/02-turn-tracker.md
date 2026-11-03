# 02 — Turn tracker

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/main/claude-code/turn-tracker.ts` · test `src/main/claude-code/turn-tracker.test.ts`
Consumes:  `DecodedLine` fields `turnStarted`, `capabilities`, `lifecycle`, `turnOpener`, `turnMessages` ← 01;
           `turnEnded`, `turnUnrequested` (already in the tree); `ProcessActivity` from `src/contracts/agent.ts`
Produces:  in `src/main/claude-code/turn-tracker.ts`, exactly as `plan.md` § File Structure writes them:
           `export interface ControlCommand { id: 'effort' | 'model'; value: string; }`
           `export type TurnLine = Pick<DecodedLine, 'turnStarted' | 'capabilities' | 'lifecycle' | 'turnEnded' | 'turnUnrequested' | 'turnOpener' | 'turnMessages'>`
           `export interface TurnRead { command: ControlCommand | null; fellBack: boolean; }`
           `export interface TurnTracker { written(uuid, command); read(line: TurnLine): TurnRead; interruptAnswered(): void; abandon(): void; activity(): ProcessActivity; }`
           `export function createTurnTracker(): TurnTracker`
Decisions: uuid tracking (round 1) · Claude's own turns show working (round 1) · a deep pure module, no I/O and no
           clock (Decided) · fallback rule and plain-interrupt recovery (Decided)

## Rules

The tracker holds: an open-turn flag; the open uuids in write order, each with its command (a `Map` keeps the order);
the mode, `unknown` until the first line with `turnStarted`, then `lifecycle` or `fallback`.

- `written(uuid, command)` opens `uuid` with `command`.
- `read(line)`, applied in this order:
  1. `turnStarted`: open the turn. When the mode is `unknown`, set it to `lifecycle` if `capabilities` includes
     `msg_lifecycle_v1`, else `fallback` (null and `[]` both mean fallback); `fellBack` is true only on the read that
     set `fallback`.
  2. `lifecycle` with a state in `completed`, `cancelled`, `discarded`, `refused`: close its uuid. Any other state,
     and a uuid that is not open, change nothing.
  3. `turnEnded`: close the turn, and:
     - mode `lifecycle`: `command` is the command of the open uuid `turnOpener` names, or null; then close
       `turnOpener` and every uuid in `turnMessages`.
     - mode `fallback` or `unknown`: `command` is the oldest open uuid's command when `turnUnrequested` is false, else
       null; then close every open uuid, on an unrequested result too. Today's rule (an unrequested result closes
       nothing) is the rule that stuck the session: chat main writes only while idle, so a message open across
       Claude's own turn has almost always folded into it, and one that did not opens a turn again with its own init.
  4. Every other read returns `{ command: null, fellBack: false }` (with `fellBack` per step 1).
- `interruptAnswered()`: when no turn is open, close every open uuid; when a turn is open, change nothing. Accepted
  edge: a message the CLI still holds between an interrupted turn's `result` and its own `init` is closed too, so the
  session shows idle for that gap until the init reopens the turn (chat main hands its held messages back on Ctrl+C,
  so it writes none in the gap). The module doc comment names this edge.
- `abandon()`: close the turn and every open uuid. The adapter calls it when the interrupt's grace runs out.
- `activity()`: `'working'` while the turn is open or any uuid is open; `'idle'` otherwise.

The tracker is correct whichever shape a turn Claude runs on its own takes (unmeasured with uuids): a result that
lists a folded uuid in `turnMessages` closes it, and one with no uuid keys leaves it to its `completed` frame.

The module doc comment states these rules in a few lines, as the interface's contract (`wigley:codebase-design`
§ Breaking an interface). The constant set of terminal states and `msg_lifecycle_v1` are named constants.

## Scenarios

GIVEN lifecycle mode, uuid `b` open and its turn open WHEN `a` is written, then `a` gets `started` and `completed`, then
the result names `turnOpener` `b` and `turnMessages` `[b, a]` THEN activity stays working until that result and is idle
after it (the fold)
GIVEN lifecycle mode and an idle tracker WHEN `a` is written and an init comes with no lifecycle for `a` yet, then a
`task-notification` result with no uuid keys THEN activity is working until `a` gets `completed`, and idle after
GIVEN `a` open and a turn open WHEN `abandon` runs THEN activity is idle
GIVEN lifecycle mode and nothing written WHEN an init and later a result come THEN activity is working between them
and idle after (Claude's own turn)
GIVEN lifecycle mode, `a` (`/effort high`) and `b` written WHEN `a`'s turn ends with `turnOpener` `a` THEN read returns
`{ id: 'effort', value: 'high' }` and activity stays working for `b`
GIVEN fallback mode, `a` with a command written WHEN a result with `turnUnrequested` comes THEN read returns null and
activity is idle
GIVEN `a` written and no turn open WHEN `interruptAnswered` runs THEN activity is idle
GIVEN `a` written and a turn open WHEN `interruptAnswered` runs THEN activity stays working

Tests (`src/main/claude-code/turn-tracker.test.ts`). Helpers: `line(overrides)` builds a `TurnLine` with every field
at its `emptyLine` value (`capabilities: null`); `lifecycleInit` is `line({ turnStarted: true, capabilities:
['msg_lifecycle_v1'] })`; `fallbackInit` is `line({ turnStarted: true, capabilities: [] })`. "Lifecycle" below means
the row's first init is `lifecycleInit`; "fallback" means `fallbackInit`.

- `activity_LineSequence_FollowsTurnAndOpenUuids` — `it.each` over named sequences of steps (`written`, `read`,
  `interruptAnswered`, `abandon`), each row asserting the activity after every step. Rows:
  - the fold (lifecycle): `b` written, init, `a` written, `a` started, `a` completed, result `b` / `[b, a]`
  - Claude's own turn, `completed` after its result (lifecycle): `a` written, init, `a` queued, result with no uuid
    keys and `turnUnrequested` → working; `a` started, `a` completed → idle
  - Claude's own turn, `completed` before its result (lifecycle): `a` written, init, `a` queued, `a` started, `a`
    completed, result with no uuid keys and `turnUnrequested` → idle after the result
  - Claude's own turn lists the folded uuid (lifecycle): `a` written, init, result with `turnOpener` null,
    `turnMessages` `[a]` and `turnUnrequested` → idle
  - Claude's own turn with nothing written (lifecycle): init, result `turnUnrequested`
  - two messages, each its own turn (lifecycle): `a`, `b` written, init, result `a` / `[a]`, init, result `b` / `[b]`
    — working until the second result
  - lifecycle `cancelled` closes a queued uuid with no result (lifecycle): init, result, `a` written, `a` queued,
    `a` cancelled → idle
  - lifecycle `queued` and an unknown state `paused` leave the uuid open (lifecycle)
  - fallback: `a`, `b` written, `fallbackInit`, result — idle after the one result
  - fallback, unrequested: `a` written, `fallbackInit`, result `turnUnrequested` — idle
  - unknown mode: `a` written, result with no init — idle after it
  - interrupt while no turn is open (lifecycle): init, result, `a` written, `interruptAnswered` — idle
  - interrupt while a turn is open (lifecycle): `a` written, init, `interruptAnswered` — working; then result
    `a` / `[a]` — idle
  - abandon (lifecycle): `a` written, init, `b` written, `abandon` — idle
- `read_TurnEnds_ReturnsTheCommandOfTheTurnItAnswers` — `it.each`, rows: lifecycle, opener with a command → that
  command; lifecycle, opener with null command → null; lifecycle, opener not ours → null; fallback, oldest has a
  command → it; fallback, `turnUnrequested` → null. Each row's command values differ (`effort`/`high`,
  `model`/`sonnet`).
- `read_FirstInit_FallsBackOnceWithoutLifecycleCapability` — `it.each`, rows: first init without `msg_lifecycle_v1`
  → `fellBack` true on that read and false on a second init; first init with it → false on both.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 0fd04bc9 · proof: diff read: ControlCommand, TurnLine, TurnRead, TurnTracker, createTurnTracker present as planned; typecheck passes · concerns: the explicit turnOpener close in lifecycle mode has no test that fails without it (every measured result lists the opener in turnMessages)
