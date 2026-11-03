# 03 — Session instructions through the harness

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-launch.ts` ·
           modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/contract.ts` ·
           modify `src/plugins/chat/main/start.ts` ·
           test `src/main/claude-code/claude-launch.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` ·
           test `src/plugins/chat/main/start.test.ts` ·
           modify (one field added to an `AgentStart` literal) `src/main/claude-code/claude-code-harness.test.ts`,
           `src/shared/fake-agent-harness.test.ts`
           (`src/shared/fake-agent-harness.ts` needs no edit: `FakeAgentProcessRecord.request` is the very `AgentStart`
           object `start` received, so `harness.processes[n].request.instructions` already records the instructions)
Consumes:  none
Produces:  `instructions: readonly string[];` on `AgentStart` in `src/contracts/agent.ts`
Produces:  `addInstructions(text: string): Disposable;` on `ChatMainExports` in `src/plugins/chat/contract.ts`
Produces:  `addInstructions(text: string): Disposable;` on `ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
Decisions: chat passes every registered instruction in `AgentStart.instructions`; the Claude Code adapter passes them
           as one `--append-system-prompt` value joined with a blank line; no other code names that flag (design
           review, round 3; plan.md § Boundary rules).
           Chat reads the registered instructions at each process start: a new session, a launch, a resume, a resting
           row's restart on send, and a `/clear` restart (brief; plan.md § Design Overview).
           A running process keeps the instructions it started with. A registration or a disposal applies from the
           next start (this task: a running CLI cannot take a new system prompt).
           Each `addInstructions` call is its own registration. The same text registered twice is two entries.
           Disposing one registration removes that registration only; a second `dispose` does nothing (this task).
           CLI fact, read from `claude --help` at plan time: `--system-prompt-snapshot` defaults to `on`, so the CLI
           records the system prompt, an `--append-system-prompt` included, on a conversation's first request, and a
           resume sends that record "even when a later launch passes different text, until the conversation is
           compacted". The adapter still passes the flag on every start, a resume included. Do not add
           `--system-prompt-snapshot` to the launch: the plan does not ask for it.
GIVEN no instructions WHEN `claudeLaunch` builds the args THEN they hold no `--append-system-prompt`
GIVEN instructions `A` and `B` WHEN `claudeLaunch` builds the args THEN they end with `--append-system-prompt`, `A\n\nB`
GIVEN two registered instructions WHEN a session starts THEN the harness start carries both, in registration order
GIVEN one registration disposed WHEN the row next starts (restart on send, `/clear`) THEN that text is absent and the
      others remain, and the earlier process's request still holds what it started with
GIVEN the chat main part WHEN `exports.addInstructions(text)` is called before a start THEN that start carries `text`
Tests:     `claudeLaunch_NewSession_PinnedArgsAndProfileEnv` — existing test; its request gains `instructions: []` and
           its pinned `args` list stays exactly as it is now. This is the empty case: no flag when the list is empty.
           Add `instructions: []` to every other `AgentStart` literal in the file (six literals in all, measured at
           plan time, re-verify).
Tests:     `claudeLaunch_Instructions_JoinIntoOneAppendedPrompt ($name)` — new `it.each` in `describe('claudeLaunch')`.
           Each row builds a new-session request with `controls: {}` and the row's `instructions`, then asserts that
           `--append-system-prompt` occurs exactly once in `launch.args`, and that the two args from it are
           `['--append-system-prompt', expected]`. Rows:
           | name | instructions | expected |
           |---|---|---|
           | `one instruction` | `['Use the wigley:visuals skill.']` | `'Use the wigley:visuals skill.'` |
           | `two instructions` | `['First note.', 'Second note.\nIts second line.']` | `'First note.\n\nSecond note.\nIts second line.'` |
           Breaks it catches: a flag per instruction, a join on `\n` or `' '`, a dropped instruction.
Tests:     `addInstructions_EachStartCarriesTheRegisteredOnes` — new test in `describe('createChatSessions')`, built on
           `setUp()`. Steps and assertions:
           1. `first = chat.addInstructions('first note')`, then `chat.addInstructions('second note')`.
           2. `chat.start({ projectDir: PROJECT_DIR, profile: 'personal' })`, `await flush()`. Assert
              `harness.processes[0].request.instructions` equals `['first note', 'second note']`.
           3. `first.dispose()` twice. Send `{ text: 'hi', images: [] }`, `await flush()`, end process 0 with
              `events.ended({ code: 0, error: null })`, then send `{ text: 'again', images: [] }` and `await flush()`
              (the resting row's restart). Assert `harness.processes[1].request.instructions` equals `['second note']`.
           4. `chat.addInstructions('third note')`, then `chat.clear(ROW_ID)`, `await flush()`. Assert
              `harness.processes[2].request.instructions` equals `['second note', 'third note']`.
           5. Assert `harness.processes[0].request.instructions` still equals `['first note', 'second note']`.
           Breaks it catches: a list read once at creation (step 3), a dispose that removes nothing or the wrong entry,
           a second dispose that removes another entry (`splice(indexOf(...), 1)` with `-1`), reversed order, and the
           live list passed by reference into a request (step 5).
Tests:     `start_opensTheSessionAndStartsTheHarness`, `resume_OpensWithHistoryAndResumesTheProcess` and
           `send_RestingRow_StartsProcessWithResumeFromSent` — existing tests; each exact `toEqual` on a started
           request gains `instructions: []` (three tests, measured at plan time, re-verify by searching the file for
           `process.request` and `.request).toEqual`). Assertions that use `toMatchObject` or read one field stay as
           they are.
Tests:     `exports_AddInstructions_ReachTheNextStart` — new test in `describe('chat main part')` in
           `src/plugins/chat/main/start.test.ts`. Change `startChatPart`'s fake harness `start` to take the request and
           push `request.instructions` into a new `startInstructions: (readonly string[])[]` array that
           `startChatPart` returns. The test calls `chat.exports.addInstructions('visual note')`, then
           `chat.invoke('start', { projectDir: '/p', profile: 'work' })`, and asserts `startInstructions` equals
           `[['visual note']]`. Break it catches: the export not wired to the sessions' registry.
Approach:  `AgentStart` gains, after `controls`, `instructions: readonly string[];`. Extend the comment above the
           interface: "`instructions` is text the session's agent is told before its first message, in the order its
           registrations were made; [] when none. Each adapter hands it to its harness in that harness's own way."
           `claudeLaunch`: after `effortArgs`, build `instructionArgs`: `[]` when `request.instructions` is empty,
           else `['--append-system-prompt', request.instructions.join('\n\n')]`. Spread it last in `args`. Add to the
           function's comment: "and the request's `instructions`, when there are any, as one `--append-system-prompt`
           joined with a blank line".
           `createChatSessions`: hold the registrations in one array of objects `{ text: string }`, one object per
           call. `addInstructions(text)` pushes a new object and returns a `Disposable` whose `dispose` removes that
           object by identity, and does nothing when it is already gone. `startProcess` is the one function that
           calls `harness.start` (one call site, measured at plan time, re-verify); it passes
           `instructions: registrations.map((registration) => registration.text)`, a new array on each start. Put the
           member on `ChatSessions` with the comment: "Registers `text` for every process start from now on, in
           registration order; a running process keeps what it started with. Disposing the registration drops it from
           later starts; a second dispose does nothing."
           `ChatMainExports` gains `addInstructions(text: string): Disposable;` with the comment: "Text every session
           chat starts from now on carries to its harness, after the texts registered before it; a running session
           keeps what it started with. Disposing it leaves later starts without it." `start.ts`'s `exports` adds
           `addInstructions: (text) => chat.addInstructions(text)`.
           Nothing outside `src/main/claude-code/` names `--append-system-prompt`.
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs
           `src/main/claude-code/claude-launch.test.ts`, `src/plugins/chat/main/chat-sessions.test.ts`,
           `src/plugins/chat/main/start.test.ts`, `src/main/claude-code/claude-code-harness.test.ts` and
           `src/shared/fake-agent-harness.test.ts`
Commit:    one commit for the group

## Proof

<empty — wigley:make writes it>
