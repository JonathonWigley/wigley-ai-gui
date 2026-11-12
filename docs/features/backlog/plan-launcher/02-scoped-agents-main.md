# 02 — Scoped agents: the plugin, its contract and its main service

Status: not started
Type: Task
Rung: deep · crosses chat's session lifecycle async: the host-id wait on `sessionOpened`, serial asks per scope, shared resumes, `/clear` following
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/scoped-agents/manifest.ts`
- create `src/plugins/scoped-agents/contract.ts`
- create `src/plugins/scoped-agents/main/scoped-agent-service.ts`
- create `src/plugins/scoped-agents/main/start.ts`
- test `src/plugins/scoped-agents/main/scoped-agent-service.test.ts`
- test `src/plugins/scoped-agents/main/start.test.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`
- modify `scripts/check-layers.mts` (a `PLUGIN_EXTRAS` entry)

Pattern: the interviewer half of `src/plugins/practice/main/practice-sessions.ts` (`hostIdOf`, `inTurn`,
`launchInterviewer`, `bringBack`, `interviewerOf`, `moveHostId`, `interviewerSlug`, `opened`, `closed`, `cleared`)
and its wiring in `src/plugins/practice/main/start.ts`. This task copies and generalizes it; practice keeps its own
copy, and its tests, until 04 moves it onto this plugin.

Consumes (the tree holds each):
- `chatMainKey` and `ChatMainExports`'s `launch`, `resume`, `send`, `close`, `profileOf`, `defaultProfile`;
  `ChatMainEvents`' `sessionOpened`, `sessionClosed`, `sessionCleared` (`src/plugins/chat/contract.ts`)
- `AgentSession` (`src/plugins/sessions/contract.ts`)
- `ResizeTarget`, `OuterPanes` (`src/contracts/panes.ts`); `Disposable`, `Registrations`
  (`src/contracts/disposable.ts`); `ChannelShape`, `DependencyKey`, `MainApi`, `MainPart`, `QualifiedEvents`
  (`src/contracts/plugin.ts`); `Timers` (`src/contracts/ambient.ts`); `Paths` (`src/contracts/paths.ts`)

Produces:
- `src/plugins/scoped-agents/contract.ts` — plan.md § File Structure's shared-names block word for word, its `owner`
  fields included (plan.md § Architecture decisions, the owner bullet), and these additions every later task reads:
  - on `ScopedAgentStore.entries`, the comment line "Never rejects for one scope's failure: it leaves that scope
    out." (Decisions, store failures)
  - on `ScopedAgentStore.write`, the comment line "Writes to the scope's state as it is when the write runs."
    (Decisions, launch)
  - on `ScopedAgentSpec.folder`, the comment line "Chat gets it as `projectDir`, so its `sessionOpened` names this
    folder."
  - the `ScopedAgentsMainExports` comment reads: "`spec.owner` names the registering plugin; the registration is
    filed with the consumer's registrations, so it ends when the consumer stops."
  - `export interface ScopedAgentsChannel extends ChannelShape { invoke: { ask(owner: string, agentId: string,
    scope: string, text: string): Promise<string>; sessionOf(owner: string, agentId: string, scope: string):
    Promise<string | null> }; messages: Record<never, never> }`
  - `export const scopedAgentsMainKey: DependencyKey<ScopedAgentsMainExports, 'main', 'scoped-agents'>`
  - `export const scopedAgentsPageKey: DependencyKey<ScopedAgentsPageExports, 'page', 'scoped-agents'>`
- `src/plugins/scoped-agents/manifest.ts` — `export const scopedAgentsManifest = definePlugin({ … })`:
  - `id: 'scoped-agents'`, `label: 'Scoped agents'`, `description: 'Runs the agent chats a plugin owns per scope, such
    as Practice's interviewer and Backlog's assistant, and the ask box and chat pane they show in.'`
  - `dependsOn: { main: ['sessions', 'chat'], page: ['chat'] }`, `reads: { main: [], page: [] }`
  - `commands`: `askSend: { label: 'send the ask', group: 'ask', runsIn: 'page' }`,
    `leaveBox: { label: 'leave the box', group: 'ask', runsIn: 'page' }`
  - `scopes: { ask: 'In a scoped agent ask box' }`
  - `settings: { layout: 'default' }`, `settingInfo: { layout: { label: 'Layout', description: "The ask box layout:
    a folder name in scoped-agents' layouts folder, or default." } }`, `themeTokens: {}`
- `src/plugins/scoped-agents/main/scoped-agent-service.ts`:
  - `export const HOST_ID_WAIT_MS = 2_000;`
  - `export interface ScopedAgentServiceDeps { chat: Pick<ChatMainExports, 'launch' | 'resume' | 'defaultProfile' |
    'profileOf' | 'send' | 'close'>; paths: Pick<Paths, 'samePath'>; timers: Timers; log(line: string): void }`
  - `export interface ScopedAgentService { add(spec: ScopedAgentSpec): ScopedAgent; ask(owner: string, agentId:
    string, scope: string, text: string): Promise<string>; sessionOf(owner: string, agentId: string, scope: string):
    Promise<string | null>; opened(event: { sessionId: string; hostSessionId: string; projectDir: string }): void;
    closed(event: { sessionId: string }): void; cleared(event: { sessionId: string; newHostSessionId: string }):
    void }`
  - `export function createScopedAgentService(deps: ScopedAgentServiceDeps): ScopedAgentService`
- `src/plugins/scoped-agents/main/start.ts` — `export const scopedAgentsMainPart: MainPart<typeof
  scopedAgentsManifest>`; `exports(consumer: Registrations): ScopedAgentsMainExports` returns
  `{ addScopedAgent: (spec) => consumer.track(service.add(spec)) }`.

Decisions:
- One service, many registrations (plan.md § Architecture decisions: "chat's session events are heard once"). The
  main part creates one `createScopedAgentService({ chat, paths: services.paths, timers: services.timers, log:
  services.log })`, hears `chat.sessionOpened`, `chat.sessionClosed` and `chat.sessionCleared` once each through
  `api.events.on` and hands them to `service.opened`, `closed`, `cleared`; registers `channel.handle('ask', …)` and
  `channel.handle('sessionOf', …)` onto `service.ask` and `service.sessionOf`. Its `MainApi` is
  `MainApi<typeof scopedAgentsManifest, ScopedAgentsChannel, Record<never, never>, QualifiedEvents<'chat',
  ChatMainEvents>>`. It returns `{ commands: {}, exports }`; it registers no layout (03 adds
  `api.layouts.register({ layoutTypes })` to this `start.ts` once `layouts/` exists) and hands no self-test script
  (the interviewer's self-test groups stay practice's; 04 and 08 own the live groups).
- Registrations are keyed by `(owner, agentId)`. `add` throws `Scoped agent <owner>/<agentId> is already
  registered.` for a second live one; `ask`/`sessionOf` for a pair with no live registration reject `No scoped agent
  <owner>/<agentId>.` A registration's `dispose` removes the registry entry only while the entry is still this
  registration (compare the registration object, not the key), and a second `dispose` does nothing: a consumer that
  stops and starts again re-adds the pair, and the old handle's late dispose must not remove the new one. An ask in
  flight runs to its end. Disposing launches and closes no session: the rows stay where the store names them, for
  the next start. On a disposed handle, `ask` and `sessionOf` reject `No scoped agent <owner>/<agentId>.` (the
  channel's rule), and `scopeOf` resolves null (no agent, so no session is its); a disposed registration takes no
  part in `cleared`.
- Host ids (generalizes `hostIdOf`, `opened`, `closed`): the buffer, the waiting reads and the in-flight launch list
  are the service's, shared by every registration; the buffer and waiting reads are keyed by row id.
  - In-flight launches: one entry per launch, holding the folder. The launch adds its entry just before it calls
    `chat.launch` (chat fires `sessionOpened` inside `launch`) and removes it in a `finally` that wraps
    `chat.launch` and the host-id read, whatever the outcome: resolved, timed out or thrown. Two launches in one
    folder hold two entries.
  - `opened` ignores an event unless its `projectDir` `paths.samePath`-matches the folder of an in-flight entry.
    For such an event it resolves the waiting read for its row, else it buffers the host id. Practice heard only
    its own folder; a registration's folder depends on the scope, so the in-flight entries name the folders.
  - `closed` drops the row's buffered id. The read takes a buffered id at once, else waits `HOST_ID_WAIT_MS` on
    `deps.timers`, then resolves null.
- Turn keys: `inTurn` and `sessionOf`'s shared in-flight resume are each keyed by registration and scope, the key
  `` `${owner}/${agentId}\n${scope}` ``. Two registrations may use one scope string (a Practice slug `global`
  against Backlog's `global`), and their asks and resumes stay apart.
- Store failures: `scopeOf` and `cleared` call `store.entries()`, which per its contract comment leaves out a scope
  that fails to read (Practice skips a `progress.json` that fails to read, as `findInterviewer` does today). When
  `entries()` rejects anyway, `scopeOf` logs `<agentId> records not read: <error>` and resolves null, so a tool
  refuses an unknown session instead of throwing; `cleared` logs `<agentId> <sessionId> host id not moved:
  <error>`.
- `ask(scope, text)` per registration runs after every earlier ask for that scope of that registration has settled
  (`inTurn`, Turn keys above), then: `await store.checkAsk(scope)` (its rejection is the ask's);
  `store.read(scope)`; null → launch. Otherwise `sessionOf(scope)`; an id → `chat.send(id, { text, images: [] })`
  and resolve the id. Null (the resume was refused and cleared the record, or the store's record went away under the
  ask) → `await store.checkAsk(scope)` again, then launch.
  - This is the one behaviour change from Practice: plan.md § Architecture decisions, the ask race bullet.
- Launch (generalizes `launchInterviewer`), in this order: `chat.defaultProfile(null)`, null → throw `Chat has no
  profiles.`; `old = await store.superseded(scope)`; `chat.launch({ projectDir: spec.folder(scope), profile,
  message: { text, images: [] }, instructions: [await spec.instructions(scope)], owner: spec.owner })`; the host-id
  read. No host id → log `<agentId> <id> sent no sessionOpened in 2000 ms`, close the row (`chat.close(id,
  'finished')`, a failure logged `<agentId> <id> not closed: <error>`), throw `Chat sent no sessionOpened for
  <agentId> <id>.` Then `store.write(scope, { sessionId: id, hostSessionId })`; a rejection closes the row (label
  `unstored <agentId>`) and rethrows. Then, when `old` is non-null and `chat.profileOf(old.sessionId)` is non-null,
  close it (label `old <agentId>`). Resolves the new id. With `agentId` `interviewer` every log line and error text
  is practice's today, word for word.
  - `superseded` is read before the launch and `write` runs after it and the host-id wait (up to 2 s), so the two
    may see different scope states: a Practice problem reopened as due in that window gets the new record on its new
    attempt, and the old attempt's record is the one closed. This is accepted, as the ask race is (plan.md
    § Architecture decisions), and no test pins it. Do not add a token that pins the state `checkAsk` saw: the
    generic store has no attempt to name.
- `sessionOf(scope)` (generalizes `bringBack` and `interviewerOf`): concurrent calls for one scope of one
  registration share one in-flight promise (Turn keys above), dropped when it settles. `store.read(scope)` null → null. A record whose `sessionId` chat holds
  (`profileOf` non-null) → that id. Otherwise the profile as above, then `spec.title(scope)` and
  `spec.instructions(scope)` together, then `chat.resume({ projectDir: spec.folder(scope), profile, hostSessionId:
  record.hostSessionId, title, instructions: [instructions], owner: spec.owner })`. A rejection logs `<agentId>
  <sessionId> not resumed, so cleared: <error>`, writes `store.write(scope, null)` and resolves null. A new row id
  is written back with the same host id; resolves the id.
- `scopeOf(session)` (generalizes `interviewerSlug`): the first `store.entries()` entry whose record's `sessionId`
  is `session.id` or whose `hostSessionId` is `session.info.sessionId`; null otherwise. Which scopes `entries`
  lists is the store's rule (Practice: the current attempts only, 04).
- `cleared(event)` (generalizes `moveHostId`): each registration looks through its `store.entries()` for the record
  whose `sessionId` is the row and writes `{ sessionId, hostSessionId: newHostSessionId }` to that scope; a failure
  logs `<agentId> <sessionId> host id not moved: <error>`. Practice searched every attempt here and the current one
  for `interviewerSlug`; one `entries()` now serves both (plan.md's `ScopedAgentStore` comment: "for scopeOf and
  following /clear's new host id").
- `startImport` and the import session stay in practice (plan.md § Architecture: "`practice-sessions.ts` keeps only
  the import session").
- The main part's start order: `scopedAgentsMainPart` joins `mainParts` in `src/plugins/main.ts` just before
  `backlogMainPart`, and `scopedAgentsManifest` joins `builtInManifests` in `src/plugins/manifests.ts` just before
  `backlogManifest`, each with its import in the file's import block. `page.ts` is 03's (no `page/start.ts` exists
  yet, so the layer check's composition-root check expects none).
- The page commands, scope and `layout` setting are declared here so 03 and the keymap find them; their handlers and
  binds are 03's. Until 03 lands they have no handler and no key.
- `scripts/check-layers.mts` `PLUGIN_EXTRAS` gains, after `practice`, `'scoped-agents': { sublayers: {
  'src/plugins/scoped-agents/main/scoped-agent-service.test.ts': { layers: ['src/contracts', 'src/shared',
  'src/shared/paths', 'src/shared/agent-forms', 'src/plugins/scoped-agents/contract.ts',
  'src/plugins/scoped-agents/main', 'src/plugins/chat/contract.ts', 'src/plugins/sessions/contract.ts'], packages:
  [] } } }` with the comment `// Runs its host-id wait on the shared global timers under fake timers.`, as
  practice's `practice-sessions.test.ts` entry does. The derived rules need nothing else: the contract imports only
  `src/contracts` and the chat and sessions contracts its manifest names.

GIVEN a registration with no record for scope `s`
WHEN `ask('s', 'hi')` runs and chat's `sessionOpened` names the row's host id within 2 s
THEN chat launched one owned row in `folder('s')` with the spec's instructions and `owner`, the store holds
`{ sessionId, hostSessionId }` for `s`, and the ask resolves the row id.

GIVEN a stored record whose row chat no longer holds
WHEN `sessionOf('s')` runs twice at once
THEN chat resumed it once with the spec's title, both calls resolve the new row id, and the store holds it.

GIVEN two registrations
WHEN chat's `sessionCleared` names a row one of them stores
THEN only that registration's store gets the new host id.

GIVEN a consumer's registrations disposed
WHEN the page invokes `ask` for that owner and agent id
THEN it rejects `No scoped agent <owner>/<agentId>.`

Tests:
- `src/plugins/scoped-agents/main/scoped-agent-service.test.ts` — over a fake `ScopedAgentStore` (an in-memory
  `Map<string, ScopedAgentRecord>` with a settable `superseded` answer, a `checkAsk` that rejects for scopes named in
  a `refused` set with `<scope> has no attempt; open it first.`, and a `write` a test can make reject) and the fake
  chat of `practice-sessions.test.ts` (copied: `row-1`, `row-2`, … ids, `held`, `resumeError`,
  `beforeLaunchResolves`, plus a new settable `launchError` that makes `launch` reject before it takes an id), a
  fake store that also takes an `afterRead(scope)` hook a test uses to change the store between reads,
  `globalTimers` under `vi.useFakeTimers()`, `posixPaths`. Each case below is copied from
  `src/plugins/practice/main/practice-sessions.test.ts` by its current name and rewritten against the fake store
  (practice's copies stay until 04 removes them with the code they test):
  - `askInterviewer launches an owned session and stores it: $case` → `ask launches an owned session and stores it:
    $case`, cases `opened inside launch` and `opened after launch`; asserts the launch request (folder, profile,
    message, `[instructions]`, `owner`) and the stored record. The built-in versus `interviewer.md` instructions row
    is Practice's spec rule and goes to 04.
  - `askInterviewer sends the second ask to the first launch: $case` → `ask sends the second ask to the first
    launch: $case` (`one after another`, `both at once`).
  - `askInterviewer launches afresh when chat refuses the resume` → `ask launches afresh when chat refuses the
    resume` (log `row-0 not resumed`).
  - new `ask launches when the record goes away between its two reads`: a stored record for `s`, `afterRead`
    deletes it after the first `store.read`; one launch, no resume, the store holds the new record.
  - new `ask does not launch when the second checkAsk refuses`: a stored record whose row chat does not hold,
    `resumeError` set, and `afterRead` adds `s` to `refused` on the second `store.read` of `s` (the one `sessionOf`
    makes); the resume fails and clears the record, and the ask rejects `s has no attempt; open it first.` with no
    launch.
  - `askInterviewer refuses without a stored interviewer, a profile or its attempt: $case` → `ask refuses and
    closes what it launched: $case`, rows `no sessionOpened` (error `Chat sent no sessionOpened for interviewer
    row-1.`, close `row-1`), `record not stored` (`disk full`), `no profile` (`Chat has no profiles.`, no launch),
    `checkAsk refuses` (`s has no attempt; open it first.`, no launch), and a new row `sessionOpened in another
    folder` (the opened event names another folder: times out as `no sessionOpened`). The `attempt changed under the
    ask` row is dropped: Decisions, the behaviour change.
  - new `opened is not kept outside a launch: $case` — `opened` for `row-1` in the registration's folder, then an
    ask whose launch resolves `row-1` with no further `opened`: rejects `Chat sent no sessionOpened for <agentId>
    row-1.` Rows: `no launch yet` (the `opened` comes first), `after a launch that rejected` (an ask with
    `launchError` set rejects with it, then the `opened`, then `launchError` cleared and the ask).
  - new `closed drops a buffered host id`: inside the launch (`beforeLaunchResolves`), `opened` then `closed` for
    the new row; the ask rejects `Chat sent no sessionOpened for <agentId> row-1.`
  - `askInterviewer on a new attempt closes the old interviewer: $case` → `ask closes the superseded session:
    $case` (`held` closes `row-0`, `not held` closes nothing).
  - `interviewerOf brings the interviewer back: $case` → `sessionOf brings the session back: $case`, rows
    `no record`, `row held`, `row gone` (resume request asserted: folder, profile, host id, the spec's title,
    `[instructions]`, `owner`), `resume refused`, `row gone, two calls at once`.
  - `cleared moves the stored host id` → `cleared moves the stored host id of the registration holding the row`:
    two registrations, only the holder's store changes.
  - `interviewerSlug matches the current attempt only: $case` → `scopeOf matches a stored record: $case`, rows
    `row id`, `host id`, `any other`, and `entries rejects` (resolves null, logs `<agentId> records not read:
    <error>`); the `an older attempt` row is the Practice store's `entries` rule and goes to 04.
  - new `add refuses a second registration of one owner and agent id`, and `ask and sessionOf route by owner and
    agent id: $case` (rows: the matching registration answers; a disposed registration and an unknown pair reject
    `No scoped agent practice/interviewer.`).
  - new `a disposed handle refuses: $case` — rows `ask` and `sessionOf` reject `No scoped agent
    practice/interviewer.`; `scopeOf` resolves null.
  - new `a re-added registration survives the old handle's second dispose`: add, dispose, add the same pair again,
    dispose the first handle again; the second handle's `ask` still launches.
  - new `two registrations keep one scope string apart`: registrations `a/x` and `b/y`, both asked for scope
    `global` at once with no record; each launches its own row and each store holds its own record.
- `src/plugins/scoped-agents/main/start.test.ts` — `startMainPart(scopedAgentsMainPart, { dependencies:
  [fakeDependency(chatMainKey, () => chat)] })`, exports taken with `harness.started().exports?.(consumer)`:
  - `chat session events reach the service once` — `harness.emit('chat.sessionOpened', …)` resolves a launch
    started through `harness.invoke('ask', …)`; `chat.sessionCleared` moves the stored host id.
  - `a registration ends with its consumer` — `consumer.dispose()` then `harness.invoke('ask', owner, agentId, …)`
    rejects `No scoped agent <owner>/<agentId>.`

Done when: `npm run typecheck`, `npm run lint` (the layer check passes with the new plugin folder and its
`PLUGIN_EXTRAS` entry), and `npm test -- src/plugins/scoped-agents src/plugins/practice scripts/layer-rules.test.mts` pass. No self-test
change and no live check here: the ask box and the brought-back interviewer are checked in
`10-final-verification.md` after 03 and 04.

Commit: one commit for the group — "scoped-agents plugin: owned chat sessions per (owner, agent id, scope) in main,
generalized from Practice's interviewer"

## Proof
