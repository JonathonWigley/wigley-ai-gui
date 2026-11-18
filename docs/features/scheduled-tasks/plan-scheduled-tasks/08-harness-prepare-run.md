# 08 — Harness prepare-a-run

Status: done
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/plugins/claude-code/main/claude-launch.ts` ·
           modify `src/plugins/claude-code/main/claude-code-harness.ts` · modify `src/plugins/claude-code/main/claude-controls.ts` ·
           modify `src/shared/fake-agent-harness.ts` · modify `src/shared/app-endpoint-dir.ts` ·
           create `src/shared/permission-cap.ts` ·
           test `src/shared/permission-cap.test.ts` (create) · test `src/plugins/claude-code/main/claude-launch.test.ts` ·
           test `src/plugins/claude-code/main/claude-controls.test.ts` · test `src/plugins/claude-code/main/claude-code-harness.test.ts` ·
           test `src/shared/fake-agent-harness.test.ts`

Consumes:  `HostedSpawn` with `unsetEnv` and `stdin` ← 02 (plan.md § Shared names and shapes, `src/contracts/session-host.ts`)
           `startClaudeProcess` passing `unsetEnv` and `stdin: []` ← 02 (`src/plugins/claude-code/main/claude-code-harness.ts`)
           `claudeUnsetEnv(profileDir, homeDir, paths): string[]` and `ClaudeLaunch.unsetEnv` ← 02 (`claude-launch.ts`)
           tree: `AgentStart`, `UserMessage`, `SessionControl`, `AgentHarness` (`src/contracts/agent.ts`);
           `claudeLaunch`, `claudeEnv` (`claude-launch.ts`); `CLAUDE_CONTROLS`, `launchMode`, `isChoice`, `userMessage`
           (`claude-controls.ts`); `CLAUDE_IDLE_RULE`, `CLAUDE_DROPPED_OUT_KEYS`, `definedEnv` (`claude-code-harness.ts`);
           `NESTED_SESSION_ENV`, `SESSION_ROW_ENV` (`src/shared/session-env.ts`); `FakeAgentHarness`, `startingControls`
           (`src/shared/fake-agent-harness.ts`); `createFakeSessionHost`, `addRunning` (`src/shared/fake-session-host.ts`)

Produces:
- In `src/contracts/agent.ts`, three `AgentHarness` members, with the comments exactly as plan.md § Shared names and
  shapes gives them:
  `prepareRun(request: AgentStart, firstMessage: UserMessage, env: Readonly<Record<string, string>>): HostedSpawn;`
  `startControls(): SessionControl[];`
  `capControls(controls: Readonly<Record<string, string>>, cap: Readonly<Record<string, string>>): Record<string, string>;`
  `agent.ts` imports `HostedSpawn` as a type from `./session-host`.
- In `src/shared/app-endpoint-dir.ts`: `export const APP_ENDPOINT_ENV = 'WIGLEY_AI_GUI_ENDPOINT_DIR';`
- In `src/plugins/claude-code/main/claude-launch.ts`:
  - `export function claudeSpawn(input: ClaudeSpawnInput): HostedSpawn`
  - `export interface ClaudeSpawnInput { request: AgentStart; command: string; permissionTool: string; env: NodeJS.ProcessEnv; homeDir: string; paths: Paths; stdin: readonly string[]; inheritEnv: boolean }`
  - `export const CLAUDE_CARRIED_ENV: readonly string[] = ['PATH', APP_ENDPOINT_ENV, 'CLAUDE_CONFIG_DIR'];`
  - `CLAUDE_IDLE_RULE` and `CLAUDE_DROPPED_OUT_KEYS` move here from `claude-code-harness.ts`, unchanged and exported.
- In `src/plugins/claude-code/main/claude-controls.ts`:
  - `export const CLAUDE_PERMISSION_ORDER: readonly string[] = ['plan', 'dontAsk', 'manual', 'acceptEdits', 'auto'];`
  - `export function claudeStartControls(): SessionControl[]`
  - `export function capClaudeControls(controls: Readonly<Record<string, string>>, cap: Readonly<Record<string, string>>): Record<string, string>`
  - `export function claudeOpeningLines(firstMessage: UserMessage, uuid: string): string[]`
  - `export const CLAUDE_OPENING_REQUESTS: readonly string[] = ['initialize', 'get_context_usage', 'get_settings'];`
  - `export function controlRequest(subtype: string, requestId: string): object`
- In `src/shared/permission-cap.ts`:
  `export function capPermission(controls: Readonly<Record<string, string>>, cap: Readonly<Record<string, string>>, rule: PermissionRule): Record<string, string>`
  `export interface PermissionRule { controlId: string; order: readonly string[]; launchDefault: string }`
- In `src/shared/fake-agent-harness.ts`: `prepareRun`, `startControls` and `capControls` on the fake, and on
  `FakeAgentHarness`: `readonly preparedRuns: readonly FakePreparedRun[];` with
  `export interface FakePreparedRun { request: AgentStart; firstMessage: UserMessage; env: Readonly<Record<string, string>>; spawn: HostedSpawn }`
  and `export const FAKE_AGENT_COMMAND = 'fake-agent';`

Decisions:
- **One spec builder** (plan.md § Architecture). `claudeSpawn` calls `claudeLaunch` and returns the whole
  `HostedSpawn`: `id` is `request.processId`, `command` is `input.command`, `args` and `cwd` are `claudeLaunch`'s,
  `env` is `claudeLaunch`'s env without undefined values (`definedEnv` moves to `claude-launch.ts` as a private
  function), `inheritEnv` is `input.inheritEnv`, `unsetEnv` is `claudeLaunch`'s `unsetEnv` (02's `claudeUnsetEnv`, the one unset rule), `stdin` is `input.stdin`, `idleRule` is `CLAUDE_IDLE_RULE`,
  `droppedOutKeys` is `CLAUDE_DROPPED_OUT_KEYS`. `startClaudeProcess` and `prepareRun` both build their spawn
  through it. `claudeLaunch` stays exported, and its tests stay as they are.
- **`start` after the change.** `startClaudeProcess` calls `claudeSpawn` with `env: deps.env`, `stdin: []` and
  `inheritEnv: false` (02: a live start's child env is exactly its launch env), then
  `deps.host.spawn(spec, withSpawnHint(forwarder.events, spec.command, spec.cwd))`. The spawn it hands the host is the
  same as after task 02, field for field. This task adds no unset list of its own: 02's `claudeUnsetEnv` already
  names `CLAUDE_CONFIG_DIR` for the default profile folder, so the host never passes its own value to the child.
- **`prepareRun` env.** `prepareRun` calls `claudeSpawn` with `inheritEnv: true` and `env` set to the
  `CLAUDE_CARRIED_ENV` names that `deps.env` holds, with the `env` argument laid over them. `claudeEnv` then runs as for a live start: it drops the
  nested-session names and the app's own names (also when the `env` argument holds them), and it sets
  `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` and `WIGLEY_SESSION_ROW` from the request. So the
  harness's own values win over the `env` argument, and no other name of `deps.env` reaches the spec.
- **`CLAUDE_CONFIG_DIR` is carried** (settled design § When and where runs fire, which lists it among the app's own
  vars). For a profile with `profileDir` null, `claudeEnv` keeps the inherited `CLAUDE_CONFIG_DIR`, and
  `claudeConfigFolder` reads the transcripts from that folder. A prepared run must write its transcript to the same
  folder, or `adopt` (task 14) finds no history. plan.md § Shared names lists it with `PATH` and
  `APP_ENDPOINT_ENV`.
- **`prepareRun` stdin.** `stdin` is `claudeOpeningLines(firstMessage, deps.randomUuid())`: the three opening
  control requests with request ids `wigley-1`, `wigley-2`, `wigley-3` in `CLAUDE_OPENING_REQUESTS` order, then
  `userMessage(firstMessage, uuid)`. Each line is the `JSON.stringify` text `pipe.write` gets today, with no newline.
  `createClaudeSession`'s `open` writes its three requests by a loop over `CLAUDE_OPENING_REQUESTS` through
  `controlRequest(subtype, nextRequestId())`, and `requestCommands`, `requestContextUsage` and
  `requestAppliedSettings` use `controlRequest` too, so a live open and a prepared run write the same text. The ids
  start at 1 because a new session's fold state starts with `requestCount` 0.
- **`prepareRun` guards.** It throws `A prepared run starts a new session` when `request.resume` is true. It throws
  `Claude Code control <id> has no choice <value>` (the text `setControl` throws) when `request.controls` holds a
  `mode` or `effort` value that `isChoice` rejects. `model` is not checked: the CLI takes a full model id as well as
  the aliases `CLAUDE_CONTROLS` lists. Reason: a task file is hand-editable, chat (14) checks only the control ids,
  and the cap (15) runs only in the MCP tools. A `mode: 'bypassPermissions'` or a typo would else reach
  `--permission-mode`, and the failure would show in history as a bare exit. It spawns nothing, writes nothing, and
  calls no host member.
- **The command path is read at prepare time.** `prepareRun` reads `deps.command()` once, and the queued spawn
  holds that path. A change of the `claude.command` setting reaches a queued run only when the scheduler prepares it
  again. The harness exposes no change signal; whether a settings change re-plans is task 17's trigger list.
- **No spawn hint on a prepared run.** `start` wraps its events in `withSpawnHint`, which rewords an ENOENT as
  `claude was not found at <command>, or the project folder <cwd> does not exist; set claude.command`. A prepared
  run's spawn error reaches the app only as the host's raw `HostedRun.exit.error` (for example `spawn <command>
  ENOENT`). This task adds no hint for it: the app hears the error long after the spawn, outside any harness call.
  Task 17 owns the failed run's reason text.
- **The cap rule lives once** in `src/shared/permission-cap.ts`, since the fake harness in `src/shared` cannot
  import from `src/plugins/claude-code/main`. Each adapter gives only its `PermissionRule`. `capPermission` copies
  `controls`. It reads the effective value as `controls[controlId]`, else `launchDefault`, and the cap value as
  `cap[controlId]`, else `launchDefault`. When the effective value ranks above the cap value in `order`, it sets
  `controlId` to the cap value; else it leaves `controls[controlId]` as it was, absent included. Unknown values fail
  closed: an effective value not in `order` ranks above every value in `order`, and a cap value not in `order` caps
  at `order[0]`. Every other control stays as `controls` has it.
- **Claude's rule** is `{ controlId: 'mode', order: CLAUDE_PERMISSION_ORDER, launchDefault: 'auto' }`
  (plan.md § Decisions, Permission cap in the harness). `'auto'` is the value `launchMode` falls back to; read it
  from one constant shared by `launchMode` and the rule.
- **`claudeStartControls`** returns each `CLAUDE_CONTROLS` entry as a `SessionControl` with a copy of its choices
  and `value` null, in `CLAUDE_CONTROLS` order.
- **The fake harness** is the second adapter:
  - `prepareRun` throws the `failNextStart` message once, as `start` does, and throws on `request.resume` true
    with the Claude adapter's message. Else it returns `{ id: request.processId, command: FAKE_AGENT_COMMAND,
    args: [], cwd: request.projectDir, env: { ...env, WIGLEY_SESSION_ROW: request.rowId }, inheritEnv: true,
    unsetEnv: [], stdin: [JSON.stringify({ type: 'user', ...firstMessage })], idleRule: FAKE_IDLE_RULE,
    droppedOutKeys: [] }` and pushes a `FakePreparedRun` onto `preparedRuns`. It adds no `processes` record and does
    not count toward `listProjects`. The stdin line carries `type: 'user'` so that the spec's own idle rule reads the
    process busy, as a Claude spec's `user` line does; a check of the overlap skip over a fake spec then works.
    The fake checks no control value.
  - `FAKE_IDLE_RULE` is a private constant `{ key: 'type', value: 'result', busyStdoutValues: [], busyStdinValues: ['user'] }`.
  - `startControls()` returns `startingControls({})` with every `value` null.
  - `capControls` calls `capPermission` with `{ controlId: 'mode', order: ['plan', 'auto'], launchDefault: 'auto' }`.
  - The `FakeAgentHarness` comment block gains one sentence each for `preparedRuns` and `prepareRun`'s use of
    `failNextStart`.
- **`APP_ENDPOINT_ENV`** gets a one-line comment: the variable the relay reads to find the app's endpoint folder.
  `main.ts` keeps its literal until task 18.
- **Name clash.** `claude-code-harness.ts` already exports the type `ClaudeSpawn` (the one-shot spawn function).
  Keep both names as plan.md pins them; `claudeSpawn`'s comment says it builds the hosted session spec.

GIVEN a request with `processId` `p-1`, `rowId` `row-7`, profile `~/.claude-work`, controls `{ mode: 'plan', model: 'sonnet' }`,
`idleCompactMinTokens` null, the harness's `homeDir` `/h`, and `deps.env` `{ PATH: '/usr/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/h/.agents/wigley-ai-gui', HOME: '/h', CLAUDECODE: '1' }`
WHEN `prepareRun(request, { text: 'run it', images: [] }, { WIGLEY_FORMS_OFFLINE: '/h/.agents/wigley-ai-gui/offline-calls' })` runs
THEN its `command`, `args`, `cwd`, `unsetEnv`, `idleRule` and `droppedOutKeys` equal those `start` hands the host for
the same request; its `inheritEnv` is true where `start`'s is false; its `env` is exactly `{ PATH, WIGLEY_AI_GUI_ENDPOINT_DIR, WIGLEY_FORMS_OFFLINE, CLAUDE_CONFIG_DIR: '/h/.claude-work', WIGLEY_SESSION_ROW: 'row-7' }`
with the values above; and the host holds no process.

GIVEN a host process whose log holds a prepared run's `stdin` as `in` lines WHEN the Claude harness attaches to it
THEN it writes no line, and once Claude reports the first message's uuid started, it emits user entry `user-1` with
text `run it`.

GIVEN controls `{ mode: 'auto', model: 'opus' }` and cap `{ mode: 'manual' }` WHEN `capControls` runs THEN it returns
`{ mode: 'manual', model: 'opus' }`.

GIVEN a request with controls `{ mode: 'bypassPermissions' }` WHEN `prepareRun` runs THEN it throws
`Claude Code control mode has no choice bypassPermissions` and returns no spec.

Tests:
- `src/shared/permission-cap.test.ts`, new, `describe('capPermission')`, one `it.each` over the rule
  `{ controlId: 'mode', order: ['low', 'mid', 'high'], launchDefault: 'high' }`, each row `controls`, `cap`,
  `expected`. It catches a cap that lowers the wrong way, or that skips a missing or unknown value:
  | controls | cap | expected |
  |---|---|---|
  | `{ mode: 'high', x: '1' }` | `{ mode: 'mid', x: '2' }` | `{ mode: 'mid', x: '1' }` |
  | `{ mode: 'low' }` | `{ mode: 'mid' }` | `{ mode: 'low' }` |
  | `{ mode: 'mid' }` | `{ mode: 'mid' }` | `{ mode: 'mid' }` |
  | `{}` | `{ mode: 'mid' }` | `{ mode: 'mid' }` |
  | `{}` | `{}` | `{}` |
  | `{ mode: 'high' }` | `{}` | `{ mode: 'high' }` |
  | `{ mode: 'other' }` | `{ mode: 'high' }` | `{ mode: 'high' }` |
  | `{ mode: 'mid' }` | `{ mode: 'other' }` | `{ mode: 'low' }` |
  A second `it`: the result is a new object, and `controls` is unchanged after the call.
- `claude-controls.test.ts`: one `it.each` named for `capClaudeControls`, over adjacent pairs of the Claude order. It
  catches a wrong place for `dontAsk` or a wrong launch default:
  `{ mode: 'dontAsk' }` cap `{ mode: 'plan' }` → `{ mode: 'plan' }`; `{ mode: 'manual' }` cap `{ mode: 'dontAsk' }` →
  `{ mode: 'dontAsk' }`; `{ mode: 'acceptEdits' }` cap `{ mode: 'manual' }` → `{ mode: 'manual' }`; `{ mode: 'auto' }`
  cap `{ mode: 'acceptEdits' }` → `{ mode: 'acceptEdits' }`; `{}` cap `{ mode: 'manual' }` → `{ mode: 'manual' }`;
  `{ mode: 'auto', effort: 'high' }` cap `{}` → `{ mode: 'auto', effort: 'high' }`.
  One `it` for `claudeStartControls`: ids `['mode', 'effort', 'model']`, each `value` null, each choice list equal to
  `CLAUDE_CONTROLS`'s.
  One `it` for `claudeOpeningLines`: with uuid `u-9` it returns, parsed, `initialize` `wigley-1`, `get_context_usage`
  `wigley-2`, `get_settings` `wigley-3`, then the `user` line with `uuid` `u-9` and the message's content.
- `claude-launch.test.ts`: one `it` for `claudeSpawn`: `id` is the request's `processId`, `unsetEnv`
  equals `claudeLaunch`'s `unsetEnv` for the same input, `stdin` is the input's,
  `env` has no undefined value, and `args`, `cwd` equal `claudeLaunch`'s for the same input.
- `claude-code-harness.test.ts`, in `describe('createClaudeCodeHarness')`:
  - `prepareRun_SameRequest_MatchesTheLiveSpawn`: the GIVEN above. Start the same request on a second harness over its
    own `createFakeSessionHost` and compare with that host's `processes[0].request`; assert the full `env` object of
    the prepared spec; assert the first host's `processes` is empty. Catches drift between `start` and `prepareRun`,
    and a leak of `HOME` or `CLAUDECODE`.
  - `prepareRun_EnvArgument_CannotOverrideHarnessValues`: an `env` argument holding `WIGLEY_SESSION_ROW: 'x'` and
    `CLAUDECODE: '1'` gives `WIGLEY_SESSION_ROW` the request's `rowId` and no `CLAUDECODE`.
  - `prepareRun_DefaultProfile_CarriesInheritedConfigDir`: `profileDir` null and `deps.env` holding
    `CLAUDE_CONFIG_DIR: '/h/cfg'` gives `env.CLAUDE_CONFIG_DIR` `/h/cfg`.
  - `prepareRun_StdinReplayedOnAttach_WritesNothingAndHoldsTheMessage`: the second GIVEN above. Build the log with
    `addRunning` from `spawn.stdin`, attach with the same request, assert no write after the attach, then feed the
    lifecycle `started` line for `uuid-1` and assert the `user-1` entry. Catches opening lines that the fold does not
    read as the app's own.
  - `prepareRun_Resume_Throws`: throws `A prepared run starts a new session`; the host holds no process.
  - `prepareRun_ControlValue_Cases`: an `it.each` — `mode: 'bypassPermissions'` throws, `mode: 'plna'` throws,
    `effort: 'huge'` throws, each with the pinned text; `model: 'claude-opus-5-5'` returns a spec whose `args` hold
    it. Break: an unknown permission mode reaching `--permission-mode`.
  - Add `startControls` and `capControls` to no harness test: the claude-controls tests own them.
- `fake-agent-harness.test.ts`, in `describe('createFakeAgentHarness')`:
  - `prepareRun_ReturnsTheSpecAndRecordsIt_StartsNothing`: the spec's `env` holds the argument and
    `WIGLEY_SESSION_ROW`, `inheritEnv` is true, `stdin` is the message as JSON with `type: 'user'`, the parsed line's
    value at `idleRule.key` is in `idleRule.busyStdinValues`, `preparedRuns` holds the call, `processes` stays
    empty. Break: a fake spec whose first line never reads busy.
  - Add a row or a line to `failNextStart_ThrowsOnce` (line 236): a `prepareRun` after `failNextStart` throws the
    message once, and the next `prepareRun` returns.
  - `startControls_AllValuesNull_CapControlsLowersModeToPlan`: `startControls()` ids
    `['mode', 'effort', 'model', 'verbosity']` with `value` null; `capControls({ mode: 'auto' }, { mode: 'plan' })`
    returns `{ mode: 'plan' }`.

Done when: `npm run typecheck` and `npm run lint` pass (the layer check admits `src/shared/permission-cap.ts` from
`src/plugins/claude-code/main` and `src/shared`); the test gate runs the five test files above. That a host-fired prepared run
starts Claude and Claude takes the opening lines and the first message from stdin is a runtime check for task 21
(Final verification), the host-fired run.
Commit:    one commit for the group

## Proof

Commit 617927acd · proof: diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: attach-replay test traced by hand only
