# 02 — Turn tracker

Status: not started
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
           `export interface TurnTracker { written(uuid, command); read(line: TurnLine): TurnRead; interruptAnswered(): void; activity(): ProcessActivity; }`
           `export function createTurnTracker(): TurnTracker`
Decisions: uuid tracking (round 1) · Claude's own turns show working (round 1) · a deep pure module, no I/O and no
           clock (Decided) · fallback rule and plain-interrupt recovery (Decided)

## Rules

The tracker holds: an open-turn flag; the open uuids in write order, each with its command (a `Map` keeps the order);
the mode, `unknown` until the first line with `turnStarted`, then `lifecycle` or `fallback`.

- `written(uuid, command)` opens `uuid` with `command`.
- `read(line)`, applied in this order:
  1. `turnStarted`: open the turn. When the mode is `unknown`, set it to `lifecycle` if `capabilities` includes
     `msg_lifecycle_v1`, else `fallback`; `fellBack` is true only on the read that set `fallback`.
  2. `lifecycle` with a state in `completed`, `cancelled`, `discarded`, `refused`: close its uuid. Any other state,
     and a uuid that is not open, change nothing.
  3. `turnEnded`: close the turn, and:
     - mode `lifecycle`: `command` is the command of the open uuid `turnOpener` names, or null; then close
       `turnOpener` and every uuid in `turnMessages`.
     - mode `fallback` or `unknown`: `command` is the oldest open uuid's command when `turnUnrequested` is false, else
       null; then close every open uuid.
  4. Every other read returns `{ command: null, fellBack: false }` (with `fellBack` per step 1).
- `interruptAnswered()`: when no turn is open, close every open uuid; when a turn is open, change nothing.
- `activity()`: `'working'` while the turn is open or any uuid is open; `'idle'` otherwise.

The module doc comment states these rules in a few lines, as the interface's contract (`wigley:codebase-design`
§ Breaking an interface). The constant set of terminal states and `msg_lifecycle_v1` are named constants.

## Scenarios

GIVEN lifecycle mode, uuid `b` open and its turn open WHEN `a` is written, then `a` gets `started` and `completed`, then
the result names `turnOpener` `b` and `turnMessages` `[b, a]` THEN activity stays working until that result and is idle
after it (the fold)
GIVEN lifecycle mode and an idle tracker WHEN `a` is written and an init comes with no lifecycle for `a` yet, then a
`task-notification` result with no uuid keys THEN activity is working until `a` gets `completed`, and idle after
GIVEN lifecycle mode and nothing written WHEN an init and later a result come THEN activity is working between them
and idle after (Claude's own turn)
GIVEN lifecycle mode, `a` (`/effort high`) and `b` written WHEN `a`'s turn ends with `turnOpener` `a` THEN read returns
`{ id: 'effort', value: 'high' }` and activity stays working for `b`
GIVEN fallback mode, `a` with a command written WHEN a result with `turnUnrequested` comes THEN read returns null and
activity is idle
GIVEN `a` written and no turn open WHEN `interruptAnswered` runs THEN activity is idle
GIVEN `a` written and a turn open WHEN `interruptAnswered` runs THEN activity stays working

Tests (`src/main/claude-code/turn-tracker.test.ts`; a small `line(overrides)` helper builds a `TurnLine` with every
field at its `emptyLine` value):

- `activity_LineSequence_FollowsTurnAndOpenUuids` — `it.each` over named sequences of steps (`written`, `read`,
  `interruptAnswered`), each row asserting the activity after every step. Rows:
  - the fold (lifecycle): `b` written, init, `a` written, `a` started, `a` completed, result `b` / `[b, a]`
  - Claude's own turn takes a written message (lifecycle): `a` written, init, `a` queued, `a` started, `a`
    completed, result with no uuid keys and `turnUnrequested`
  - Claude's own turn with nothing written (lifecycle): init, result `turnUnrequested`
  - two messages, each its own turn (lifecycle): `a`, `b` written, init, result `a` / `[a]`, init, result `b` / `[b]`
    — working until the second result
  - lifecycle `cancelled` closes a queued uuid with no result
  - lifecycle `queued` and an unknown state leave the uuid open
  - fallback: `a`, `b` written, init without capabilities, result — idle after the one result
  - unknown mode: `a` written, result with no init — idle after it
  - interrupt while no turn is open: `a` written, `interruptAnswered` — idle
  - interrupt while a turn is open: `a` written, init, `interruptAnswered` — working; then result — idle
- `read_TurnEnds_ReturnsTheCommandOfTheTurnItAnswers` — `it.each`, rows: lifecycle, opener with a command → that
  command; lifecycle, opener with null command → null; lifecycle, opener not ours → null; fallback, oldest has a
  command → it; fallback, `turnUnrequested` → null. Each row's command values differ (`effort`/`high`,
  `model`/`sonnet`).
- `read_FirstInit_FallsBackOnceWithoutLifecycleCapability` — `it.each`, rows: first init without `msg_lifecycle_v1`
  → `fellBack` true on that read and false on a second init; first init with it → false on both.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
