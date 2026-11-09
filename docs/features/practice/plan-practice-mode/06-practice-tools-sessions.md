# 06 — Practice: tools, import and interviewer sessions

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 05
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/main/practice-tools.ts` · `src/plugins/practice/main/practice-sessions.ts` ·
           `src/plugins/practice/main/instructions.ts` · modify `src/plugins/practice/main/start.ts` ·
           test `src/plugins/practice/main/practice-tools.test.ts` · `src/plugins/practice/main/practice-sessions.test.ts` ·
           modify test `src/plugins/practice/main/start.test.ts` (05's)
Consumes:  `LaunchRequest.instructions?: readonly string[]`, `LaunchRequest.owner?: string`, the same two on
           `ResumeRequest`, `ChatMainExports.resume(request: ResumeRequest): Promise<string>` ← 02
           (`src/plugins/chat/contract.ts`); a resume for a host id chat already holds resolves that row's id (02).
           From 05: `ProblemStore` (with `writeBuildFile(relativePath, text): Promise<string>`), `Progress`, `Judge`,
           `JudgeCase`, `PracticeRuns.lastResult(slug): LastResult | null`, `Attempt`, `JudgeResult`, `CaseResult`, the
           `startImport`, `askInterviewer` and `interviewerOf` members of `PracticeChannel`. From 04: `parseProblem`,
           `problemJson`, `stubSource`, `ProblemError`, `Problem`.
           From the tree: `ChatMainExports.launch`, `defaultProfile`, `profileOf`, `send`, `close`
           (`src/plugins/chat/contract.ts` 506-570); `ChatMainEvents.sessionOpened`, `sessionClosed` and
           `sessionCleared` (`:464-486`); `chatMainKey` (`:572`); `Timers` (`src/contracts/ambient.ts` 16) and the
           bounded wait of `src/plugins/chat/main/tool-callers.ts` (`CALLER_WAIT_MS`), the precedent for `hostIdOf`;
           `SessionsMainExports.contributeTools` (`src/plugins/sessions/contract.ts` 217-221), `AgentSession`
           (`:150-153`: `id` the app's id, `info.sessionId` the host's), `ToolDefinition`, `ToolSession`,
           `textResult`, `errorResult` (`:88-147`), `sessionsMainKey` (`:302`); `QualifiedEvents`
           (`src/contracts/plugin.ts` 344); the tool pattern of `src/plugins/workflow/main/step-tool.ts` and
           `src/plugins/chat/main/start-session-tool.ts`.
Produces:
- `instructions.ts`: `INTERVIEWER_INSTRUCTIONS: string`, `IMPORT_INSTRUCTIONS: string` (texts below).
- `practice-tools.ts`: `ADD_PRACTICE_PROBLEM_TOOL: ToolDefinition`, `READ_PRACTICE_STATE_TOOL: ToolDefinition`;
  `interface PracticeToolsDeps { store: ProblemStore; progress: Progress; judge: Judge; lastResult(slug: string):
  LastResult | null; interviewerSlug(session: AgentSession): Promise<string | null>; log(line: string): void }`;
  `startPracticeTools(deps: PracticeToolsDeps): (session: AgentSession) => ToolSession`.
- `practice-sessions.ts`: `const HOST_ID_WAIT_MS = 2_000`; `interface PracticeSessionsDeps { chat:
  Pick<ChatMainExports, 'launch' | 'resume' | 'defaultProfile' | 'profileOf' | 'send' | 'close'>; store:
  ProblemStore; progress: Progress; files: Pick<Files, 'makeFolder'>; paths: Paths; timers: Timers; log(line:
  string): void }`; `interface PracticeSessions { startImport(request: string): Promise<string>;
  askInterviewer(slug: string, text: string): Promise<string>; interviewerOf(slug: string): Promise<string | null>;
  interviewerSlug(session: AgentSession): Promise<string | null>; opened(event: { sessionId: string; hostSessionId:
  string; projectDir: string }): void; closed(event: { sessionId: string }): void; cleared(event: { sessionId:
  string; newHostSessionId: string }): void }`; `createPracticeSessions(deps: PracticeSessionsDeps):
  PracticeSessions`.

Decisions:
- **Wiring in `start.ts`.** `PracticeApi` gains `Heard` = `QualifiedEvents<'chat', ChatMainEvents>`. `start` reads
  `chat = api.dependency(chatMainKey)` and `sessions = api.dependency(sessionsMainKey)`; builds `practiceSessions`
  with `timers: services.timers`; hears `chat.sessionOpened` → `practiceSessions.opened`, `chat.sessionClosed` →
  `practiceSessions.closed` and `chat.sessionCleared` → `practiceSessions.cleared`;
  handles `startImport`, `askInterviewer`, `interviewerOf`; and calls `sessions.contributeTools([
  ADD_PRACTICE_PROBLEM_TOOL, READ_PRACTICE_STATE_TOOL ], startPracticeTools({ …, lastResult: runs.lastResult,
  interviewerSlug: practiceSessions.interviewerSlug }))` once in `start`. No `mainAgentOnly`: a subagent of the import
  session may add problems.
- **Profile.** `startImport`, `askInterviewer` and the resume in `interviewerOf` each take `profile =
  chat.defaultProfile(null)`. When it is null, each rejects with `Chat has no profiles.` and launches or resumes
  nothing. Reason: `LaunchRequest.profile` and `ResumeRequest.profile` are a required `string`, so chat's `launch` has
  no path for "no profile"; `defaultProfile` is null only when chat has no profiles, and a launch would then reject
  with an unknown profile.
- **Import session** (design.md § Adding problems). `startImport(request)`:
  - `profile` as above.
  - `files.makeFolder(<folder>)`, since a launch needs the folder to exist.
  - `chat.launch({ projectDir: <folder>, profile, message: { text: request, images: [] }, instructions: [
    IMPORT_INSTRUCTIONS ] })`, no `owner`: it is an ordinary chat row in the Sessions side bar. Resolves the row id.
  - A blank request rejects with `Write what to add.` and launches nothing.
- **Interviewer** (design.md § The interviewer).
  - Its instructions are `<folder>/interviewer.md` when `store.interviewerText()` is non-null and not blank, else
    `INTERVIEWER_INSTRUCTIONS`, read at each launch and each resume.
  - Its title for a resume is `Interviewer: <problem title>`.
  - **The current attempt** is the last item of `(await progress.read(slug)).attempts` (`attempts.at(-1)`), the same
    rule as 05's `Progress`. With no attempt, `askInterviewer` rejects with `<slug> has no attempt; open it first.`
    and launches nothing (the page opens a problem before its ask box shows), and `interviewerOf` resolves null.
  - `askInterviewer(slug, text)`:
    - When the current attempt has an interviewer: `interviewerOf(slug)` (which resumes a gone row), then
      `chat.send(id, { text, images: [] })`; resolves the id. Reason: the page sends later messages through the
      mounted chat view, but a second `askInterviewer` (two quick sends before the pane swaps) must not start a second
      session.
    - Else: `chat.launch({ projectDir: <folder>, profile, message: { text, images: [] }, instructions:
      [<instructions>], owner: 'practice' })`; then the host id from `hostIdOf(id)` (below); then
      `progress.setInterviewer(slug, attempt.id, { sessionId: id, hostSessionId })`; resolves the id. Talking to the
      interviewer does not set `peeked` (design.md).
    - After that store, the old interviewer closes: for the latest earlier attempt whose `interviewer` is non-null,
      when `chat.profileOf(<its sessionId>) !== null`, it calls `chat.close(<its sessionId>, 'finished')`. A close that
      rejects is logged as `old interviewer <id> not closed: <reason>` and does not fail the call. Reason: design.md
      § The interviewer gives each attempt its own interviewer, and a row with an owner has no Sessions row, so the
      user has no way to close the old one; left open it stays in chat main and in chat's saved record. Its
      conversation stays in the harness's saved sessions.
  - `interviewerOf(slug)`: null when there is no current attempt or the current attempt has no interviewer. When
    `chat.profileOf(sessionId) !== null`, chat still holds the row: resolves `sessionId`. Else `chat.resume({
    projectDir: <folder>, profile, hostSessionId, title, instructions: [<instructions>], owner: 'practice' })`; when
    the resolved id differs, `setInterviewer` stores it with the same host id; resolves it. Concurrent calls for one
    slug share one pending promise (a `Map<slug, Promise>` cleared when it settles), so two calls never resume twice.
  - **Host id.** `opened(event)` keeps `sessionId → hostSessionId` in a map, for events whose `projectDir` is the
    practice folder (`paths.samePath`). `hostIdOf(id)` takes the entry for `id` and deletes it. When the map has no
    entry, it waits up to `HOST_ID_WAIT_MS` (through `timers`, as `tool-callers.ts` waits `CALLER_WAIT_MS`) for an
    `opened` with that id. When the wait ends with no event, `askInterviewer` calls `chat.close(id, 'finished')` and
    rejects with `Chat sent no sessionOpened for interviewer <id>.`; nothing is stored. Reason, read from the tree:
    chat's `openRow` emits `sessionOpened` inside `launch`, and listeners run before `emit` returns
    (`src/contracts/plugin.ts` 354), so the entry is normally in the map when `launch` resolves. Chat fires no
    `sessionOpened` for a row whose profile is not in its profiles setting (contract.ts 441-445); the bounded wait
    turns that case into an error instead of a hang.
  - `closed(event)` (`chat.sessionClosed`) deletes the event's `sessionId` from the map. With `hostIdOf`'s delete,
    the map holds only rows that are open and not yet read (an import session, a resumed interviewer).
  - `cleared(event)` (the user ran `/clear` in the interviewer): finds the attempt whose interviewer has that
    `sessionId` and stores `newHostSessionId`, so a later resume brings back the cleared conversation.
  - `interviewerSlug(session)`: at call time, scans every slug's progress (`store.slugs()`, `progress.read`) and
    returns the slug whose current attempt's interviewer has `sessionId === session.id` or `hostSessionId ===
    session.info.sessionId`; else null. A progress file that fails to read is skipped. Reason: design.md § Seams —
    the tool list is global, so the check runs at call time; an old attempt's interviewer no longer sees the screen.
- **`add_practice_problem`** (design.md § Adding problems). Arguments: `slug`, `title`, `difficulty`, `tags`, `lists`,
  `compare`, `signature`, `cases` (the `problem.json` fields of 04, same types and defaults), `statement` (Markdown),
  `reference` (C++), `approach` (Markdown), `replace` (boolean, default false). The `inputSchema` declares each with
  its JSON type and a one-line description; `required`: `slug`, `title`, `difficulty`, `signature`, `cases`,
  `statement`, `reference`, `approach`; `additionalProperties: false`. The steps, each refusal an `errorResult` that
  starts `Refused: ` and writes nothing:
  "Writes nothing" means nothing under `problems/<slug>/`: only step 4 writes, and only under `<folder>/.build/`.
  1. `statement`, `reference`, `approach` are non-blank strings, else `Refused: <name> must be a non-empty string.`
  2. `parseProblem({ title, difficulty, tags, lists, compare, signature, cases }, slug)` (absent fields left out); a
     `ProblemError` → `Refused: <message>` (the field and reason).
  3. `store.hasProblem(slug)` and `replace` not true → `Refused: <slug> exists. Set replace: true to rewrite its
     problem.json, problem.md, reference.cpp and approach.md.`
  4. `path = await store.writeBuildFile('<slug>/import/reference.cpp', reference)` (05), then `judge.judge(problem,
     path, <every
     case as a JudgeCase, source 'example' for visible and 'hidden' otherwise>, { stopAtFirstFailure: false })`.
     - `compileError` → `Refused: reference.cpp does not compile:\n<compileOutput>` (the output reads
       `reference.cpp:<line>:<col>`, 04's base-name rewrite).
     - Any failing case → `Refused: reference.cpp disagrees with <n> of <total> cases. Fix each case or the
       reference, then call again.` and one line per failing case: `- case <index + 1> (<visible|hidden>): input
       <JSON>, expected <JSON>, got <JSON>` for `wrongAnswer`; `- case <index + 1> (…): Time Limit Exceeded` or
       `Runtime Error: <first non-empty stderr line>`. JSON values are cut to 200 characters with `…`.
  5. On success writes, through `store.writeText`: `problem.json` = `problemJson(problem)`, `problem.md` =
     `statement`, `reference.cpp`, `approach.md`; and `solution.cpp` = `stubSource(problem)` when `replace` is not
     true or no `solution.cpp` exists. `replace` keeps `solution.cpp`, `notes.md`, `custom-cases.json`,
     `progress.json` and `submissions/` (design.md). The store's watch sends `changed`, so the list refreshes.
  6. `textResult('Added <slug> (<title>): <total> cases; reference.cpp passes every one.')`, `Replaced` in place of
     `Added` on a replace.
- **`read_practice_state`** (design.md § The interviewer). No arguments (`inputSchema` `{ type: 'object',
  properties: {}, additionalProperties: false }`). `interviewerSlug(session)` null → `errorResult('read_practice_state
  answers only a Practice interviewer session.')`. Else a `textResult` in Markdown, in this order:
  `# <title> (<difficulty>)`; `## Statement` and `problem.md`; `## Signature` and `stubSource(problem)` in a `cpp`
  fence; `## Current code` and `solution.cpp` in a `cpp` fence (`(empty)` when missing); `## Last result` and either
  `None since the app started.` or `<Run|Submit>: <verdict name>, <passed>/<total> passed, <ms> ms`, then for a
  compile error the `compileOutput` in a fence, else for the failing case its input, expected, output, stdout and (on
  a Runtime Error) stderr as JSON lines; `## Attempt` and `Started <started>. Solution tab opened: <yes|no>.
  Submissions in this attempt: <n>.`, the attempt being the current one (`attempts.at(-1)`) and `<n>` the count of
  `store.submissions(slug)` with `time >= attempt.started` (ISO 8601 strings compare in time order). Verdict names are LeetCode's: `Accepted`, `Wrong Answer`, `Time Limit Exceeded`,
  `Runtime Error`, `Compile Error`. It never includes `reference.cpp` or `approach.md`.
- **Unknown tool name** in a tool session rejects with `no practice tool "<name>"`, as `step-tool.ts` 78-80.
- **Built-in texts.** `instructions.ts` holds these two texts verbatim (template literals, no interpolation).

  `INTERVIEWER_INSTRUCTIONS`:

  ```text
  You are the interviewer in Practice, an app where the user solves LeetCode-style problems in C++. The user is working on one problem now and talks to you while they work.

  Call read_practice_state before every reply. It returns the problem statement, the signature, the user's current code, the last Run or Submit result and the state of the attempt. Never ask the user to paste their code.

  Answer questions about the problem's setup directly: what the input means, what a constraint allows, what an example shows, what format the answer takes, and what a C++ standard library call does.

  For every other question, ask one guiding question back that moves the user one step forward: what they notice about the input, which small case breaks their idea, what their code does on a small example, what their loop costs.

  Never give the solution, a part of it, or pseudocode for it. Never name the algorithm or the data structure that solves the problem. Never say which line is wrong or what the bug is. When the user asks for the answer, say that you will not give it, and ask a question that helps them find it.

  Let the user fail. Do not warn them before they Run or Submit. After a failing result, ask what the failing case shows instead of explaining it.

  When the last result is Accepted, ask about the time and space complexity, and about an edge case they did not test.

  Keep each reply to two to four sentences, with at most one question. Do not create or edit files, and do not run commands.
  ```

  `IMPORT_INSTRUCTIONS`:

  ```text
  You add problems to Practice, an app where the user solves LeetCode-style problems in C++. You add each problem with the add_practice_problem tool. Do not write files in this folder yourself: the tool writes them.

  The user names the problems: by title, by list (for example "the Blind 75 graph problems") or by topic. For each problem:

  1. slug: LeetCode's slug, lowercase words joined by "-" (two-sum). title, difficulty ("easy", "medium" or "hard"), tags (LeetCode's topic tags, lowercase, for example ["array", "hash table"]) and lists (each list the user named that holds the problem, for example ["Blind 75"]).

  2. statement: Markdown with the description, each example with its input, output and explanation, and the constraints, as LeetCode shows them. Keep every number in the constraints.

  3. signature: the C++ signature LeetCode uses.
     - A function problem: {"kind": "function", "method": "twoSum", "params": [{"name": "nums", "type": "vector<int>"}, {"name": "target", "type": "int"}], "returns": "vector<int>"}. The user writes class Solution with that one public method.
     - A design problem (LRU Cache, Min Stack): {"kind": "design", "className": "LRUCache", "constructor": [{"name": "capacity", "type": "int"}], "methods": [{"name": "get", "params": [{"name": "key", "type": "int"}], "returns": "int"}, {"name": "put", "params": [{"name": "key", "type": "int"}, {"name": "value", "type": "int"}], "returns": "void"}]}.
     - The supported types are int, long long, double, bool, char, string, vector<T> of any of these (nested to any depth, for example vector<vector<int>>), ListNode* and TreeNode*. void is only a design method's return type. The tool refuses every other type, and a function that returns void. Skip such a problem and tell the user which one and why.

  4. cases, in LeetCode's JSON form:
     - A function case: {"input": [<one value per parameter, in order>], "expected": <the return value>, "visible": true}.
     - A design case: {"ops": ["LRUCache", "put", "get"], "args": [[2], [1, 1], [1]], "expected": [null, null, 1], "visible": false}. The first op is the class name and its args are the constructor's. expected holds null for the constructor and for each void call.
     - ListNode* is the array of the list's values: [1, 2, 3]. An empty list is [].
     - TreeNode* is LeetCode's level order, with null for a missing child: [3, 9, 20, null, null, 15, 7]. An empty tree is [].
     - char is a one-character string: "a". long long values stay within ±9007199254740991.
     - Mark LeetCode's examples "visible": true; Run uses them. Add at least 10 hidden cases ("visible": false) that cover the edges: the smallest input, the largest values the constraints allow, duplicates, negative numbers, and empty inputs where the constraints allow them.

  5. compare: how the user's answer is checked.
     - "exact" (the default): the answer must equal expected.
     - "anyOrder": the problem accepts the answer's list in any order.
     - "anyOrderDeep": the order inside each inner list and the order of the outer list do not matter (Group Anagrams).
     - "float": numbers match within 1e-5, absolute or relative.
     anyOrder and anyOrderDeep apply to a function problem only.

  6. reference: a correct, complete C++ solution with the same signature. It compiles as the user's code does: every standard header is included, "using namespace std;" is in effect, and ListNode and TreeNode are defined as LeetCode defines them. Do not define them again.

  7. approach: Markdown that explains the idea, the steps, and the time and space complexity.

  Call add_practice_problem once for each problem. It compiles reference and runs it on every case. When it refuses, read each field or failing case it names, fix the case, the expected answer, the signature or the reference, and call it again. Change an expected answer only when you checked by hand that it was wrong.

  A slug that already exists is refused. Set "replace": true only when the user asked you to fix or redo that problem: it rewrites problem.json, problem.md, reference.cpp and approach.md, and keeps the user's own code, notes, test cases, progress and submissions.

  When you are done, reply with one line per problem: its slug, then "added", "replaced" or "skipped: <reason>".
  ```

GIVEN a session that is no interviewer WHEN it calls `read_practice_state` THEN it gets an error result and no state.
GIVEN the current attempt's interviewer session WHEN it calls `read_practice_state` THEN the text holds the statement,
the current code and the last Run result, and no `reference.cpp`.
GIVEN a reference that fails cases 3 and 7 WHEN `add_practice_problem` is called THEN it refuses naming case 3 and case
7, and no file under `problems/<slug>/` exists.
GIVEN an existing slug with user code and notes WHEN `add_practice_problem` is called with `replace: true` THEN the
four import files change and `solution.cpp`, `notes.md` and `progress.json` stay.
GIVEN an attempt with no interviewer WHEN `askInterviewer` is invoked THEN chat launches in the practice folder with
`owner: 'practice'` and the interviewer instructions, and the attempt stores the row id and the host id.
GIVEN an attempt whose interviewer row is gone WHEN `interviewerOf` is invoked THEN chat resumes its host id with the
same owner and instructions, and the attempt stores the new row id.

Tests:
- `practice-tools.test.ts` (memory files, the real `createProblemStore` and `createProgress` of 05, a judge double
  returning a scripted `JudgeResult`, `interviewerSlug` a double):
  - `add_practice_problem refuses and writes nothing` — `it.each` rows `{ args, judged, text }`: `statement` `''` →
    names `statement`; a param type `unsigned` → names `signature.params[0].type`; an existing slug without `replace`
    → names the slug and `replace`; the judge's result `compileError` → holds `reference.cpp does not compile`; the
    judge failing cases at index 2 (`wrongAnswer`) and 6 (`runtimeError`, stderr `\nboom`) → holds `case 3
    (hidden)` and `case 7 (hidden): Runtime Error: boom`. Every row: `isError` true and no `problem.json` written for
    a new slug. Catches a check skipped and a write before the reference check.
  - `add_practice_problem writes the problem and a stub` — a passing judge → the four files and `solution.cpp` equal
    to `stubSource(problem)`; the judge received every case with `stopAtFirstFailure` false.
  - `replace keeps the user's files` — existing `solution.cpp` `mine`, `notes.md` `n`, `progress.json` → after
    `replace: true` they are unchanged and `problem.md` holds the new statement.
  - `read_practice_state answers only an interviewer` — rows: `interviewerSlug` null → `isError` true; `two-sum`
    with a kept last result (`wrongAnswer`, failing input `[[3,3],6]`) → the text holds the statement, the code
    `mine`, `Wrong Answer` and `[[3,3],6]`, and does not hold the reference's text. Catches the guard dropped and the
    reference leaked to the interviewer.
- `practice-sessions.test.ts` (memory files, the real store and progress, a chat double recording each `launch`,
  `resume` and `send` and returning ids `row-1`, `row-2`, …, `profileOf` answering from a set the test controls):
  - `startImport launches a visible session with the import instructions` — the request has `projectDir`
    `/home/u/leetcode`, `profile` the default, `message.text` the request, `instructions` `[IMPORT_INSTRUCTIONS]`,
    and no `owner`.
  - `askInterviewer launches an owned session and stores it` — rows: no `interviewer.md` → `instructions`
    `[INTERVIEWER_INSTRUCTIONS]`; `interviewer.md` `Be terse.` → `['Be terse.']`. Each: `owner: 'practice'`, the
    attempt's `interviewer` `{ sessionId: 'row-1', hostSessionId: 'host-1' }` after the test calls `opened({
    sessionId: 'row-1', hostSessionId: 'host-1', projectDir: '/home/u/leetcode' })` — once before `launch` resolves
    and once after (two rows). Catches the folder file ignored and a host id lost to event order.
  - `askInterviewer sends to an existing interviewer` — a second call → one `launch` in total and one `send` to
    `row-1`.
  - `askInterviewer refuses without a host id, a profile or an attempt` — `it.each` rows: no `opened` for `row-1`
    and the fake timers run past `HOST_ID_WAIT_MS` → rejects naming `row-1`, `close('row-1', 'finished')` recorded,
    the attempt's `interviewer` still null; `defaultProfile` null → rejects `Chat has no profiles.`, no `launch`; a
    problem with no attempt → rejects naming the slug, no `launch`. Catches a launch that hangs on a lost event and a
    launch with no profile.
  - `askInterviewer on a new attempt closes the old interviewer` — attempt 1 holds `row-1` (`profileOf` non-null),
    attempt 2 has none: one `launch`, then `close('row-1', 'finished')`; with `row-1` not held → no `close`.
    Catches hidden rows that pile up in chat across attempts.
  - `interviewerOf brings the interviewer back` — rows: no interviewer → null, no resume; row held (`profileOf` non-null)
    → `row-1`, no resume; row gone → one `resume` with `hostSessionId: 'host-1'`, `owner: 'practice'`, the
    instructions and `title: 'Interviewer: Two Sum'`, and the attempt then stores the resumed id; two calls at once
    with the row gone → one `resume`. Catches a resume per call and an owner left off.
  - `cleared moves the stored host id` — `cleared({ sessionId: 'row-1', newHostSessionId: 'host-2' })` → the attempt
    holds `host-2`.
  - `interviewerSlug matches the current attempt only` — rows: `session.id` `row-1` → `two-sum`; `info.sessionId`
    `host-1` with another `id` → `two-sum`; an id held by an older attempt → null; any other → null.
- `start.test.ts` (05's file; its `startMainPart` harness with `fakeDependency(chatMainKey, …)` and
  `fakeDependency(sessionsMainKey, …)`): one test, `start wires the tools and hears chat`, proves 06's `start.ts`
  wiring. The sessions double records `contributeTools` calls; the chat double records `launch`. Assert: one
  `contributeTools` call whose tool names are `add_practice_problem` and `read_practice_state`; after the harness
  emits `chat.sessionOpened` for `row-1` in `/home/u/leetcode` with host `host-1`, invoking `askInterviewer` on an
  opened problem stores `{ sessionId: 'row-1', hostSessionId: 'host-1' }` in `progress.json` (the double's `launch`
  resolves `row-1`). Catches a tool contribution or an event subscription left out of `start`. The live path (a real
  chat launch) is 10's self-test.

Done when: `npm run typecheck` passes, `npm run lint` passes, and the test gate runs `practice-tools.test.ts`,
`practice-sessions.test.ts` and `start.test.ts`, all green.
Commit:    one commit for the group

## Proof
