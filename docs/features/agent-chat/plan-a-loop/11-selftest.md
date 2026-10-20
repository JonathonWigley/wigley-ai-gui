# 11 — Chat self-test script

Status: not started
Type: Task
Wave: 6 · Depends on: 05, 06, 07, 09, 10
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/chat/main/start.ts`

Consumes:
- `SelfTestScript`, `SelfTestStep`, `MainServices.selfTest` (a per-plugin `SelfTestHost`), `MainServices.agentHarnesses`
  in `src/contracts/plugin.ts` ← 05; the driver's per-script result line `<pluginId> result …` ← 05
- `isFakeAgentHarness(harness)`, `FakeAgentProcessRecord { request; events; calls: FakeAgentCall[]; ended }`,
  `FakeAgentCall`, `FAKE_TOOL_TEXT` (`'fake: tool'`), `FAKE_HOLD_TEXT` (`'fake: hold'`) in
  `src/shared/fake-agent-harness.ts` ← 05; the fake's pinned behaviour there (controls `mode` Auto/Plan value `auto`,
  `effort` Low/Medium/High value `medium`; a plain send emits user, assistant, result; `FAKE_TOOL_TEXT` emits user, a
  Bash tool entry with its result, then assistant `fake agent ran a tool` (`streaming: false`), then result; `FAKE_HOLD_TEXT` holds the turn until
  `interrupt`, which emits notice `Interrupted` and idle; every emission in a microtask after its call)
- `ChatSessions.start`, `.closed`, `.permissionToolSession` in `src/plugins/chat/main/chat-sessions.ts` ← 07;
  `permissionReplyText`'s allow text and `PERMISSION_TOOL_NAME` in `src/plugins/chat/main/permission-tool.ts` ← 07
- `SessionsMainExports.activate`, `AgentSession`, `ToolResult` in `src/plugins/sessions/contract.ts` (tree)
- Task 09's page log lines and keys, and task 10's `picker shown: Folder` / `picker closed: Folder`, as those tasks
  pin them
- In the tree as the pattern: `src/plugins/forms/main/selftest-script.ts` (`formsSelfTestScript`, its `STEPS`,
  `SCROLLS_ITSELF`, `problems`)

Produces:
- `src/plugins/chat/main/selftest-script.ts`:
  ```ts
  export interface ChatSelfTestDeps {
    chat: Pick<ChatSessions, 'start' | 'closed' | 'permissionToolSession'>;
    sessions: Pick<SessionsMainExports, 'activate'>;
    harnesses: readonly AgentHarness[];
  }
  export function chatSelfTestScript(deps: ChatSelfTestDeps): SelfTestScript;
  export const SELFTEST_PROJECT_DIR = '/selftest/chat-selftest';
  ```
- `src/plugins/chat/main/start.ts`: after the chat module and the tool contribution are set up,
  `api.services.selfTest?.run(chatSelfTestScript({ chat, sessions, harnesses: api.services.agentHarnesses }))`.

Decisions:
- **Fixture** (`open(run)`), in order: when an earlier run's session id is held, `chat.closed(thatId)` (a reload
  mid-run leaves it open); `id = chat.start({ projectDir: SELFTEST_PROJECT_DIR, profile: 'work' })`;
  `sessions.activate(id)`, which shows Sessions mode with the session selected, its Chat tab its first tab; then one
  `permission_prompt` call through `chat.permissionToolSession({ id, info: { sessionId: null, projectDir:
  SELFTEST_PROJECT_DIR, deadlineSeconds: null, harness: 'claude' } }).call('permission_prompt', { tool_name: 'Bash',
  input: { command: 'rm selftest.txt' }, tool_use_id: 'selftest-tool-use' }, { toolUseId: 'selftest-tool-use',
  signal: new AbortController().signal })`, which adds `permission-1` and waits. `open` returns `shownLine: '[chat]
  Chat tab shown in chat-selftest'` and `result`: the call's promise mapped to `{ permission: ToolResult, process:
  FakeAgentProcessRecord | null }`, `process` the record of the fake (found through `isFakeAgentHarness` in
  `harnesses`) whose `request.projectDir` is `SELFTEST_PROJECT_DIR`, the last such. The record changes in place, so
  `problems` reads its calls as they stand after the last step. `permissionToolSession` is keyed by the session's
  `id`, the row id `start` returned (07).
- The project folder is never read: the fake spawns nothing, so `/selftest/chat-selftest` need not exist; its last
  segment `chat-selftest` is the `<name>` in every page line (task 09) and differs from forms' `selftest` group.
- `pageBinds: []`, `settings: {}` (forms' script already sets `keys.whichKeyTimeoutMs`; setting it here to another
  value would throw in the merge), `scrollsItself: ['.chat-json', '.chat-tool-result', '.md pre', '.md table',
  '.session-row-label', '.session-row-status', '.session-tab-label']`.
- Chat's script runs after forms' (chat's main part follows forms' in `src/plugins/main.ts`, task 07), so forms' steps
  see none of chat's rows.
- Each step expects the last line its keys cause, never an earlier one: a step's wait sees only the lines logged after
  the step began, and the fake emits in microtasks, so a line a step's keys cause can land before the next step
  starts. Typed text holds no `j` (the insert remap `jk`).
- **Steps**, each line under `[chat]` unless shown otherwise (`FAKE_TOOL_TEXT` and `FAKE_HOLD_TEXT` typed character by
  character):

  | # | Keys | Expect | Fit |
  |---|---|---|---|
  | 1 | `i` `h e l l o` `Escape` `Enter` | `[chat] assistant entry added in chat-selftest` | |
  | 2 | `Escape` | `[chat] left the box` | |
  | 3 | `y` | `[chat] allowed Bash in chat-selftest` | yes |
  | 4 | `i` FAKE_TOOL_TEXT `Escape` `Enter` | `[chat] result entry added in chat-selftest` | |
  | 5 | `Escape` | `[chat] left the box` | |
  | 6 | `k` | `[chat] focused assistant entry` | |
  | 7 | `k` | `[chat] focused tool entry` | |
  | 8 | `j` | `[chat] focused assistant entry` | |
  | 9 | `k` | `[chat] focused tool entry` | |
  | 10 | `Enter` | `[chat] expanded tool entry` | yes |
  | 11 | `G` | `[chat] following the latest entry` | |
  | 12 | `' '` `c` `e` | `[chat] picker shown: Effort` | yes |
  | 13 | `j` `Enter` | `[chat] Effort is High in chat-selftest` | |
  | 14 | `i` FAKE_HOLD_TEXT `Escape` `Enter` | `[chat] chat-selftest is working` | |
  | 15 | `<C-c>` | `[chat] notice entry added in chat-selftest` | |
  | 16 | `Escape` | `[chat] left the box` | |
  | 17 | `' '` `k` `n` | `[chat] picker shown: Folder` | yes |
  | 18 | `Escape` | `[chat] picker closed: Folder` | |
  | 19 | `i` FAKE_HOLD_TEXT `Escape` `Enter` | `[chat] chat-selftest is working` | |
  | 20 | `<D-w>` | `[chat] closing the session asks to end chat-selftest` | yes |
  | 21 | `y` | `[chat] session closed: chat-selftest` | |

  What each proves: 1 — `i` enters insert mode, `Escape` leaves it, normal-mode `Enter` sends, the harness's reply
  draws; 3 — `y` answers the oldest pending permission (the fixture's); 4 — the tool turn; 6–9 — `k`/`j` move over
  the tool turn's entries (user, tool, assistant, result; focus following the result); 10 — `Enter` opens the tool
  entry's expander, and the open body fits; 11 — `G`; 12–13 — the effort picker opens on `Medium`, `j` moves to
  `High`, `Enter` sets it, and the status line redraws from the fake's `controls`; 14–15 — `<C-c>` in the box (a
  chord fires in a box) ends a held turn with the fake's notice; 17–18 — task 10's start prompt opens and Esc closes
  it; 19–21 — closing a working session asks, and `y` ends it and drops its row.
- **`problems(result)`**, each a line when wrong:
  - `permission_prompt failed: <text>` when `permission.isError` is true;
  - `permission reply <text>` unless `permission.content[0].text` is exactly
    `{"behavior":"allow","updatedInput":{"command":"rm selftest.txt"}}`;
  - `no fake process for /selftest/chat-selftest` when `process` is null;
  - `fake calls <JSON>` unless `process.calls` equals, in order: send `hello`, send `fake: tool`, setControl `effort`
    `high`, send `fake: hold`, interrupt, send `fake: hold`, end — compared as `JSON.stringify` of `FakeAgentCall`
    values built in the script;
  - `fake process not ended` unless `process.ended` is true.
  The driver reports them as `chat result <problems>` or `chat result as expected` (05).
- The forms round taking over a Chat tab is pinned by task 04's tabs unit tests and the final verification's check 5,
  not here.

GIVEN `npm run selftest` with every earlier task landed WHEN chat's script runs THEN `[selftest] PASS [chat] Chat tab
shown in chat-selftest`, a PASS for each of the 21 steps above with its expected line (and for each fit check), and
`[selftest] PASS chat result as expected` print
GIVEN a reload mid-run WHEN the next run opens THEN the earlier run's session is closed first and the steps run against
the new one

Tests:     `npm run selftest` — the 21 steps and the result checks above (the self-test is the claim; no unit test
           restates the script)
Done when: the typecheck and `npm run lint` pass; `npm run selftest` passes forms' and chat's scripts
Commit:    one commit for the group

## Proof
