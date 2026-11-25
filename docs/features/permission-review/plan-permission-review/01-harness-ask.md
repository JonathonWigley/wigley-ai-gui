# 01 — Harness one-shot ask and permission summary

Status: in progress
Type: Batch
Rung: deep · spawns a child process whose abort, exit and output the ask settles once (async lifecycle across the process boundary)
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/agent.ts`
- create `src/plugins/claude-code/main/claude-ask.ts`
- test `src/plugins/claude-code/main/claude-ask.test.ts` (create)
- modify `src/plugins/claude-code/main/claude-code-harness.ts`
- modify `src/plugins/claude-code/main/claude-launch.ts`
- modify `src/plugins/claude-code/main/start.ts`
- modify `src/plugins/claude-code/manifest.ts`
- modify `src/shared/fake-agent-harness.ts`
- modify `src/plugins/chat/main/preview/preview-session.ts`
- test `src/plugins/claude-code/main/claude-code-harness.test.ts`
- test `src/plugins/claude-code/main/start.test.ts`
- test `src/shared/fake-agent-harness.test.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- test `src/plugins/chat/page/chat-view.test.ts`
- test `src/plugins/chat/page/chat-state.test.ts`
- test `src/plugins/chat/page/chat-commands.test.ts`
- test `src/plugins/chat/page/chat-kit.test.ts`
- test `src/plugins/chat/page/working-turn.test.ts`
- test `src/plugins/chat/page/activity-runs.test.ts`

Consumes: `toolSummary(name, input)` in `src/plugins/claude-code/main/tool-summary.ts` (in the tree) ·
`claudeEnv(env, profileDir, homeDir, paths)` in `claude-launch.ts` (in the tree) · `programNotFoundMessage('claude')`
in `src/shared/program-lookup.ts` (in the tree) · `Files.makeFolder(path)` (in the tree) ·
`MainServices.tempFolders` (in the tree) · `FakeProcesses` / `FakeSpawn` in `src/shared/fake-processes.ts` (in the tree)

Produces:
- In `src/contracts/agent.ts`:
  - `export interface AgentAsk { profileDir: string | null; instructions: string; prompt: string; signal: AbortSignal; }`
  - `AgentHarness` gains `ask(request: AgentAsk): Promise<string>;`
  - the `kind: 'permission'` `ChatEntry` variant gains `summary: string;`, placed after `input`
- In `src/shared/fake-agent-harness.ts`:
  - `export const FAKE_ASK_REPLY = '{"summary":"Deletes the file fake.txt from the project folder.","verdict":"deny","risk":"medium"}';`
  - `FakeAgentHarness` gains `setAskReply(text: string): void;`, `failNextAsk(message: string): void;` and
    `readonly askCalls: readonly AgentAsk[];`
- In `src/plugins/claude-code/main/claude-ask.ts`:
  - `export const ASK_FOLDER_NAME = 'claude-code-ask';`
  - `export interface ClaudeAskDeps` (below)
  - `export function askClaude(deps: ClaudeAskDeps, request: AgentAsk): Promise<string>`
- In `src/plugins/claude-code/main/claude-launch.ts` (moved from `claude-code-harness.ts`, bodies unchanged):
  `export function exitText(code: number | null, signal: string | null): string` and
  `export function cliSpawnError(startError: SpawnStartError, command: string): string`
- `ClaudeCodeHarnessDeps` gains `askModel(): string;` and `tempFolders: readonly string[];`
- The `claude-code` setting `askModel`, default `'sonnet'`.

Decisions:
- The model setting is `claude-code.askModel`, default `sonnet`, read at each ask, so a change applies to the next ask
  (plan.md Decisions, design review). An empty value leaves `--model` out, and the ask runs on the CLI's own default
  model, the way an empty `command` falls back to a lookup (Decided while drafting).
- The ask lives in its own file, `claude-ask.ts`, as `askClaude`. `createClaudeCodeHarness` returns
  `ask: (request) => askClaude(deps, request)`. `ClaudeAskDeps` is declared in `claude-ask.ts` so the file imports
  nothing from `claude-code-harness.ts`; `ClaudeCodeHarnessDeps` satisfies it structurally:

  ```ts
  export interface ClaudeAskDeps {
    command(): Promise<ProgramCandidate | null>;
    askModel(): string;
    tempFolders: readonly string[];
    env: Readonly<Record<string, string>>;
    homeDir: string;
    paths: Paths;
    files: Pick<Files, 'makeFolder'>;
    processes: Pick<ProcessRunner, 'spawn'>;
  }
  ```
- `exitText` and `cliSpawnError` move to `claude-launch.ts` and the harness imports them, so the one-shot runs and the
  ask share one not-found text and one exit text.
- The ask does not go through `runCli`/`spawnCli`: those run in the home folder with stdin closed at once. The ask
  calls `deps.processes.spawn` itself, modelled on `spawnCli`.
- The ask's cwd is `deps.paths.join(deps.tempFolders[0], ASK_FOLDER_NAME)`, made with `deps.files.makeFolder` before
  each spawn (an existing folder is no error). The env is
  `claudeEnv(deps.env, request.profileDir, deps.homeDir, deps.paths)`. The command is the program's `command`, its
  args the program's leading args, then the ask's args.
- The ask has no timeout of its own: the caller's `signal` bounds it (04 holds the 60-second limit).
- `start.ts` wires `askModel: () => api.settings().askModel` and `tempFolders: services.tempFolders`.
- The fake harness ignores `request.signal`: its ask settles one microtask after the call.
- The fake writes its own `summary` rule, since `src/shared` cannot import claude-code's `toolSummary`: the input's
  `command` field when it is a string, else `''`. So the built-in `FAKE_PERMISSION_TEXT` call writes `rm fake.txt`.

Pinned values:
- Args, in this order:
  `['-p', '--system-prompt', request.instructions, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--model', <askModel>]`
  with the last two left out when `askModel` is `''`.
- Stdin: `write(request.prompt)` once, then `endInput()`.
- Rejection reasons, each an `Error` with this exact message:

  | Case | Message | Spawns |
  |---|---|---|
  | `deps.tempFolders` empty | `no temp folder to run the ask in` | 0 |
  | `request.signal` aborted before the spawn (at the call, or during the lookup or the folder make) | `the ask was stopped` | 0 |
  | `deps.command()` resolves null | `programNotFoundMessage('claude')` | 0 |
  | `deps.command()` rejects | that rejection, as it is | 0 |
  | `deps.files.makeFolder` rejects | that rejection, as it is | 0 |
  | the child fails to start | `cliSpawnError(startError, program.command)`, so `claude was not found at <command>; set claude-code.command` when `notFound` | 1 |
  | stdout parses, and `is_error` is `true` | `claude -p failed: <result>`; when `result` is `''`, missing or not a string, `<stderr>` takes its place; with both empty, `claude -p failed` | 1 |
  | exit code not 0 (and the case above does not apply) | `claude -p exited with <exitText(code, signal)>`, then `: <stderr>` when stderr is not empty | 1 |
  | stdout is not one JSON object, or its `result` is no string | `claude -p printed no result`, then `: <stderr>` when stderr is not empty | 1 |
  | `request.signal` aborts while the child runs | `the ask was stopped`; the child gets `kill('SIGKILL')` | 1 |

  stderr is trimmed. The checks on close run in the table's order: is_error, then the exit code, then the parse.
  "Parses" means `JSON.parse` of the trimmed stdout gives a non-null object that is not an array; `[]`, `null`, a
  number or a string is "not one JSON object".
- Pre-spawn order, each step rejecting with its row above: check `tempFolders`, check `signal.aborted`, await
  `command()`, check `signal.aborted`, null check, await `makeFolder`, check `signal.aborted`, spawn. An abort during
  the lookup so wins over a null lookup, while a lookup that rejects rejects with its own error (the `await` throws
  before the re-check).
- Success: exit code 0, stdout (trimmed) parses as an object, `is_error` is not `true`, and `result` is a string. The
  ask resolves with `result` as it is.
- `settingInfo.askModel`: label `Ask model`; description
  `The model one-shot asks run on, such as the permission review: a Claude model alias or full name. Empty, the ask runs on Claude Code's default model. Applies to the next ask.`
- Fake ask: resolves with the reply set when it was called (`FAKE_ASK_REPLY` before any `setAskReply`), in a
  microtask; after `failNextAsk(message)` the next ask rejects with `new Error(message)` and later asks resolve again.
  Every call is pushed onto `askCalls` as the `AgentAsk` it was given, failed ones included.
- Contract comments (`src/contracts/agent.ts`), verbatim:
  - above `AgentAsk`:
    `// One prompt run by itself: \`profileDir\` as \`AgentStart\` holds it, \`instructions\` the system prompt, \`prompt\` the user's text, and \`signal\` the abort that kills the run.`
  - above `ask` in `AgentHarness`:
    `// Runs \`request.prompt\` once under \`request.instructions\`, on \`request.profileDir\`, with no tools and no session, saving nothing; the adapter picks the model. Resolves with the model's reply text. Rejects with a reason the user can read, and kills the run and rejects when \`request.signal\` aborts.`
  - above `summary` in the permission variant:
    `// The call's one-line target, as a tool entry's \`summary\` shows it: a Bash command's first line, an edited file's path; '' when the input names none.`
  Wrap each at the file's line width.
- Minted permission entry (claude-code-harness.ts, `permissions.ask`): `summary: toolSummary(call.toolName, call.input)`.
- Preview entries (`preview-session.ts`) gain the summary `toolSummary` would give: `preview-7` `src/app.ts`,
  `preview-8` `rm -rf build`, `preview-9` `notes.md`.

GIVEN a temp folder `/tmp/t`, askModel `sonnet` and profile `~/.claude-personal` WHEN `ask` runs THEN it spawns `claude`
with the pinned args in `/tmp/t/claude-code-ask`, that folder exists, the env holds
`CLAUDE_CONFIG_DIR=/Users/u/.claude-personal` and no `CLAUDECODE`, stdin holds the prompt and is ended
GIVEN askModel `''` WHEN `ask` runs THEN the args end at `'json'`, with no `--model`
GIVEN the child prints `{"type":"result","is_error":false,"result":"hello"}` and exits 0 WHEN it closes THEN the ask
resolves `hello`
GIVEN each case in the rejection table WHEN the ask settles THEN it rejects with that message and the spawn count shown
GIVEN a running ask WHEN its signal aborts THEN the child gets `SIGKILL` and the ask rejects `the ask was stopped`, and
a later close changes nothing
GIVEN a `permission_prompt` call for Bash `{ command: 'ls' }` WHEN the harness mints its entry THEN `summary` is `ls`
GIVEN the fake harness WHEN `ask` runs THEN it resolves `FAKE_ASK_REPLY`; after `setAskReply('x')` the next resolves
`x`; after `failNextAsk('m')` the next rejects `m` and the one after resolves `x`
GIVEN the fake raises a permission request WHEN its input is `{ command: 'ls' }` THEN `summary` is `ls`; for
`{ file_path: '/a.ts' }` it is `''`

Tests:
- `src/plugins/claude-code/main/claude-ask.test.ts` (new), `describe('askClaude')`, over `FakeProcesses` and
  `createMemoryFiles()`, with `posixPaths`, homeDir `/Users/u`, env `{ HOME: '/Users/u', CLAUDECODE: '1' }`, command
  `{ command: '/bin/claude', args: ['--lead'] }`:
  - `it.each` `'runs claude -p in its own temp folder with model $name'`, rows `{ name: 'sonnet', askModel: 'sonnet',
    modelArgs: ['--model', 'sonnet'] }` and `{ name: 'empty', askModel: '', modelArgs: [] }`: asserts the spawn's
    `command`, its whole `args` (`['--lead', '-p', '--system-prompt', 'Be brief.', '--tools', '', ...]` in full,
    literal), `cwd` `/tmp/t/claude-code-ask`, `env` `{ HOME: '/Users/u', CLAUDE_CONFIG_DIR: '/Users/u/.claude-personal' }`,
    `written` `['Tool: Bash']`, `isInputEnded` true, and that `files.stat('/tmp/t/claude-code-ask')` is a folder.
    Breaks on: a dropped isolation flag, the prompt on argv instead of stdin, the project or home folder as cwd, the
    nested-session env leaking in.
  - `'resolves with the result text'`: one close of the success line resolves `hello`.
  - `it.each` `'rejects $name'` over the rejection table, each row a setup (deps or signal), a `finish(spawn)` that
    writes stdout and stderr and calls `close`, the literal message and the spawn count. Rows: `NoTempFolder`,
    `AbortedBeforeSpawn` (aborted at the call), `AbortedDuringLookup` (`command()` aborts the signal, then resolves
    null → `the ask was stopped`), `CommandNotFound`, `CommandRejects`, `MakeFolderRejects` (`makeFolder` rejects
    `new Error('EACCES')` → `EACCES`), `SpawnNotFound`
    (`startError: { message: 'spawn /bin/claude ENOENT', notFound: true }`), `IsError` (stdout
    `{"type":"result","is_error":true,"result":"Not logged in"}`, exit 1 → `claude -p failed: Not logged in`),
    `IsErrorEmptyResult` (result `''`, stderr `boom` → `claude -p failed: boom`), `IsErrorNoResult` (stdout
    `{"is_error":true}`, stderr `''`, exit 1 → `claude -p failed`), `NonZeroExit` (stdout `''`, stderr
    `bad flag`, exit 2 → `claude -p exited with code 2: bad flag`), `SignalExit` (code null, signal `SIGTERM` →
    `claude -p exited with signal SIGTERM`), `NotJson` (stdout `oops`, exit 0 → `claude -p printed no result`),
    `NotAnObject` (stdout `[]`, exit 0 → `claude -p printed no result`),
    `NoResultField` (stdout `{"type":"result","is_error":false}`, exit 0 → `claude -p printed no result`).
  - `'aborting a running ask kills the child and rejects'`: abort after the spawn; the spawn's `kills` is
    `['SIGKILL']`, the ask rejects `the ask was stopped`, and a `close` with the success line afterwards leaves the
    rejection standing.
- `src/plugins/claude-code/main/start.test.ts`: one new test,
  `'ask_RunsOnTheAskModelSettingInTheFirstTempFolder'`: `started` with settings askModel `haiku` and
  `services.tempFolders` `['/tmp/a', '/tmp/b']`; the registered harness's `ask` spawns with `--model haiku` last and
  cwd `/tmp/a/claude-code-ask`. The `started` helper gains a `tempFolders` override; the existing settings literals
  (`{ command, profiles }` at the `accountStatus_CommandSetting…` and `settingsChanged_Profiles…` tests) gain
  `askModel: 'sonnet'`.
- `src/plugins/claude-code/main/claude-code-harness.test.ts`: the `permissionEntry` fixture in the permission
  describe gains `summary: 'ls'`, so every test that asserts a minted entry checks the summary. Every
  `createClaudeCodeHarness({...})` call in the file gains `askModel: () => 'sonnet'` and `tempFolders: []`.
- `src/shared/fake-agent-harness.test.ts`:
  - new `'ask_AnswersTheScriptedReply_FailNextAskRejectsOnce'`: the sequence in the GIVEN line above, plus `askCalls`
    holding each request in call order.
  - new `it.each` `'askPermission_SummaryIsTheCommandField given $given'`, rows `{ command: 'ls' }` → `'ls'` and
    `{ file_path: '/a.ts' }` → `''`, asserting the raised entry's `summary`.
  - the expected permission entries at the `FAKE_PERMISSION_TEXT` test (`summary: 'rm fake.txt'`) and the
    `askPermission_RaisesOnTheRowsLiveProcess` table (`summary: 'ls'`) gain their summary.
- `src/plugins/chat/main/chat-sessions.test.ts`: the expected fake entry near line 3454 gains `summary: 'ls'`; the
  entries built near lines 5719 and 7271 gain `summary: 'ls'` to compile.
- The chat page fixtures gain `summary: ''` to compile, no new assertion: `entry-list.test.ts` (`permission`),
  `chat-view.test.ts` (`PERMISSION`), `chat-state.test.ts` (`permission`), `chat-commands.test.ts`
  (`pendingPermission`), `chat-kit.test.ts` (`PERMISSION`), `working-turn.test.ts` and `activity-runs.test.ts` (the
  `case 'permission'` builders).
- `src/plugins/chat/layouts/default/layout.test.ts` builds a `PermissionInput`, not a `ChatEntry`: it is 02's, and
  this task leaves it alone. `src/plugins/chat/main/preview/chat-preview.test.ts` asserts only the preview's entry
  kinds, and `lookups.test.ts`, `folder-choices.test.ts` and `fake-agent-harness.test.ts`'s spreads of the fake pick
  up `ask` on their own: none needs an edit.
- `src/plugins/claude-code/manifest.ts`'s settings default becomes `{ command: '', profiles: [...], askModel: 'sonnet' }`.

Approach:
- `askClaude` settles once: a `settled` flag guards resolve and reject. The abort listener is added with
  `{ once: true }` after the spawn and removed on close. Its handler kills with `SIGKILL` and rejects at once, without
  waiting for the close.
- stdout and stderr gather as text until `closed`, as `runCli` does.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs `claude-ask.test.ts`,
`claude-code-harness.test.ts`, `start.test.ts` in `src/plugins/claude-code/main/`, `fake-agent-harness.test.ts`,
`chat-sessions.test.ts` and the seven chat page test files above. The live ask, a real `claude -p` reply, is
checked in 07 (Final verification).

Commit: one commit for the group, by pathspec, with no co-author trailer: "Add AgentHarness.ask with Claude Code's
isolated claude -p run and the askModel setting, and mint a summary target line on permission entries".

## Proof

