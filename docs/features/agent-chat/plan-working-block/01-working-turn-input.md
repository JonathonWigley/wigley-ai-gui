# 01 — Working turn input

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` ·
           modify `src/plugins/chat/layouts/default/layout.js` (a stub part only) ·
           create `src/plugins/chat/page/working-turn.ts` · test `src/plugins/chat/page/working-turn.test.ts` ·
           test `src/plugins/chat/page/read-chat-layout.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
           (`SURFACE_PARTS` row only)
Consumes:  `StepEntry`, `isStep` in `src/plugins/chat/page/activity-runs.ts` (already in the tree)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`:
           `export type WorkingState = 'thinking' | 'writing' | 'working' | 'waiting';`
           `export interface WorkingInput { state: WorkingState; steps: StepInput[]; startedAt: number; now: number; }`
           `working?(parent: HTMLElement, input: WorkingInput, kit: BaseKit): PartView<WorkingInput>;` on `ChatLayout`
           in `src/plugins/chat/page/working-turn.ts`:
           `export function workingInput(entries: readonly ChatEntry[], now: number): WorkingInput`
           in `src/plugins/chat/layouts/default/layout.js`: a stub `working(parent, input, kit)` part
Decisions: one block per turn (round 1) · four states (round 1) · input carries every step; the layout filters
           (design review) · time starts at the turn's first entry (Decided; turn bounds from the cold read)

**Contract.** The `working` part's comment in `layout.d.ts` says: the running turn, drawn into a slot after the last
entry and before the pending rows while the session works; the app sends the input again on each change and once a
second with a new `now`; the slot is not a cursor stop. Each `WorkingInput` field gets a one-line comment, as
`ActivityInput`'s fields have. In the same file, update the `ActivityInput` comments that the default layout no longer
matches: `open` (the default layout draws its summary line whether open or not; the app places the step rows under
it) and `live` (the default layout draws a live run as its summary line).

**Compile stays green.** `layout.js` is typed `CompleteChatLayout`, so adding `working?` requires a `working` part
there. Add a stub: it appends an empty `div.chat-working` and returns `{ element, update() {} }`, with a one-line
comment that task 02 of this plan replaces it. Add `working: true` to `SURFACE_PARTS` in `layout.test.ts`.
`PART_SET` in `read-chat-layout.ts` gets `working: true`. In `read-chat-layout.test.ts`, add a `working` row to the
accepted-part table and to the malformed-part table, the same as the `activity` rows
(`error: 'working is not a function'`).

**The rule in `workingInput`:**

1. The **turn** starts at the later of two entries: the last `user` entry, and the first entry after the last
   `result` entry. A turn Claude runs on its own (after a background task) has no `user` entry, so the second bound
   starts it. With neither bound, the turn is every entry.
2. `startedAt` is the turn's first entry's `at`. With no entries in the turn, it is `now`.
3. `steps` is every step entry of the turn (`isStep`: tool, thinking and raw), in entry order.
4. `now` is returned as passed.
5. `state` is the first that holds, in this order:
   - `waiting` — a `permission` entry in the turn has `answer === null`
   - `working` — a `tool` entry in the turn has `result === null`
   - `writing` — the turn's last entry is an `assistant` entry with `streaming === true`
   - `thinking` — every other case

GIVEN entries `user@100, tool(done)@110, assistant(streaming)@120` WHEN `workingInput(entries, 200)` runs THEN
`state` is `writing`, `startedAt` is 100, `steps` holds the tool only, `now` is 200.

Tests:     `working-turn.test.ts`. Build entries with a spec helper like `activity-runs.test.ts`'s.
           Table `state`, one row each, expected state literal:
           · unanswered permission and running tool → `waiting`
           · running tool only → `working`
           · last entry a streaming assistant → `writing`
           · last entry a streaming thinking → `thinking`
           · last entry a finished assistant → `thinking`
           · only the user entry → `thinking`
           · a running tool before the last `user` entry → `thinking`
           Table `bounds`, expected `startedAt` and step ids:
           · `user@100, tool:a@110, result@120, user@150, tool:b@160` → 150, `[b]`
           · `user@100, tool:a@110, result@120, tool:b@130, thinking:c@140` (a turn Claude started) → 130, `[b, c]`
           · `tool:a@100, raw:b@110` (no user, no result) → 100, `[a, b]`
           · `user@100, thinking:a@110, raw:b@115, tool:c@120` → 100, `[a, b, c]`
           · no entries, now 500 → 500, `[]`
           One row in either table asserts `now` comes back as passed.
Done when: `npm run typecheck` passes; `npm test` passes `working-turn.test.ts`, `read-chat-layout.test.ts` and
           `layout.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 955b4304 · proof: diff read: every Produces present; typecheck clean; worker ran the three tests 71/71 and lint · concerns: AGENTS.md's chat layout part list omits working (outside Files); ActivityInput open/live comments run ahead of layout.js until 02
