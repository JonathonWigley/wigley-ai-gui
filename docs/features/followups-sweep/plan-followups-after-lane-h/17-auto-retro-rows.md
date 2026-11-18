# 17 — Auto-retro claims restored rows

Status: not started
Type: Batch
Rung: deep · the settle wait becomes per-row state cleared on three paths, across chat's synchronous close and the serial event chain
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
- **A lost row counts as started, as a restored launched row does.** It is claimed through the same `added` path, so
  a lost row resting idle at start closes `finished` after `settleSeconds`, though its retro may never have run.
  This accepts, for lost rows, the harm `followups.md` L750 ("A restored retro row resting idle reads done", *needs a
  feature plan*) records for launched ones; L750's fix then covers both. Reason: the follow-up's bug is a lost row
  that stays open, and waiting for a turn this run would leave a lost row whose retro finished before the restart
  open for good, since nothing relaunches it.
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
  `[['retro-9', 'finished']]` (the restored-idle case: no turn this run); then emit a user close of it,
  `part.harness.emit('chat.sessionClosed', { ...closedEvent('retro-host-9', 'user'), sessionId: 'retro-9', titles: {
  user: null, agent: null, firstMessage: '/wigley:retro auto h1' } })` (`sent` stays true from `closedEvent`), and
  `await settled()` → `launches` is `[]`. A user close of a sent row queues a retro unless its first message is a retro
  command, so only that rule keeps `launches` empty.
- `'leaves a restored row that is not a retro unclaimed'`: same start with a row whose first message is `'hi'` → `state().rows` is `[]`.
- `'closes two claimed rows that settle together'`: same start as the first test (lost row `retro-9`); after `restart`
  and `settled()`, set `retro-9`'s session idle; `await part.close('h1')` launches `retro-1`; `await
  part.startedThenIdle('retro-1')`; advance `SETTLE_MS` → `closes`, sorted, is `[['retro-1', 'finished'], ['retro-9',
  'finished']]`.
- `'keeps one claimed row settling when another reads not done'`: same steps up to both rows idle, then
  `part.sessions.set('retro-1', sessionInfo('retro-1', 'working'))`; advance `SETTLE_MS` → `closes` is `[['retro-9',
  'finished']]`. It fails if `checkDone` clears every row's wait rather than its own.
- `sessionClosed_RunningRowClosed_LogsTheLostRetroOnlyBeforeDone` (existing table) gains a `rowDropped` column (false
  on the four existing rows, which run as today) and a fifth row `{ reason: 'user', inSettle: true, rowDropped: true,
  logsLostRetro: false }`: after the emit it runs `part.rows.delete('retro-1')` in place of
  `part.sessions.delete('retro-1')` (the sessions delete becomes `if (!rowDropped)`), before `settled()`. The sessions
  delete alone already clears the wait through `checkDone(undefined)`, so leaving it out makes `leaveRow` the only path
  that clears it before the step: the row fails if the emit-time capture is removed. The title gains
  `, row dropped: $rowDropped` before the arrow.

Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/auto-retro/main/start.test.ts` and
`retro-queue.test.ts` green; `npm run lint` clean.

Commit: one commit for the group, e.g. "Auto-retro claims and closes a retro row the queue lost; test the row-drop
path of the lost-retro capture (follow-ups: restored retro row unclaimed, lost-retro second path untested)"
