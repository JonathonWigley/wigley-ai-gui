# 01 — Working turn input

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` ·
           create `src/plugins/chat/page/working-turn.ts` · test `src/plugins/chat/page/working-turn.test.ts`
Consumes:  `StepEntry`, `isStep` in `src/plugins/chat/page/activity-runs.ts` (already in the tree)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`:
           `export type WorkingState = 'thinking' | 'writing' | 'working' | 'waiting';`
           `export interface WorkingInput { state: WorkingState; steps: StepInput[]; startedAt: number; now: number; }`
           `working?(parent: HTMLElement, input: WorkingInput, kit: BaseKit): PartView<WorkingInput>;` on `ChatLayout`
           in `src/plugins/chat/page/working-turn.ts`:
           `export function workingInput(entries: readonly ChatEntry[], now: number): WorkingInput`
Decisions: one block per turn (round 1) · four states (round 1) · input carries every step; the layout filters
           (design review) · time starts at the turn's user entry (Decided)

The `working` part's comment in `layout.d.ts` says: the running turn, drawn into a slot after the last entry while
the session works; the app sends the input again on each change and once a second with a new `now`; the slot is not
a cursor stop. Each `WorkingInput` field gets a one-line comment, as `ActivityInput`'s fields have.

`PART_SET` in `read-chat-layout.ts` gets `working: true`. The `Record<ChatPartName, true>` type then compiles.

The rule in `workingInput`:

1. The **turn** is the entries from the last `user` entry to the end, that entry included. With no `user` entry, the
   turn is every entry.
2. `startedAt` is the turn's first entry's `at`. With no entries, it is `now`.
3. `steps` is every step entry of the turn (`isStep`), in entry order.
4. `state` is the first that holds, in this order:
   - `waiting` — a `permission` entry in the turn has `answer === null`
   - `working` — a `tool` entry in the turn has `result === null`
   - `writing` — the turn's last entry is an `assistant` entry with `streaming === true`
   - `thinking` — every other case

GIVEN a turn whose tool has no result and whose permission is unanswered WHEN `workingInput` runs THEN `state` is
`waiting`.
GIVEN entries `user@100, tool(done)@110, assistant(streaming)@120` WHEN `workingInput(entries, 200)` runs THEN
`state` is `writing`, `startedAt` is 100, `steps` holds the tool only.

Tests:     `working-turn.test.ts`, one `it.each` table over the state rule, rows:
           unanswered permission and running tool → `waiting` · running tool only → `working` ·
           last entry streaming assistant → `writing` · streaming thinking last → `thinking` ·
           last entry finished assistant → `thinking` · only the user entry → `thinking` ·
           a running tool before the last `user` entry (an earlier turn) → not `working`.
           One `it.each` table over the turn bounds, rows: two turns → `startedAt` and `steps` from the second
           only · no `user` entry → first entry's `at`, every step · no entries → `startedAt` is `now`, no steps.
           Build entries with a spec helper like `activity-runs.test.ts`'s.
Done when: compiles (`npx tsc --noEmit` through `npm test`'s typecheck); the tests above pass
Commit:    one commit for the group

## Proof
