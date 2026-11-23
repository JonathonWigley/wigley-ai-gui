# 03 — Role-based permissive launch

Status: in progress
Type: Task
Rung: deep · crosses chat's saved-session format (`open-sessions.json`) and the process lifecycle (start, restart, relaunch restore, resume) into the claude-code harness's launch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/agent.ts`
- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/chat-sessions.ts`
- modify `src/plugins/chat/main/open-sessions.ts`
- modify `src/plugins/claude-code/main/claude-launch.ts`
- modify `src/plugins/claude-code/main/claude-controls.ts`
- modify `src/plugins/claude-code/main/session-fold.ts`
- modify `src/plugins/claude-code/main/claude-code-harness.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/main/open-sessions.test.ts`
- test `src/plugins/chat/main/start.test.ts`
- test `src/plugins/claude-code/main/claude-launch.test.ts`
- test `src/plugins/claude-code/main/claude-controls.test.ts`
- test `src/plugins/claude-code/main/claude-code-harness.test.ts`
- test `src/plugins/claude-code/main/session-fold.test.ts`
- test `src/shared/fake-agent-harness.test.ts`

The test files each hold an `AgentStart` literal or expectation that the new field must join. `src/shared/fake-agent-harness.ts`
builds no `AgentStart`: it records the request it is handed. So it is not edited, and chat's tests read
`harness.processes[n].request.permissions` from it.

Consumes:  nothing from another task
Produces:
- `permissions?: 'auto'` on `LaunchRequest` in `src/plugins/chat/contract.ts`
- `permissions: 'default' | 'auto'` on `AgentStart` in `src/contracts/agent.ts`, after `rowId`
- `launchMode(request: Pick<AgentStart, 'controls' | 'permissions'>): string` in `src/plugins/claude-code/main/claude-controls.ts`. It replaces today's `launchMode(controls)`.
- `startingControls(request: Pick<AgentStart, 'controls' | 'permissions'>): SessionControl[]` in `src/plugins/claude-code/main/claude-controls.ts`. It replaces today's `startingControls(controls)`.

## Decisions

- **A request without `permissions` launches exactly as today** (plan decision). Chat maps a missing
  `LaunchRequest.permissions` to `AgentStart.permissions: 'default'`. The claude-code harness ignores `'default'`, so
  its args, env and starting controls are byte-for-byte today's. Every existing claude-launch case stays green with
  only the new field added to its request.
- **The contract text.**
  - On `LaunchRequest`: "`permissions`: `'auto'` launches the session in its harness's most permissive mode, so the
    agent acts with no permission prompt. Left out, the harness's normal launch. Kept with the row across a clear, a
    process restart and a relaunch."
  - On `AgentStart`, in the comment block above it: "`permissions` is the role-based launch mode chat asks for:
    `'default'` for the harness's normal launch, `'auto'` for its most permissive one. Each adapter maps it to its
    harness's own launch, and a harness with no permissive mode treats `'auto'` as `'default'`."
- **Chat carries it the way it carries `unattended`.** That means a `permissions: 'default' | 'auto'` field on
  `HeldSession` (beside `unattended`, line 630), on `StartFlags`, on every opening record that lists `unattended`, and
  on `SavedSession` in `open-sessions.ts`.
  - `launch` (line 3626) sets it from `request.permissions ?? 'default'`.
  - Every `harness.start` and `harness.attach` request chat builds passes `permissions: session.permissions`. That
    covers the start at line 2429 and the attach at line 2524, so every later process start of the row (a
    restart after an exit, a clear) keeps it.
  - The saved record (line 972) writes it, and the restore from `open-sessions.json` (line 3831) reads it back. A
    relaunch that re-attaches or restarts the row stays permissive. A restored worker row keeps its saved
    permissions, so the job runner (05) claims it as it was launched. A restored row the user goes on in by hand (a
    send that restarts its process) keeps its launch permissions as saved too.
  - `SavedSession.permissions` joins `LaterSavedField` in `open-sessions.ts`, the way `unattended` did. A stored row
    without it reads `'default'`, and one that holds anything other than `'default'` or `'auto'` makes the file
    unreadable, as `isStoredSession` already treats a bad `unattended`. This follows the file's own pattern for a
    field saved later. Rejecting every row saved before the update would drop the user's open sessions at the first
    launch.
  - The user's own `start` (line 4556), the channel's `resume` (line 4385) and the `'resumed'` opening (line 3086)
    open `'default'`, as they open `unattended: false`. An adopted run (line 858) opens `'default'` (next point).
- **`prepareLaunch` refuses a permissive request.**
  - `request.permissions === 'auto'` rejects `chat cannot prepare a permissive launch`. This mirrors its
    `ephemeral` refusal and is checked right after it.
  - Its `AgentStart` passes `permissions: 'default'`, and `AdoptRequest` gains no field.
  - Why: a prepared run is started later by the session host, with nobody present, from a saved `PendingSpawn`
    record. Scheduled tasks are its only caller. A scheduled task's controls are capped to the calling session's
    (`capControls` in `scheduling/main/task-tools.ts`), and a permissive launch would step around that cap. No plan
    task needs a prepared permissive run.
- **The cap.** `capClaudeControls` and the fake's `capControls` have one caller, scheduling's task tools. It lowers a
  task's `mode` control to the calling session's, and only for a run built through `prepareLaunch`.
  - `permissions` is not a control, and no cap reads it.
  - With `prepareLaunch` refusing `'auto'`, no capped launch can be permissive, so "the cap wins" holds by
    construction. Neither `capPermission` nor `CLAUDE_PERMISSION_ORDER` changes.
  - `bypassPermissions` stays out of the order. A worker row that reports `mode: bypassPermissions` and then
    schedules a task gives `capPermission` an unknown cap, which it caps at `plan` (fail closed, as
    `src/shared/permission-cap.ts` says).
- **The claude-code mapping.** Checked against https://code.claude.com/docs/en/cli-reference and the permissions page
  on 2026-11-23:
  - "`--dangerously-skip-permissions`: Skip permission prompts. Equivalent to `--permission-mode bypassPermissions`."
  - `--permission-mode` accepts `bypassPermissions`.
  - `bypassPermissions` "skips permission prompts, except for the actions no mode auto-approves". A claude.ai
    connector tool its organization set to `ask` still prompts in `bypassPermissions`.

  For `permissions: 'auto'`, `claudeLaunch`'s args:
  - put `--dangerously-skip-permissions` directly before `--permission-mode`
  - pass `--permission-mode bypassPermissions`, whatever `controls.mode` holds
  - keep `--permission-prompt-tool CLAUDE_PERMISSION_TOOL`, so a prompt bypass still raises reaches chat's route,
    which an unattended row denies at once

  The plan pins both the flag and the mode. The flag also makes `bypassPermissions` a mode the process accepts
  mid-session (the comment at `claude-controls.ts:20`).

  For `'default'`, the args are today's: no flag, `--permission-mode <controls.mode ?? 'auto'>`.

  Name the strings as constants in `claude-controls.ts`: `BYPASS_MODE = 'bypassPermissions'` and
  `SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions'`. Update `claudeLaunch`'s comment to name the permissive
  launch.
- **`launchMode` and `startingControls`** take the request's `controls` and `permissions`. `launchMode` returns
  `BYPASS_MODE` for `'auto'`, else `controls.mode ?? 'auto'`.
  - **A permissive row restarts in bypass**, whatever its Mode control last held. Chat saves a `permissionMode`-role
    control's value into `launchControls` (`controlValuesOf`), so a user who picks Plan on a permissive row restarts it
    with `controls.mode: 'plan'` and `permissions: 'auto'`, and `launchMode` returns `bypassPermissions`. The pick
    holds only until the process restarts. Worker rows are hidden and unattended, and the user does not drive them.
  - `startingControls` therefore starts a permissive process's Mode control at `bypassPermissions`.
  - **The Mode picker shows bypass as its own choice on a permissive process.** For `'auto'`, `startingControls`
    appends `BYPASS_CHOICE = { value: 'bypassPermissions', label: 'Bypass permissions' }` (a constant in
    `claude-controls.ts`) to that process's copy of the Mode choices. Its chip reads `Mode: Bypass permissions`
    (`valueLabel` in `chat/page/chat-state.ts` finds the choice). The picker (`openChoices` in
    `chat/page/chat-commands.ts`) highlights it, and the user can pick it again after picking another mode, since the
    flagged process accepts it and `isChoice` finds it. Today, with the value outside the choices, the chip shows the
    raw value and the picker highlights the first choice (`Math.max(0, -1)`). Neither throws, but the picker would
    show the wrong row. session-fold replaces only the Model choices on `initialize` (`setControlChoices(state,
    'model', …)`), so the added Mode choice stays for the process's life. Claude's own report of
    `bypassPermissions` then resolves through `controlValue` to that choice. A `'default'` process's choices are
    `CLAUDE_CONTROLS`' unchanged.
  - The two callers change with them: `session-fold.ts:261` passes `request`, and `claude-code-harness.ts:1467`
    passes `{ controls: {}, permissions: 'default' }`.
  - `bypassPermissions` is not added to `CLAUDE_CONTROLS`' Mode choices, so the user still cannot pick it in a
    normal row.
  - The comment at `claude-controls.ts:20` is rewritten to say both halves: bypass is not a choice of a normal
    process, because Claude refuses it mid-session unless the process launched with the flag, and a permissive launch
    starts at `bypassPermissions` with `BYPASS_CHOICE` added to its own Mode choices.
- **Out of scope.** The worker's guard on what it writes is its instructions (design.md § The worker). The user's own
  settings could switch bypass off (`permissions.disableBypassPermissionsMode`); neither profile's `settings.json`
  sets it today. 14 checks the live launch.

GIVEN a launch with `permissions: 'auto'` WHEN chat starts its process THEN the harness request carries `permissions: 'auto'`, and so does every later start of the row
GIVEN a launch without `permissions` WHEN chat starts its process THEN the request carries `permissions: 'default'`
GIVEN a permissive row saved to `open-sessions.json` WHEN chat restores it THEN its next start carries `permissions: 'auto'`
GIVEN a saved file whose rows have no `permissions` WHEN chat loads it THEN each row reads `'default'`
GIVEN `prepareLaunch` with `permissions: 'auto'` WHEN it runs THEN it rejects `chat cannot prepare a permissive launch` and prepares nothing
GIVEN an `AgentStart` with `permissions: 'auto'` and `controls.mode: 'plan'` WHEN `claudeLaunch` builds the args THEN they hold `--dangerously-skip-permissions`, `--permission-mode bypassPermissions` and `--permission-prompt-tool`, and no `--permission-mode plan`
GIVEN `permissions: 'auto'` WHEN `startingControls` runs THEN the Mode control's value is `bypassPermissions`, and its choices end with `Bypass permissions`
GIVEN a permissive row whose process is live in the session host WHEN chat re-attaches it after a relaunch THEN the attach request carries `permissions: 'auto'`
GIVEN a permissive row whose Mode the user set to Plan WHEN its process restarts THEN it launches with `--permission-mode bypassPermissions`

## Tests

- `src/plugins/claude-code/main/claude-launch.test.ts`:
  - Add `permissions: 'default'` to every existing request literal. `claudeLaunch_NewSession_PinnedArgsAndProfileEnv`
    then still pins today's exact args, which proves a default launch is unchanged.
  - New `claudeLaunch_PermissiveStart_SkipsPermissionsWhateverTheMode`: request `permissions: 'auto'`,
    `controls: { mode: 'plan' }`. `args` equals the pinned new-session list, with `--dangerously-skip-permissions`,
    `--permission-mode`, `bypassPermissions` in place of `--permission-mode`, `auto`, and `--permission-prompt-tool`,
    `TOOL` after.
  - Add a row to the `claudeLaunch_Controls_BecomeLaunchFlags` table: name `permissive with model`,
    `permissions: 'auto'`, controls `{ model: 'sonnet', mode: 'acceptEdits' }`. Present:
    `['--permission-mode', 'bypassPermissions']`, `['--dangerously-skip-permissions']`, `['--model', 'sonnet']`.
    Absent: `['--permission-mode', 'acceptEdits']`. The table's `permissions` column defaults to `'default'` on the
    existing rows.
- `src/plugins/claude-code/main/claude-controls.test.ts`: new `startingControls_PermissiveStart_ModeIsBypass`, a table
  of `{ permissions: 'auto', controls: {} }` → `bypassPermissions`, `{ permissions: 'auto', controls: { mode: 'plan' } }`
  → `bypassPermissions`, and `{ permissions: 'default', controls: {} }` → `auto`, each read as the `mode` control's
  `value`. The two `'auto'` rows' Mode choices end with `BYPASS_CHOICE`, and the `'default'` row's equal
  `CLAUDE_CONTROLS`' Mode choices.
- `src/plugins/claude-code/main/session-fold.test.ts`: new `createSessionFoldState_Permissive_ModeIsBypassChoice`:
  `createSessionFoldState({ ...request, permissions: 'auto' })` holds a Mode control with value `bypassPermissions`
  and `BYPASS_CHOICE` among its choices.
- `src/plugins/chat/main/chat-sessions.test.ts`:
  - New `launch_Permissions_FirstStartAndLaterStartsPassThem`, modelled on
    `launch_Controls_FirstStartAndLaterStartsPassThem` (line 10688). Launch with `permissions: 'auto'`. The first
    process's `request.permissions` is `'auto'`, and after the process ends and a send restarts it, the second
    process's is `'auto'` too.
  - Add a case to `launch_NoControls_OpensAsBefore` (line 10709), or a sibling assertion in it: a launch without
    `permissions` starts with `permissions: 'default'`.
  - New `prepareLaunch_Permissive_Rejects` beside `prepareLaunch_Ephemeral_Rejects` (line 10821): rejects
    `chat cannot prepare a permissive launch`, and `preparedRuns` is empty.
  - New `restore_PermissiveRow_NextStartIsPermissive`: a saved snapshot row with `permissions: 'auto'` and no live
    process restores, and its next start's request carries `'auto'`.
  - New `restore_PermissiveRowLiveInHost_AttachIsPermissive`: a saved snapshot row with `permissions: 'auto'` whose
    process the fake harness holds live re-attaches, and the fake's `attachCalls[0].permissions` is `'auto'`. Model it
    on the existing re-attach test near `harness.attach` (line 2524).
- `src/plugins/chat/main/open-sessions.test.ts`:
  - New `save_PermissiveRow_RoundTrips`, modelled on `save_HeadlessRow_RoundTrips` (line 413).
  - Add a row to the load fixtures (the stored-row records near lines 39–93) so a row with no `permissions` reads
    `'default'`.
  - Add a row to the unreadable-file table (near line 375): `file: 'permissions not a mode'`, with `permissions: 'yes'`
    rejected.
- The other test files listed gain `permissions: 'default'` in their `AgentStart` literals only:
  `claude-code-harness.test.ts` (lines 64, 499, 4094), `session-fold.test.ts` (17), `start.test.ts` (133) and
  `fake-agent-harness.test.ts` (60). In `chat-sessions.test.ts`, the request expectations near lines 966, 1302, 4024
  and 10778 gain it too, wherever they assert a whole request.

Done when: `npm run typecheck` and `npm run lint` pass, and the test gate runs the tests above. The live permissive
launch (a worker job's process shows `bypassPermissions` and runs a connector call with no prompt) is checked in
[14 — Final verification](14-final-verification.md).
Commit:    one commit for the group

## Proof

