# 10 — Agents self-test

Status: not started
Type: Task
Wave: 5 · Depends on: 04, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/agents/main/selftest-script.ts` · modify `src/plugins/agents/main/start.ts`
Consumes:  `FAKE_AGENTS_TEXT = 'fake: agents'` in `src/shared/fake-agent-harness.ts` ← 04. Its pinned turn: the turn
           is held open with two running subagents (`wigley:sonnet-medium` / `Map the stream decoder`, `Explore` /
           `Find every Files adapter`), one tool call each; an interrupt sends `agentFinished` `failed` for each,
           then the Interrupted notice
           `chat.agentEvent` forwarding ← 05; the agents main part and its roster ← 08
           the page line `[agents] lines in <name>: <count>` from `src/plugins/agents/page/subagent-lines.ts` ← 09
           `ChatMainExports.launch(request: LaunchRequest): Promise<string>`, `SessionsMainExports.activate` (in the tree)
Produces:  in `src/plugins/agents/main/selftest-script.ts`:
           `export interface AgentsSelfTestDeps { homeDir: string; files: Pick<Files, 'makeFolder' | 'realPath'>; paths: Paths; chat: Pick<ChatMainExports, 'launch'>; sessions: Pick<SessionsMainExports, 'activate'> }`
           `export function agentsSelfTestScript(deps: AgentsSelfTestDeps): SelfTestScript;`
           the self-test group `subagent lines` and the screenshot `.selftest/screenshots/agents-subagent-lines.png`
Decisions:
- **Where the script is handed.** In `agentsMainPart.start`, run
  `services.selfTest?.run(agentsSelfTestScript({ homeDir, files, paths, chat: api.dependency<ChatMainExports>('chat'), sessions }))`,
  as chat's `start.ts` hands its script. Agents starts after chat, so its script runs after chat's, in plugin start
  order (AGENTS.md § Running and testing).
- **No collision with the peer plan.** `plan-activity-line` 08 changes chat's `selftest-script.ts` and adds
  `FAKE_STEPS_TEXT` to the fake. This task touches neither file: it has its own script, its own project folder and
  its own lines.
- **Fixture (`open(run)`).**
  - `made ??=` makes the folder `agents-selftest` under `files.realPath(homeDir)`, joined with `paths.join`, so the
    layer needs no `node:`. The folder is cleared on failure, as chat's `makeProjects` does.
  - It then calls `chat.launch({ projectDir, profile: 'work', message: { text: 'agents self-test', images: [] } })`
    and, once that resolves, `sessions.activate(sessionId)`.
  - `shownLine` is `[chat] Chat tab shown in agents-selftest`.
  - `result` is the launch-then-activate promise, so a refused launch fails the run.
  - The first message is plain, not `FAKE_AGENTS_TEXT`. This departs from the brief's "launch with
    `FAKE_AGENTS_TEXT`" because a step only matches lines logged after it starts (`selftest-runner.ts` marks the log
    before each step). A launch that spawns the subagents would log `lines in agents-selftest: 2` around the
    `shownLine`, before any step could wait for it. Sending the agents text by keys makes the line follow the step's
    own keys.
  - Each page load runs the script again and launches a new row in the same folder. The earlier run's row stays, with
    no lines after its interrupt. Agents cannot close a chat row: chat exports no close. The line's count changes
    only for the new row, so the waits stay exact.
- **Groups.** One group:
  - `name`: `subagent lines`
  - `why`: `A session whose agent spawns two subagents draws a line for each under its row (dot, type, description, elapsed, tool count), and an interrupt finishes them and the lines go.`

  | keys | expect | other fields |
  | --- | --- | --- |
  | `['i', ...FAKE_AGENTS_TEXT, 'Escape', 'Enter']` (chat's `sendKeys` shape, written locally) | `[agents] lines in agents-selftest: 2` | `checksFit: true`, `screenshot: 'subagent-lines'` |
  | `['<C-c>']` | `[agents] lines in agents-selftest: 0` | `why: 'Interrupt sends agentFinished for each running subagent, so the roster empties.'` |

- **Script fields**: `pageBinds: []` and `settings: {}`. `scrollsItself` is `['.agents-line-description']`: the
  description ends in an ellipsis inside its own box, as its CSS says (09). `problems` returns `[]`: the log file's
  content is `agent-log.test.ts`'s (08), and 12's drive run reads a real one.
- **Placement check**: the only new key is `<Leader>zla`, and leader sequences are left out of the
  `keys-check-placement` gate (AGENTS.md § Key hints), so no anchor step is added.

GIVEN the self-test's agents session showing its Chat tab WHEN `fake: agents` is sent by keys THEN
`[agents] lines in agents-selftest: 2` is logged and `agents-subagent-lines.png` is saved.
GIVEN the two lines WHEN `<C-c>` is pressed THEN `[agents] lines in agents-selftest: 0` is logged.

Tests:     no unit test: the script is fixture wiring, and the self-test runs it. The group's two steps are the proof.
Done when: compiles; `npm run lint` passes (the script imports no `node:` module, so `LAYERS` is unchanged); `npm run selftest` passes with group `agents: subagent lines`, and
           `.selftest/screenshots/agents-subagent-lines.png` exists (12 reads it against `DESIGN.md`)
Commit:    one commit for the group

## Proof
