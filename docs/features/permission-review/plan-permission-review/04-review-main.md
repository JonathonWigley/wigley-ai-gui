# 04 — permission-review main: watcher, ask, reviews slot

Status: in progress
Type: Task
Rung: deep · crosses chat, forms, sessions and the harness registry through async asks, a 60 s timeout, aborts on key removal and session end, and a restart
Wave: 2 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/permission-review/manifest.ts`
- create `src/plugins/permission-review/contract.ts`
- create `src/plugins/permission-review/main/start.ts`
- create `src/plugins/permission-review/main/review-requests.ts`
- create `src/plugins/permission-review/main/review-prompt.ts`
- create `src/plugins/permission-review/main/demo-steps.ts`
- create `src/plugins/permission-review/main/selftest-script.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`
- test `src/plugins/permission-review/main/start.test.ts`
- test `src/plugins/permission-review/main/review-prompt.test.ts`

Consumes:
- `AgentAsk`, `AgentHarness.ask(request: AgentAsk): Promise<string>` ← 01
- `FAKE_ASK_REPLY`, `FakeAgentHarness.failNextAsk(message: string): void` ← 01 (`setAskReply` is not needed here)
- `ConfirmSubject`, `OpenConfirm`, `formsConfirmsSlot` ← 03
- In the tree: `chatEntriesSlot`, `chatSessionSlot`, `ChatSessionInfo`, `chatMainKey`,
  `ChatMainExports['defaultProfile' | 'launch' | 'closeSessionsIn']` (`src/plugins/chat/contract.ts`) ·
  `sessionsMainKey`, `SessionsMainEvents` (`ended: { sessionId: string }`), `SessionsMainExports['label' | 'activate']`
  (`src/plugins/sessions/contract.ts`) · `coreAgentHarnessesSlot` (`src/contracts/core-state.ts`) ·
  `registeredProfiles` (`src/shared/harness-profiles.ts`) · `isFakeAgentHarness`, `FAKE_PERMISSION_TEXT`,
  `FakeAgentHarness.askPermission` (`src/shared/fake-agent-harness.ts`) · `errorText` (`src/shared/error-text.ts`) ·
  `services.agentHarnesses.get`, `services.timers.set/clear`, `services.log`, `services.demoSteps.register`,
  `services.selfTest` (`src/contracts/plugin.ts`)

Produces:
- `src/plugins/permission-review/contract.ts`, exactly as plan.md gives it: `ReviewVerdict`, `ReviewRisk`, `Review`,
  `permissionReviewsSlot` (`id: 'permission-review.reviews'`, `process: 'main'`, `kind: 'keyed'`),
  `chatReviewKey(sessionId: string, entryId: string): string` returning `` `${sessionId}/${entryId}` `` and
  `confirmReviewKey(roundId: string): string` returning `` `confirm/${roundId}` ``.
- `export const permissionReviewManifest` in `manifest.ts`.
- `export const permissionReviewMainPart: MainPart<typeof permissionReviewManifest>` in `main/start.ts`.
- In `main/review-prompt.ts`:
  - `export interface ReviewSubject { toolName: string; input: unknown; projectDir: string | null; }`
  - `export const REVIEW_INSTRUCTIONS: string`
  - `export const REVIEW_INPUT_LIMIT = 50_000`
  - `export function reviewPrompt(subject: ReviewSubject): string`
  - `export function parseReviewReply(text: string): Review`
- In `main/review-requests.ts`:
  - `export const REVIEW_TIMEOUT_MS = 60_000`
  - `export type Reviewer = { harness: AgentHarness; profileDir: string; projectDir: string | null } | { reason: string }`
  - `export function findReviewer(sessionId: string, deps: ReviewerDeps): Reviewer`, where `ReviewerDeps` is
    `{ chatSessions: Pick<KeyedSlotReader<ChatSessionInfo>, 'get'>; harnessInfos: Pick<KeyedSlotReader<AgentHarnessInfo>, 'get' | 'all'>; harnesses: Pick<AgentHarnessRegistry, 'get'>; defaultProfile: ChatMainExports['defaultProfile'] }`
  - `export function watchReviewRequests(deps: ReviewRequestDeps): { forgetSession(sessionId: string): void } & Disposable`,
    where `ReviewRequestDeps` is `ReviewerDeps` with `chatSessions` widened to `Pick<KeyedSlotReader<ChatSessionInfo>,
    'get' | 'all'>`, plus `chatEntries: Pick<ListSlotReader<ChatEntry>, 'get' | 'on'>`, `confirms:
    Pick<KeyedSlotReader<OpenConfirm>, 'all' | 'on'>`, `reviews: KeyedSlotWriter<Review>`, `label:
    SessionsMainExports['label']`, `timers: Pick<Timers, 'set' | 'clear'>` (`src/contracts/ambient.ts`) and
    `log(line: string): void`. The slot reader and writer types are `src/contracts/state.ts`'s.
- `export function registerDemoSteps(services: MainServices): Disposable` in `main/demo-steps.ts`, step id
  `permission-review.verdict`.
- `export function permissionReviewSelfTestScript(deps: PermissionReviewSelfTestDeps): SelfTestScript` in
  `main/selftest-script.ts`.

Decisions:
- **Manifest** (`manifest.ts`), modelled on `src/plugins/context-sources/manifest.ts`:
  - `id: 'permission-review'`, `label: 'Permission review'`
  - `description: 'Reviews each approval with a separate model: a one-line summary and an approve-or-deny verdict on the card.'`
  - `dependsOn: { main: ['chat', 'forms', 'sessions'], page: ['chat', 'forms'] }`
  - `reads: { main: [], page: [] }`. `reads` names plugin ids whose contracts a process imports without a start order
    (`scripts/layer-rules.mts` adds both lists to the import rule). Chat, forms and sessions are already in `dependsOn`,
    so no id belongs in `reads`. `core.agentHarnesses` is a core slot from `src/contracts`.
  - `commands: {}`, `scopes: {}`, `settings: { layout: 'default' }`, `settingControls: { layout: 'layout' }`
  - `settingInfo.layout`: `label: 'Layout'`, `description: "The permission-review layout the verdict on a permission card and a confirm round draws in: a folder name in permission-review's layouts folder, or default."`
  - no `demoSkip`, no `themeTokens`. A comment above the call says what main and page do, as context-sources' does.
- **Registration.** `permissionReviewManifest` goes into `builtInManifests` in `src/plugins/manifests.ts` right after
  `contextSourcesManifest`. `permissionReviewMainPart` goes into `mainParts` in `src/plugins/main.ts` right after
  `contextSourcesMainPart`. Both imports are in alphabetical order with the neighbouring imports. `page.ts` is 05's.
- **Layouts are 05's.** `layouts/layout.d.ts` is 05's file, so this task's `start.ts` registers no layouts. 05 adds
  `api.layouts.register({ layoutTypes })` to `main/start.ts`, as context-sources' main does.
- **`main/start.ts`** types its api as
  `MainApi<typeof permissionReviewManifest, ChannelShape, Record<never, never>, QualifiedEvents<'sessions', SessionsMainEvents>>`.
  It:
  1. publishes `permissionReviewsSlot`
  2. reads `chatEntriesSlot`, `chatSessionSlot`, `formsConfirmsSlot` and `coreAgentHarnessesSlot` through `api.state.read`
  3. takes `chat` and `sessions` through `api.dependency(chatMainKey)` and `api.dependency(sessionsMainKey)`
  4. starts `watchReviewRequests` over them, with `services.agentHarnesses`, `services.timers` and `services.log`
  5. calls `watcher.forgetSession(sessionId)` on `sessions.ended`
  6. calls `registerDemoSteps(services)` and hands `services.selfTest?.run(permissionReviewSelfTestScript(…))`
  7. returns `{ commands: {}, dispose: () => watcher.dispose() }`
- **The chat source.** The watcher listens with `chatEntries.on((sessionId, change) => …)`. Only a
  `change.kind === 'put'` whose item has `kind === 'permission'` and `answer === null`, and whose
  `chatReviewKey(sessionId, item.id)` the watcher has not seen, starts a review. The key is marked seen at once. A put
  with an answer, a repeat put of a seen id, a `replace` and a `delete` start none. The subject is
  `{ toolName: item.toolName, input: item.input, projectDir }`.
- **An answer leaves the review running.** A put with an answer under a key under review changes nothing: the ask
  runs to its end and the verdict shows on the answered card, as design.md § The card has it.
- **A `replace` drops the reviews it leaves behind.** On a `replace` (a `/clear`, a history restore), every review of
  that session whose entry id is not among the replacement's items is aborted when running, deleted and forgotten.
  Reviews of entries the replacement still holds stay.
- **The confirm source.** The watcher listens with `confirms.on((roundId, value) => …)`. A defined value under an
  unseen `confirmReviewKey(roundId)` starts a review with subject `{ toolName: value.subject.toolName, input:
  value.subject.input, projectDir }`, for the session `value.sessionId`. A defined value under a seen key starts none
  (forms sets the key again on a draft re-show). An `undefined` value (the round left `forms.confirms`) aborts that
  key's running review, deletes its review, and forgets the key.
- **Finding the reviewer** (`findReviewer`), by the session the request came from:
  - When `chatSessions.get(sessionId)` holds the session:
    - harness id and profile name are its `harness` and `profile`, and `projectDir` is its `projectDir`
    - `harnesses.get(harness)` null → `{ reason: 'no agent harness "<harness>"' }`
    - no profile of that name in `harnessInfos.get(harness)?.profiles` → `{ reason: 'no profile "<profile>"' }`
  - Otherwise (a confirm whose caller chat does not own, such as a terminal session):
    - the name is `defaultProfile(sessionId)`, and null → `{ reason: 'no profile to review with' }`
    - the profile is the first of `registeredProfiles(harnessInfos.all())` with that name, and none →
      `{ reason: 'no profile "<name>"' }`
    - its `harnessId` with `harnesses.get` null → `{ reason: 'no agent harness "<harnessId>"' }`
    - `projectDir` is null
  - On success, `profileDir` is the profile's `configDir` as published, `~/` unexpanded. `AgentAsk.profileDir` takes
    it as `AgentStart.profileDir` does, and the adapter resolves it.
  - chat's `chat/main/lookups.ts` helpers (`requireProfile`, `harnessOfProfile`) live in chat's `main/`, which another
    plugin may not import. `registeredProfiles` in `src/shared/harness-profiles.ts` is the shared export reused. Every
    profile is searched, unlisted harnesses included, since the demo's harness runs sessions too.
- **One review** under key `key`, for subject `subject` and session `sessionId`:
  1. `reviews.set(key, { state: 'reviewing' })`.
  2. `findReviewer(sessionId, …)`. On a `reason`, finish unavailable with it.
  3. Make an `AbortController`. Set a `timers.set(…, REVIEW_TIMEOUT_MS)` that marks the review timed out and aborts.
  4. Call `harness.ask({ profileDir, instructions: REVIEW_INSTRUCTIONS, prompt: reviewPrompt(subject), signal })`.
  5. Resolve: `parseReviewReply(text)`. Write it and log it.
  6. Reject: timed out → `the review took longer than 60 s`. Otherwise → `errorText(error)`.
  7. Clear the timer on every settle.
  - A review aborted by its key's removal, by `forgetSession` or by `dispose` writes nothing and logs nothing once
    aborted, so a stopped part never writes after its writer's dispose.
  - Reviews run at once, with no queue.
- **Session name in the logs**: `sessions.label(sessionId) ?? sessionId`, the side-bar label other plugins' lines
  use (the project folder's name for a folder's first row).
- **Log lines**, through `services.log`, which prints them under the plugin's id as `[permission-review] …`:
  - done: `` `reviewed ${subject.toolName} in ${name}: ${review.verdict} · ${review.risk}` ``
  - unavailable: `` `review unavailable for ${subject.toolName} in ${name}: ${review.reason}` ``
- **Unavailable reasons**, verbatim:
  - no harness: `no agent harness "<id>"`
  - no profile: `no profile "<name>"`, or `no profile to review with` when chat names no default
  - timeout: `the review took longer than 60 s`
  - ask rejected: the rejection's `errorText`, such as `fake ask failed`
  - bad reply: `the reviewer's reply was not the expected JSON`
- **`forgetSession(sessionId)`**: aborts and deletes every review whose key starts with `` `${sessionId}/` `` and
  forgets those keys. Confirm reviews are left to their round's removal from `forms.confirms`.
- **Start and restart.** A stopped part's slot keeps its values for the next publish, including `reviewing` entries
  whose asks were aborted. At start, the watcher:
  1. deletes every held review whose state is `reviewing`
  2. deletes every held review whose request is gone: a chat key whose session is not in `chatSessions.all()` or
     whose entry id is not a `permission` entry in `chatEntries.get(sessionId)`, and a `confirm/<id>` key with no
     `<id>` in `confirms.all()`. A session that ended or a round that closed while the part was off so leaves nothing.
  3. marks every key that still holds a review as seen
  4. starts a review for each request already waiting with no held review: each unanswered `permission` entry in
     `chatEntries.get(sessionId)` for every `sessionId` in `chatSessions.all()`, and each key in `confirms.all()`
  So a switch-off and switch-on, or a restart, reviews the cards still open. `dispose` aborts every running review.
- **`main/review-prompt.ts`.** `REVIEW_INSTRUCTIONS` is these lines joined with `\n`, verbatim:

  ```
  You review one tool call that an AI coding agent wants to make, for its security risk.
  You see only the call: the tool's name, its input and the project folder the agent works in.
  You do not see the conversation, the agent's reasons or its instructions, so judge only what the call itself would do.
  Approve when the call is routine and its effects stay contained: reading files, editing files inside the project folder, running the project's own builds and tests.
  Deny when the call could destroy data, leak secrets or credentials, reach the network in a way the work does not plainly need, escalate privileges, or act outside the project folder.
  Risk is how much harm the call could do if it went wrong: low, medium or high.
  Reply with one JSON object and nothing else:
  {"summary": "<one or two plain sentences on what the call does>", "verdict": "approve" or "deny", "risk": "low", "medium" or "high"}
  ```

  `reviewPrompt(subject)`:
  - `json` is `JSON.stringify(subject.input ?? null, null, 2)`.
  - The prompt is these lines joined with `\n`: `` `Tool: ${toolName}` ``,
    `` `Project folder: ${projectDir ?? 'none'}` ``, `Input:`, `` ```json ``, the first `REVIEW_INPUT_LIMIT`
    characters of `json`, and `` ``` ``.
  - When `json.length > REVIEW_INPUT_LIMIT`, one more line follows:
    `` `The input above is cut to its first 50000 of ${json.length} characters.` ``
  `parseReviewReply(text)`:
  - Take `text` from its first `{` to its last `}` inclusive, and `JSON.parse` it.
  - Accept a non-array object whose `summary` is a string that is not empty after trimming, `verdict` is `approve` or
    `deny`, and `risk` is `low`, `medium` or `high`. Return
    `{ state: 'done', summary: summary.trim(), verdict, risk }` and ignore other fields.
  - Anything else returns `{ state: 'unavailable', reason: "the reviewer's reply was not the expected JSON" }`: no
    braces, a parse error, a missing or wrong field. It never throws.
- **Demo step, main half** (`main/demo-steps.ts`), in the shape of context-sources' `main/demo-steps.ts`:
  `services.demoSteps.register({ id: 'permission-review.verdict', async enter(context) { const session = await
  context.launchSession(FAKE_PERMISSION_TEXT); return { sessions: { session }, dispose() {} }; } })`.
  - The demo runs on its own fake harness: `demo/main/demo-run.ts` registers a `createFakeAgentHarness` under
    `DEMO_HARNESS_ID` with the profile `DEMO_PROFILE`, so `findReviewer` resolves it.
  - Its `ask` answers `FAKE_ASK_REPLY`, and the card shows `Deny · medium risk` with no model spawned.
  - The page half is 05's: the same id `permission-review.verdict`, `section: 'sessions'`, a free `order` (75 sits
    between `chat.headless` at 70 and `agent-strip` at 80; 140 is `session-stash`'s), reading
    `context.sessions.session`.
- **Self-test script** (`main/selftest-script.ts`), in the shape of `context-sources/main/selftest-script.ts`:
  - `SELFTEST_PROJECT_NAME = 'permission-review-selftest'` and the same `sendKeys` helper.
  - `PermissionReviewSelfTestDeps` is `{ homeDir; files: Pick<Files, 'makeFolder' | 'realPath'>; paths: Paths; chat:
    Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>; sessions: Pick<SessionsMainExports, 'activate'>;
    fakeOf(sessionId: string): FakeAgentHarness | null }`.
  - `start.ts` builds `fakeOf` from `chatSessionSlot`'s `harness` for the row, `services.agentHarnesses.get` and
    `isFakeAgentHarness`.
  - `pageBinds: []`, `settings: {}`, and `scrollsItself` as context-sources' list without `.context-sources-name`.
    05 adds the verdict's own selectors if it needs any.
  - **The failure comes first, in `open`.** A self-test step only types keys, so nothing in a step can arm
    `failNextAsk`. `open` runs:
    1. make the project folder and `chat.closeSessionsIn` it
    2. `chat.launch({ projectDir, profile: 'work', message: { text: 'permission-review self-test', images: [] } })`
       and `sessions.activate` the row
    3. `fakeOf(sessionId)`, throwing `the self-test session runs on no fake harness` when null
    4. `fake.failNextAsk('fake ask failed')`
    5. `void fake.askPermission(sessionId, { toolName: 'Write', input: { file_path: 'notes.md', content: 'fixture' },
       toolUseId: 'permission-review-fixture' })`, left unanswered: the next run's `closeSessionsIn` cancels it
  - `open` returns `shownLine: '[chat] Chat tab shown in permission-review-selftest'` and
    `alsoShown: [/^\[permission-review\] review unavailable for Write in permission-review-selftest: fake ask failed$/]`.
  - One group: `name: 'permission review'`, `why: 'Each permission card gets a second opinion from the harness's one-shot ask: a failed ask shows why it failed, and a reply shows its verdict.'`
  - Its one step: `keys: sendKeys(FAKE_PERMISSION_TEXT)`,
    `expect: '[permission-review] reviewed Bash in permission-review-selftest: deny · medium'`,
    `why: "The fake turn's Bash permission is reviewed by the fake harness's default ask reply."`
  - `problems: () => []`.

GIVEN a put of an unanswered permission entry WHEN the watcher hears it THEN one ask runs and the review goes
`reviewing`, then `done`
GIVEN that entry put again, or put answered, or a `replace` of the session's entries WHEN the watcher hears it THEN no
ask runs
GIVEN a new `forms.confirms` key WHEN the watcher hears it THEN one ask runs under `confirm/<roundId>`
GIVEN a running confirm review WHEN its key leaves `forms.confirms` THEN the ask's signal aborts and the review is
deleted
GIVEN a running chat review WHEN `sessions.ended` fires for its session, or a `replace` drops its entry THEN the ask's
signal aborts and the review is deleted
GIVEN a held review whose session or round went while the part was off WHEN the part starts THEN the review is deleted
GIVEN an ask that never settles WHEN 60 s pass THEN the review is unavailable with `the review took longer than 60 s`
and the signal aborted
GIVEN an input whose JSON is longer than 50,000 characters WHEN the prompt is built THEN it holds the first 50,000
and the cut line

Tests:
- `src/plugins/permission-review/main/start.test.ts`, over `startMainPart(permissionReviewMainPart, …)` in the shape
  of `context-sources/main/start.test.ts`:
  - `fakeDependency(chatMainKey, …)` with `defaultProfile` and `fakeDependency(sessionsMainKey, …)` with `label`.
    forms needs no export, so `fakeDependency(formsMainKey, () => ({}) as FormsMainExports)`.
  - `services.agentHarnesses: harnessRegistryOf([stub])` (`src/shared/agent-harness-registry.test-support.ts`). The
    stub is an `AgentHarness` with id `claude` whose `ask` is a `vi.fn` recording each request and answering per row.
  - Slots seeded with `harness.state.publish(...)`: `chatSessionSlot`, `chatEntriesSlot`, `formsConfirmsSlot`, and
    `coreAgentHarnessesSlot` holding `harnessInfo({ profiles: [{ name: 'work', configDir: '~/.claude-work' }] })`.
  - Reads through `harness.state.read(permissionReviewsSlot, 'test')`, and `harness.advance` for the timeout.
  - Cases:
    - `stop_LeavesNoLiveRegistration` and `stopThenStart_StartsAgain`, as context-sources has them.
    - `it.each` `request_$case_StartsReviews`, asserting the ask count and the keys under review. Rows:
      - an unanswered permission put → 1, key `s1/p1`
      - the same put twice → 1
      - a put with an answer → 0
      - a `replace` holding an unanswered permission → 0
      - an answer put while the review runs → 1, the review still `reviewing`, and `done` once the ask settles
      - a non-permission entry put → 0
      - a new `forms.confirms` key `r1` → 1, key `confirm/r1`
      - the same confirms key set twice → 1
    - `it.each` `review_$case_Publishes`, asserting the final review and the log line. The ask answers:
      - `FAKE_ASK_REPLY`-shaped deny/medium JSON → `done`, with the log `reviewed Bash in gamma: deny · medium`
        (sessions' `label` answers `gamma`)
      - rejects `Error('boom')` → unavailable `boom`
      - answers `not json` → unavailable `the reviewer's reply was not the expected JSON`
      - never settles, after `advance(60_000)` → unavailable `the review took longer than 60 s`, signal aborted
      Before the ask settles, each row also asserts `{ state: 'reviewing' }`.
    - `it.each` `removal_$case_AbortsAndDeletes`. A never-settling ask; then:
      - the confirms key deleted
      - `sessions.ended` for `s1`
      - a `replace` of `s1`'s entries that no longer holds `p1`
      Each asserts the recorded signal aborted, the review key absent, and no log line.
    - `it.each` `findReviewer_$case_IsUnavailable`, calling `findReviewer` directly with plain fakes and asserting the
      reason:
      - a chat session on an unregistered harness `codex` → `no agent harness "codex"`
      - a chat session naming profile `home`, which `claude` does not publish → `no profile "home"`
      - no chat session and `defaultProfile` null → `no profile to review with`
      - no chat session and a default `home` that no harness publishes → `no profile "home"`
      Plus one row per path where it succeeds, asserting `profileDir: '~/.claude-work'` and the chat session's
      `projectDir`, or null for the default path.
    - `it.each` `restart_$case`, each row seeding the slots, running `harness.restart()`, and asserting the asks in
      all and the reviews held:
      - an unanswered entry with a never-settling ask → 2 asks, the key `reviewing` again
      - a `done` review of an entry still present → 1 ask, the `done` review kept
      - a `forms.confirms` key `r1` already open at start, with no review → 1 ask under `confirm/r1`
      - a `done` review `s9/p1` of a session no longer in `chatSessions`, and a `done` `confirm/r9` with no `r9` in
        `forms.confirms` → both deleted, 0 asks
- `src/plugins/permission-review/main/review-prompt.test.ts`:
  - `it.each` `parseReviewReply_$case`. Rows, each with its expected `Review`:
    - plain JSON
    - JSON in a `` ```json `` fence with prose before and after
    - an extra field, ignored
    - a summary with surrounding spaces, trimmed
    - `FAKE_ASK_REPLY` → done, deny, medium. This row breaks if 01's reply stops matching the self-test's expected
      line.
    - verdict `maybe`, risk `severe`, summary missing, summary `42`, summary blank, no braces at all, broken JSON
      between the braces, a JSON array `[1]` → each unavailable with `the reviewer's reply was not the expected JSON`
  - `it.each` `reviewPrompt_$case`, asserting the whole prompt text. Rows:
    - a small Bash input with project `/work`
    - project null → `Project folder: none`
    - input `undefined` → the JSON block holds `null`
    - an input whose JSON is exactly 50,000 characters → no cut line
    - one of 50,001 characters → the block holds 50,000 characters, then
      `The input above is cut to its first 50000 of 50001 characters.`

Done when: `npm run typecheck` passes; `npm run lint` passes (layers, a new plugin folder and its manifest); the
test gate runs `src/plugins/permission-review/main/start.test.ts` and
`src/plugins/permission-review/main/review-prompt.test.ts`. The self-test group (`npm run selftest -- --plugin
permission-review`), the demo step and a real ask on Claude Code are checked in 07 Final verification.

Commit: one commit for the group, by pathspec (the eleven files above), no co-author trailer:
`permission-review: new plugin whose main reviews each permission entry and confirm round through the harness's ask`

## Proof

