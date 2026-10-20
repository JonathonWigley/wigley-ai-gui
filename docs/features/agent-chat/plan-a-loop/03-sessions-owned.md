# 03 — Sessions main: owned sessions, mark, closed

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts`
           · test `src/plugins/sessions/main/session-list.test.ts` · modify `src/plugins/sessions/main/start.ts`
           · modify `src/plugins/forms/main/channel-presenter.ts` · test `src/plugins/forms/main/channel-presenter.test.ts`
           · modify `src/plugins/forms/main/preview/preview-round.ts` (two sample strings)
Consumes:  members the tree holds: `createSessionList` and its private `SessionEntry`, `startToolSessions`,
           `routeCall`, `end`, `removeRow`, `select`, `knownRow` (`session-list.ts`); `SessionInfo`, `AgentSession`,
           `ConnectedSession`, `SessionsMainEvents` (`contract.ts`); `RandomHex` (`src/contracts/ambient.ts`)
Produces:  `src/plugins/sessions/contract.ts`:
             `export interface OwnedSession { session: AgentSession; end(): void }`
             `SessionsMainExports.open(info: SessionInfo): OwnedSession`
             `SessionsMainExports.mark(sessionId: string): void` (replaces `markRound`)
             `SessionsMainExports.selectedSessionId(): string | null`
             `SessionsMainEvents.closed: { sessionId: string }`
           `src/plugins/sessions/main/session-list.ts`: `SessionList` (extends `SessionsMainExports`) implements the
           three members; `src/plugins/sessions/main/start.ts` passes them through in its `exports`
Decisions: owned sessions in `sessions` main, `markRound` becomes `mark` (design review; design.md Sessions and tabs)
           · **open(info)**: throws `open needs a host session id` when `info.sessionId` is null, and
             `` `Host session ${info.sessionId} is already open` `` when any entry, owned or connected, holds that host
             id — two processes on one transcript is never wanted. Otherwise it builds the entry as `connect` does (a
             fresh `randomHex` id, group and lowest free number, `startToolSessions` over the contributions so far —
             the tool sessions start at open, so chat's `permission_prompt` session exists before the relay joins),
             marks it owned, adds its row at the end **selected** and unmarked (the user just started it), sends the
             state once, and emits `connected` with the session. A throwing contribution start rethrows as in
             `connect`, leaving no entry, row, state send or event.
           · **Joining**: `connect(info)` whose `info.sessionId` is non-null and equals an owned entry's host id while
             no relay has joined it marks the entry joined, logs `` `relay joined session ${appId}` `` (source
             `sessions`), and returns a `ConnectedSession` whose `session` is the owned entry's `AgentSession` (same
             object), whose `call` routes through the owned entry's tool routes, and whose `end()` only clears the
             joined mark and logs `` `relay left session ${appId}` `` — no tool session ends, no row changes, no state
             send, no event. It starts no tool session, adds no row, sends no state and emits no `connected`. An
             `end()` after the owned session ended does nothing and logs nothing. After a relay leaves, the next relay
             with that host id joins again.
           · **Second relay while joined**: `connect` with a joined owned entry's host id is a connected session of
             its own, as today (own id, row, tool sessions, `connected`), and logs `` `relay for host session
             ${hostId} connected while one is joined; added as session ${newAppId}` `` before it returns. A relay
             whose host id matches a connected (not owned) entry adds a row as today, unlogged.
           · **OwnedSession.end()**: the private `end(entry)` as today — ends the entry's tool sessions, removes the
             row if present (sending the state), emits `ended`; a second call does nothing.
           · **closed**: `closeSession(sessionId)`, once every guard allows it and the row is removed and the state
             sent, emits `closed` with `{ sessionId }` for any row, owned or connected. The entry stays: a connected
             session stays connected and a closed row still comes back on `mark`, as today; an owned entry stays
             until its owner calls `end()` (chat ends the process on `closed`, task 07). A close a guard keeps, or a
             close of an unknown session or one with no row, emits nothing.
           · **mark**: `markRound` renamed at every site — the contract member and its comment ("Attention for the
             session: selects its row when none is selected, else marks it; a row the user closed comes back at the
             end first."), `session-list.ts` (member, header comment), `main/start.ts`, `channel-presenter.ts`,
             `channel-presenter.test.ts`, and the two sample strings in `preview-round.ts`
             (`` before `mark` runs ``, `` `mark for session … with no row ignored` ``). Behaviour is identical; the
             unknown-session log line becomes `` `mark for unknown session ${sessionId} ignored` ``. Sites measured
             at plan time, re-verify: `grep -rn "markRound" src | wc -l` → 32, 8 outside tests.
           · **selectedSessionId()** returns the list's `selectedSessionId` at the call.
           · Comments kept true: `connect`'s contract comment adds "or joins the owned session whose host id the info
             carries, adding no row"; `addCloseGuard`'s says the close then emits `closed`; `session-list.ts`'s
             header comment names owned sessions (row selected at open, joined by their relay, ended by `end()`).
           · `channel-presenter.test.ts`'s `fakeSessions` implements the new members: `open` throws `'the presenter
             opened a session'`, `selectedSessionId` throws `'the presenter read the selected session'`, `mark`
             records `` `mark ${sessionId}` ``.
GIVEN no session WHEN `open` runs with host id `host-1` and project `/work/x` THEN one row `x`, selected, unmarked,
      `hostSessionId: 'host-1'`, and `connected` emitted
GIVEN an owned session `host-1` WHEN a relay says hello with `host-1` THEN no second row, no new tool session, and
      calls reach the owned session's tool sessions; WHEN that relay goes THEN the row and tool sessions stay
GIVEN a joined owned session WHEN a second relay says hello with its host id THEN it gets a row of its own, logged
GIVEN an owned session WHEN its `end()` runs THEN its tool sessions end, its row goes and `ended` is emitted
GIVEN any row WHEN the user closes it and every guard allows THEN `closed` is emitted after the state is sent
Tests:     in `src/plugins/sessions/main/session-list.test.ts`, with a helper `owned(hostId, projectDir = '/work/x')`
           returning `{ sessionId: hostId, projectDir, deadlineSeconds: null, harness: 'claude' }`, and `setUp`'s
           `emit` also pushing `` `emit ${event}` `` into `calls`:
           `opens an owned session with a selected row and emits connected` — `list.open(owned('host-1'))`:
             `session.id` `'00000001'`; `list.state()` equals `{ rows: [{ sessionId: '00000001', label: 'x', harness:
             'claude', marked: false, projectDir: '/work/x', hostSessionId: 'host-1' }], selectedSessionId:
             '00000001' }`; `states` has length 1; `emitted` equals `[['connected', { id: '00000001', info:
             owned('host-1') }]]`
           `selects the opened row over the selected one` — connect `/work/x`, `mark` it (selected), `open(owned('h'))`:
             `selectedSessionId` `'00000002'`, labels `['x', 'x 2']`, marks `[false, false]`
           `starts the contributed tool sessions when an owned session opens` — one contribution; after `open`,
             `started` equals `[owned.session]` with no `connect` called
           `throws opening a session with no host id` — `open({ ...owned('h'), sessionId: null })` throws `'open needs
             a host session id'`; `states` and `emitted` stay `[]`
           `throws opening a host id already open, owned or connected` — after `open(owned('host-1'))`, a second
             throws `'Host session host-1 is already open'`; after `connect(owned('host-2'))`, `open(owned('host-2'))`
             throws `'Host session host-2 is already open'`; rows stay 2
           `joins an owned session when its relay connects, adding no row` — contribution, `open(owned('host-1'))`,
             then `connect(owned('host-1'))`: `connected.session` is (`toBe`) `owned.session`; rows length 1;
             `started` length 1; `states` length unchanged; `emitted` holds one `connected`; `logged` equals
             `['[sessions] relay joined session 00000001']`
           `routes a joined relay's calls to the owned session's tool sessions` — `await connected.call('a', { v: 1 },
             context)` resolves to `RESULT`; the contribution's `calls` equals `[{ name: 'a', args: { v: 1 }, context }]`
           `leaves the owned session and its row when its relay ends, and lets the next relay join` — `connected.end()`:
             `ends()` 0, rows length 1, no `ended` in `emitted`, `logged` ends with `'[sessions] relay left session
             00000001'`; a new `connect(owned('host-1'))` returns `session` `toBe` `owned.session`, rows still 1
           `connects a second relay for a joined host id as a session of its own` — open, join, then a second
             `connect(owned('host-1'))`: its `session.id` `'00000002'`, labels `['x', 'x 2']`, `started` length 2,
             `logged` contains `'[sessions] relay for host session host-1 connected while one is joined; added as
             session 00000002'`
           `ends an owned session: its tool sessions, its row and an ended event` — two contributions, open, join,
             `owned.end()`: each `ends()` 1, `list.state()` equals `{ rows: [], selectedSessionId: null }`,
             `emitted.at(-1)` equals `['ended', { sessionId: '00000001' }]`; then `owned.end()` and the relay's
             `end()` change neither `states`, `emitted` nor `logged` lengths, and `ends()` stay 1
           `emits closed after the state when the user closes a row every guard allows` — open `host-1`, connect
             `/work/y`; `closeSession('00000001')` returns `true` and `calls` ends `['stateChanged', 'emit closed']`;
             `emitted.at(-1)` equals `['closed', { sessionId: '00000001' }]`; the owned tool session's `ends()` is 0;
             `closeSession('00000002')` emits `['closed', { sessionId: '00000002' }]`; `mark('00000001')` brings the
             owned row back (rows `['00000001']` by id)
           `emits no closed for a row a guard keeps or a row already gone` — a guard returning false: `closeSession`
             returns false, no `closed` in `emitted`; with the guard allowing, close it, then `closeSession` again
             returns false and `emitted` holds exactly one `closed`
           `reads the selected session id` — `selectedSessionId()` is `null` at start, `'00000001'` after `open`,
             `'00000002'` after `connect` and `activate('00000002')`
           renamed, same assertions: every `markRound` call in the file becomes `mark`; in `ignores unknown sessions
             and rows it does not hold, with a log line` the first expected line becomes `'[sessions] mark for unknown
             session ffffffff ignored'`; the test names keep their wording (`selects the round's row when none is
             selected and marks a later one`, etc.)
           in `src/plugins/forms/main/channel-presenter.test.ts`: `shows a round on the page and announces it without
             showing the window` and `shows a quiet round on the page and its row without an alert or a count` expect
             `calls` to equal `['mark app-1', 'send roundShown']`
Done when: compiles; `grep -rn "markRound" src` → empty; the test gate runs the tests above
Commit:    one commit for the group

## Proof

22c3c42 · diff read: `OwnedSession`, `open`, `mark`, `selectedSessionId`, `closed` present in contract, `session-list.ts` and `start.ts`; `grep -rn markRound src` empty; typecheck and lint pass. Rulings: each joined relay's `end()` has its own once-flag; `connect`/`open` share `addEntry`. Concern: the `closed` test sets no guard (none set means every guard allows).
