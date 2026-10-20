# 02 — Sessions main: a row for every connected session, harness, markRound

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/sessions/contract.ts`
- modify `src/plugins/sessions/main/session-list.ts` · test `src/plugins/sessions/main/session-list.test.ts`
- modify `src/plugins/sessions/main/start.ts`
- modify `src/plugins/sessions/main/relay/relay-server.ts` · test `src/plugins/sessions/main/relay/relay-server.test.ts`
- modify `src/plugins/forms/main/channel-presenter.ts` · test `src/plugins/forms/main/channel-presenter.test.ts`
- modify `src/plugins/forms/main/selftest-script.ts` (the `connect` info only) · test
  `src/plugins/forms/main/forms-service.test.ts` (the `SESSION` fixture only)
- modify, to keep the page compiling over the new state (no new behaviour): `src/plugins/sessions/page/start.ts`,
  `src/plugins/sessions/page/sessions-view.ts`, `src/plugins/sessions/page/tabs.ts` · test
  `src/plugins/sessions/page/tabs.test.ts`

Consumes: members already in the tree — `createSessionList`, `startRelayServer`, `createChannelPresenter`,
`SessionsMainExports.activate` / `addCloseGuard` / `connect` / `contributeTools`.

Produces (in `src/plugins/sessions/contract.ts` unless named):
```ts
export type Harness = 'claude' | 'codex';
export interface SessionInfo {
  sessionId: string | null;
  projectDir: string | null;
  deadlineSeconds: number | null;
  harness: Harness | null;
}
// On the wire; `harness` absent reads as null.
export interface RelayHello {
  protocol: number;
  session_id: string | null;
  project_dir: string | null;
  deadline_seconds: number | null;
  harness?: string | null;
}
export interface SessionRow {
  sessionId: string;
  label: string;
  harness: Harness | null;
  marked: boolean;
  projectDir: string | null;
  hostSessionId: string | null;
}
export interface SessionsState { rows: SessionRow[]; selectedSessionId: string | null; }
export interface SessionsMainExports {
  contributeTools(tools: ToolDefinition[], start: (session: AgentSession) => ToolSession): void;
  connect(info: SessionInfo): ConnectedSession;
  markRound(sessionId: string): void;
  activate(sessionId: string): void;
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}
export interface SessionsChannel extends ChannelShape {
  invoke: {
    state(): SessionsState;
    activate(sessionId: string): void;
    closeSession(sessionId: string): boolean;
  };
  messages: { stateChanged: SessionsState; activated: { sessionId: string } };
}
```
- `SessionTab` is deleted. `SessionList` (`session-list.ts`) keeps `tools()`, `state()`, and renames `closeTab` to
  `closeSession(sessionId: string): boolean`.
- `SessionListDeps` gains `activated(sessionId: string): void`.
- The page-side contract (`SessionView`, `SessionsPageExports` with `fill` / `activeSessionId` / `closeTab`,
  `SessionsPageEvents`) stays as it is; task 05 replaces it.

Decisions:
- **Row from connect.** `connect` appends a row (`marked: false`) and sends the state; it does not select the row.
  Selection changes only through `markRound` (when none is selected), `activate`, and a close or end of the selected
  row. So a round from a second session still lands selected when the first session sent no round, as today.
  (plan.md Decisions; the no-select choice is the drafter's, named in the report.)
- **markRound** replaces `showTab`. Every connected session has its row from `connect`, so the rule is on an
  existing row, checked in this order (lead's ruling):
  1. unknown session → log `markRound for unknown session <id> ignored`, nothing sent;
  2. the row is selected → nothing;
  3. no row is selected → select this row, unmarked, and send;
  4. the row is already marked → nothing;
  5. else mark it and send.
  One case leaves a connected session without a row: the user closed it (`closeSession`). Its `markRound` first
  appends the row at the end, unmarked, then runs steps 2–5, so the row comes back as design.md § Modes and layout
  says. (plan.md Decisions.)
- **activate** (`SessionsMainExports.activate` and the channel's `activate` share it): unknown session or no row →
  log `activate for unknown session <id> ignored` / `activate for session <id> with no row ignored`, nothing else.
  Otherwise call `deps.activated(sessionId)` first, then, when the row is not already selected and unmarked, select
  it, clear its mark and send the state. `start.ts` wires `activated` to `api.channel.send('activated',
  { sessionId })`, so the page hears `activated` before the `stateChanged` it causes: task 05 shows Sessions mode on
  `activated`, and a selection that arrives while Sessions is hidden without one becomes the round toast. A
  notification click is `activate`, so it shows Sessions mode. (plan.md Decisions: the notification-click exception;
  the message is the drafter's interface, named in the report.)
- **closeSession** is today's `closeTab` on rows: unknown session or no row → log `closeSession for unknown session
  <id> ignored` / `closeSession for session <id> with no row ignored`, return false; a refusing guard → log
  `closeSession for session <id> kept by a close guard`, return false; else remove the row (the right neighbour takes
  over a selected row, else the left), send, return true. The session stays connected; `markRound` brings the row
  back. The channel method is renamed `closeSession`.
- **Labels.** Grouping and numbering stay as today. A session with no project folder groups as `Codex session` when
  its harness is `codex`, else `session` as today: `groupOf(info)` reads both. (plan.md Decisions; design.md
  § Modes and layout, Harness.)
- **Row fields.** `projectDir` is `info.projectDir`, `hostSessionId` is `info.sessionId`, `harness` is
  `info.harness`, fixed at connect. They carry what task 05's `sessionAdded` event needs, since the page sees only
  the state. (Correction to plan.md's `SessionRow`, named in the report.)
- **Hello parse** (`relay-server.ts`): `harness` absent, `null`, `"claude"` or `"codex"` is accepted; any other string
  reads as `null`; any non-string, non-null value refuses the hello with
  `relay hello field harness has the wrong type`, as the other fields do. `isOptional(hello.harness, 'string')` is
  the type check; `sessionInfo` maps the value to `Harness | null`. (plan.md Decisions.)
- **Presenter** (`channel-presenter.ts`): `show` calls `sessions.markRound(round.sessionId)` where it calls
  `showTab` today; the announcement's click calls `markRound` when the round is still open, then `activate`, then
  `window.show()`, as today. Its comment says "row" for "tab".
- **Compile-only page edits.** The sessions page reads `state.rows` and `state.selectedSessionId` in place of `tabs`
  and `activeSessionId`, and invokes `closeSession` in place of `closeTab`; the tab strip keeps drawing one tab per
  row (a row with nothing filling it shows the idle text, as a tab did). `tabs.ts`'s `stepTab` / `showsEmptyText`
  read `rows` and `selectedSessionId`; `tabs.test.ts`'s `stateOf` builds rows (`harness: null`, `projectDir: null`,
  `hostSessionId: null`). The page ignores `activated`. Task 05 replaces this view.
- **Fixtures.** `selftest-script.ts`'s `connect` passes `harness: 'claude'`; `forms-service.test.ts`'s `SESSION`
  gains `harness: null`.

GIVEN two sessions connected and none selected WHEN the second's round arrives (`markRound`) THEN its row is selected
and unmarked, and the first row stays unmarked.
GIVEN session A selected WHEN B's round arrives THEN B's row is marked and A stays selected.
GIVEN B's row already marked, or B selected WHEN B's round arrives again THEN nothing is sent.
GIVEN the user closed B's row WHEN B's next round arrives THEN B's row comes back at the end and the rule above runs
on it.
GIVEN a hello with `harness: 3` WHEN it arrives THEN the app answers
`{ ok: false, error: 'relay hello field harness has the wrong type' }` and starts no session.

Tests:
- `session-list.test.ts` (rewrite the tab tests onto rows; `info(projectDir, harness = null)` builds
  `{ sessionId: null, projectDir, deadlineSeconds: null, harness }`; `setUp` records `activated` calls):
  - `adds an unselected, unmarked row for each connected session` — two connects on `/work/x` → state
    `{ rows: [{ sessionId: '00000001', label: 'x', harness: null, marked: false, projectDir: '/work/x',
    hostSessionId: null }, { …'00000002', label: 'x 2', … }], selectedSessionId: null }`, two states sent.
  - `labels a codex session with no project folder Codex session` — `info(null, 'codex')` twice → labels
    `Codex session`, `Codex session 2`; `info(null, 'claude')` → `session`.
  - `selects the round's row when none is selected and marks a later one` — connect A, B; `markRound(A)`,
    `markRound(B)` → A selected unmarked, B marked.
  - `sends nothing for the selected row or a row already marked` — connect A, B; `markRound(A)`, `markRound(B)`
    (A selected, B marked); then `markRound(A)` and `markRound(B)` send no state and change nothing.
  - `selects a row when the selected one closed and none is left selected` — connect A; `markRound(A)`;
    `closeSession(A)` (none selected); connect B; `markRound(B)` → B selected, unmarked.
  - `brings a closed row back at the end on its next round` — connect A, B; `markRound(A)`; `closeSession(B)`;
    `markRound(B)` → row order `[A, B]`, B marked.
  - `activates a row, clears its mark and reports activated first` — after `markRound(A)`, `markRound(B)`,
    `activate(B)` → `activated` calls `['00000002']` recorded before the state that selects B; B unmarked.
  - `reports activated for the selected row and sends nothing` — `activate(A)` on selected unmarked A →
    `activated` `['00000001']`, no state sent.
  - `moves to the right neighbour, else the left, when the selected row closes` — today's test on `closeSession`.
  - `keeps a row a close guard refuses, with a log line and false` — log
    `[sessions] closeSession for session 00000001 kept by a close guard`.
  - `ignores unknown sessions and rows it does not hold, with a log line` — logs
    `[sessions] markRound for unknown session ffffffff ignored`,
    `[sessions] activate for session 00000001 with no row ignored` (after closing its row),
    `[sessions] closeSession for session 00000001 with no row ignored`.
  - `drops the row and emits ended when a session ends` and `sends the whole state on every change` — today's
    tests on rows, the change list starting with the two connects.
  - Tool-routing tests keep their assertions.
- `relay-server.test.ts`:
  - The first test's hello gains `harness: 'claude'` and expects `harness: 'claude'` in the started info.
  - `starts a session with null fields from a hello that has none` and `… that omits them` expect `harness: null`.
  - `reads a harness it does not know as none` — hello `{ ...HELLO, harness: 'gemini' }` → `{ ok: true }`, started
    info `harness: null`.
  - The wrong-type table gains `['harness', { harness: 3 }]`.
- `channel-presenter.test.ts`: the fake's `showTab` becomes `markRound`, recording `markRound <id>`; the three
  expectations read `markRound app-1`.
- `tabs.test.ts`: `stepTab` / `showsEmptyText` cases rebuilt on `rows`; same expected values.

Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `grep -rn "showTab\|SessionTab\b" src` finds
nothing; `npm run selftest` still passes (the page draws as before; only labels' source changed).
Commit: one commit for the group.

## Proof

c802d7b · proved: diff read (every Produces present: Harness, SessionInfo.harness, RelayHello.harness?, SessionRow, SessionsState, markRound, closeSession, activated, SessionListDeps.activated), typecheck clean, sessions + forms main suites 340 pass · selftest all passed after 01 landed (07dd24a) · concerns: rows now exist from connect, so the selftest's timing may differ
