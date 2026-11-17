# 17 — Auto-retro claims restored rows

Status: not started
Type: Batch
Rung: hard · the claim rule and the done watch change together in a serial event chain where emit-time capture matters
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups:
- **A restored retro row the queue lost stays unclaimed and open** (`followups.md` L765).
- **The lost-retro log's emit-time capture has an untested second path** (`followups.md` L784).

Files:     modify `src/plugins/auto-retro/main/start.ts` · modify `src/plugins/auto-retro/main/retro-queue.ts` ·
           test `src/plugins/auto-retro/main/start.test.ts` · modify `docs/features/auto-retro/design.md`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "queue.launched.includes(row.hostSessionId)" src/plugins/auto-retro/main/start.ts` → one line, in
  `begin`'s `followRows` `added`: a row joins only when `launched` holds its host id.
- `grep -n "^function opensWithRetroCommand" src/plugins/auto-retro/main/retro-queue.ts` → one line, not exported.
- `grep -n "if (rowId !== runningRowId())" src/plugins/auto-retro/main/start.ts` → two lines (`checkDone` and the
  `sessionSlot.on` handler): only the running row is watched for done.
- `grep -n "let settle:" src/plugins/auto-retro/main/start.ts` → one line: one settle wait at a time.
- `grep -n -A10 "function endClosed" src/plugins/chat/main/chat-sessions.ts` → a non-running session calls
  `session.owned.end()` synchronously; `followRows`' `removed` (`src/plugins/sessions/contract.ts`) runs
  synchronously on the row's delete, so `leaveRow` can clear the settle wait before the chained `closed` step runs.
- `grep -n "stays open until the" docs/features/auto-retro/design.md` → one line, in § Decisions' "A retro row is known
  by its first message too".

Consumes: `SessionRow.titles` (`src/plugins/sessions/contract.ts`), `RETRO_COMMAND` — in the tree.

Produces: `export function opensWithRetroCommand(titles: SessionTitles): boolean` in
`src/plugins/auto-retro/main/retro-queue.ts` (exported, body unchanged).

Decisions:
- **The claim rule.** `begin`'s `added` claims a row when its host id is in `queue.launched` *or*
  `opensWithRetroCommand(row.titles)`. Both join the Retro section, count as started (`startedRows`), and are checked
  for done at once. A first-message claim leaves `queue.json` as it is: the first message already marks the row at
  every start, and a queue file that failed to load is not written that run.
- **Every claimed row is watched for done, not only the running one.** The single `settle` becomes
  `const settles = new Map<string, number>()` (row id → timer). `checkDone`'s and the `sessionSlot.on` handler's guard
  `rowId !== runningRowId()` becomes `!rows.includes(rowId)`. `clearSettle(rowId)`, `closeIfStillDone(rowId)` (deletes
  its own entry first) and `leaveRow` work per row. Reason: a lost row is not `queue.running`, so the running-row guard
  would never close it; and a launched row whose close failed is better closed on its next done read too.
  `runningRowId` then has no reader (`closed` reads `queue.running` directly): remove it.
- **The emit-time capture**: `api.events.on('chat.sessionClosed', …)` reads `const isSettling =
  settles.has(event.sessionId)` at emit, as today's `settle?.rowId === event.sessionId` does. Its comment names both
  paths that clear the wait before the step: chat deleting the row's `chat.session` entry right after the emit, and
  `endClosed` ending a non-running session synchronously, which drops the sessions row and reaches `leaveRow`.
- **No retro queued for a lost row's close**: `afterClose` already skips a row whose first message opens with
  `RETRO_COMMAND`; a `finished` close is not a user close either. No change in `nextQueue`.
- **One `isStringArray`** (L537, whose other copies `plan-followups-now` task 16 removed): `retro-queue.ts`'s local
  `function isStringArray` (near line 196) is deleted, and its readers import `isStringArray` from
  `src/shared/json.ts` (same signature). Find it with `grep -n "^function isStringArray" src/plugins/auto-retro/main/retro-queue.ts`.
- **design.md.** § The Retro section's "which claims the rows it launched" becomes "which claims the rows it launched
  and every row whose first message is a retro command". § Decisions' "A retro row is known by its first message too"
  ends "…that row's close would then queue a retro of a retro session. Such a row is claimed into Retro at start and
  closed once it reads done, as a launched one is." in place of "Such a row still shows as an ordinary row and stays
  open until the user closes it."

GIVEN a restored row whose first message is `/wigley:retro auto h1` and an empty queue WHEN the part starts THEN the
row is in `auto-retro.state`'s `rows`; WHEN it then reads done for `settleSeconds` THEN chat's `close(row, 'finished')`
is called; WHEN it closes THEN no retro is queued.
GIVEN the running retro row in its settle wait WHEN its close is emitted and, in the same synchronous run, its
`chat.session` entry and its sessions row are both deleted THEN no `closed before done` line is logged.

Tests (in `start.test.ts`):
New titles are sentences (`typescript-vitest.md` § Naming); the existing table keeps its title form.
- `'claims a restored retro row the queue lost and closes it once done'`: start with `queue.json` unreadable (write `{` to `QUEUE_PATH`
  before `restart`, as `unreadableQueueFile_IsNeverOverwritten` does) and a row `retro-9` (host `retro-host-9`) whose
  `titles.firstMessage` is `'/wigley:retro auto h1'` (build it with `sessionRow` and `titles`); after `restart` and
  `settled()`, `state().rows` is `['retro-9']`; set its session idle, advance `SETTLE_MS` → `closes` is
  `[['retro-9', 'finished']]`; `part.close('retro-host-9', 'finished')` → `launches` is `[]`.
- `'leaves a restored row that is not a retro unclaimed'`: same start with a row whose first message is `'hi'` → `state().rows` is `[]`.
- `sessionClosed_RunningRowClosed_LogsTheLostRetroOnlyBeforeDone` (existing table) gains a `rowDropped` column (false
  on the four existing rows, which run as today) and a fifth row `{ reason: 'user', inSettle: true, rowDropped: true,
  logsLostRetro: false }`: after the emit and `part.sessions.delete('retro-1')`, it also runs
  `part.rows.delete('retro-1')` before `settled()`. The title gains `, row dropped: $rowDropped` before the arrow.

Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/auto-retro/main/start.test.ts` and
`retro-queue.test.ts` green; `npm run lint` clean.

Commit: one commit for the group, e.g. "Auto-retro claims and closes a retro row the queue lost; test the row-drop
path of the lost-retro capture (follow-ups: restored retro row unclaimed, lost-retro second path untested)"
