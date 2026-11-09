# 03 — Chat: start path for projects, channels and start_session

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

A start names a project instead of a folder. A folder project starts in its folder as any folder start does. A pool
project opens its row at once, resting in the pool's lowest clone, claims a clone on the branch through the registered
`PoolProvider`, and starts the agent in the clone it got. Chat registers its membership rule with sessions, serves the
start prompt's project, branch and saved-session lists, and `start_session` takes `project` and `branch`. Read
`docs/features/projects/design.md` § Pool projects and § Starting from an agent first.

Read `src/plugins/chat/main/chat-sessions.ts` whole, once, in three parallel Read calls (lines 1–1200, 1200–2400,
2400–end); every edit below names its member there.

**Files**

- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/chat-sessions.ts`
- modify `src/plugins/chat/main/chat-slots.ts` (one new `SessionSlots` member; not in plan.md's File Structure, see
  Decisions)
- modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/chat/main/start-session-tool.ts`
- modify `src/plugins/usage/main/selftest-script.test.ts` (line 57 reads `request.projectDir` off a `LaunchRequest`)
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/main/start-session-tool.test.ts`
- test `src/plugins/chat/main/start.test.ts`

**Callers of `StartRequest` / `LaunchRequest`, checked at plan time.** `StartTarget` is a union whose first member is
`{ projectDir: string }`, so every caller that builds a request literal with `projectDir` still compiles unchanged;
only code that *reads* `request.projectDir` off the union breaks. Builders left unchanged:
`src/plugins/workflow-large/main/actions.ts`, `src/plugins/notes/main/note-sender.ts`,
`src/plugins/auto-retro/main/start.ts`, the self-test scripts of context-sources, agent-strip, workflow-large,
unity-pool, agent-skills, usage, session-log, workflow (`level-selftest-script.ts`), agent-lines, session-stash and chat
(`selftest-script.ts` 1475–1477), the drive action `chat.start` in `start.ts`, `src/plugins/chat/page/start-prompt.ts`
(task 05's), and the test doubles in `workflow-large-main.test.ts`, `workflow-large/main/actions.test.ts`,
`notes/main/note-sender.test.ts`, `notes/main/start.test.ts`, `auto-retro/main/start.test.ts`,
`chat/page/start-prompt.test.ts`, `chat/main/start.test.ts` and `chat/main/chat-sessions.test.ts`. The
`record.request.projectDir` reads in `chat/main/selftest-script.ts`, `notes/main/selftest-script.ts` and
`shared/fake-agent-harness.ts` are the harness's `AgentStart`, not chat's request. There is no `practice` plugin in
`src/plugins/`. Readers that must change: `chat-sessions.ts` (`startNew`, `launch`) and
`usage/main/selftest-script.test.ts:57`. Re-run `grep -rn "request\.projectDir\|\]\.projectDir" src --include='*.ts'`
before the commit; `npm run typecheck` lists any reader missed.

**Consumes**

- ← 01: `SessionsMainExports.addProjectNamer(namer: ProjectNamer): ProjectNamerHandle`, `ProjectNamerHandle.changed()`,
  `SessionsMainExports.relocate(sessionId: string, projectDir: string): void` (`src/plugins/sessions/contract.ts`).
  `relocate` changes the session's info object in place and throws for a row this plugin did not open.
- ← 02: `ChatProject`, `ProjectSetting`, `PoolProvider`, `PoolClaimRequest`, `PoolClaimResult` (`chat/contract.ts`);
  `readProjects`, `projectOf`, `branchChoices` (`chat/main/projects.ts`); the `projects` setting on chat's manifest
  (default `[]`); and the `addPoolProvider` registry in `chat/main/start.ts`, newest registration answering.
  This task needs one read of that registry, `() => PoolProvider | null` (the newest live registration, null with
  none): `const poolProvider = () => poolProviders.current();` in `start.ts`, over 02's `createPoolProviders()`
  (`poolProviders.current()`, 02 § Produces).

**Produces**

`src/plugins/chat/contract.ts`, word for word (replacing the `StartRequest` and `LaunchRequest` interfaces):

```ts
export type StartTarget = { projectDir: string } | { project: string; branch: string | null };
export type StartRequest = StartTarget & { profile: string; headless?: boolean };
export type LaunchRequest = StartTarget & { profile: string; message: UserMessage; unattended?: boolean; headless?: boolean };
export interface ProjectPastSessionRow extends PastSessionRow { projectDir: string }
// ChatChannel.invoke gains:
projects(): ChatProject[];
branches(project: string, refresh: boolean): Promise<string[]>;
projectPastSessions(project: string, profile: string): Promise<ProjectPastSessionRow[]>;
```

`src/plugins/chat/main/chat-sessions.ts`:

```ts
// ChatSessionsDeps: `sessions` Pick gains 'relocate'; new members
projects(): readonly ChatProject[];
poolProvider(): PoolProvider | null;
homeDir: string;
paths: Pick<Paths, 'expandTilde'>;
// ChatSessions gains
branches(project: string, refresh: boolean): Promise<string[]>;
projectPastSessions(project: string, profile: string): Promise<ProjectPastSessionRow[]>;
```

`src/plugins/chat/main/chat-slots.ts`: `SessionSlots.relocate(projectDir: string): void`.

`src/plugins/chat/main/start-session-tool.ts`: `StartSessionToolDeps.projects(): readonly ChatProject[]`.

## Decisions

### Pinned texts

Every text below is written exactly; `<x>` is the value named. `…` is U+2026.

| Name in code | Text | Where |
|---|---|---|
| (notice, info) | `Claiming a Unity clone on <branch>…` | added to a pool row at open |
| (notice, info) | `Waiting for a Unity clone…` | first `queued()` call of the claim |
| (notice, error) | `Unity clone not claimed: <result.message>` | claim answered `ok: false` |
| (notice, info) | `<result.note>` verbatim | claim answered `ok: true` with a non-null `note` |
| (notice, error) | `Claude did not start: <errorText(error)>` | the start after a landed claim threw |
| `CLAIM_FAILED_TEXT` | `This session has no Unity clone. Close it and start a new one.` | send on a claim-failed row rejects with it; `clear` throws it |
| (thrown) | `Unknown project "<name>". Projects: <names joined by ', ', or none>.` | start, launch, branches, projectPastSessions |
| (thrown) | `Project "<name>" is a Unity pool: name a branch.` | pool project, `branch` null |
| (thrown) | `Project "<name>" is a folder: it takes no branch.` | folder project, `branch` non-null |
| (thrown) | `Project "<name>" runs under profile <project.profile>, not <request.profile>.` | fixed profile differs |
| (thrown) | `No Unity pool provider is registered for project "<name>".` | pool project, `poolProvider()` null |
| (thrown) | `Pool "<pool>" has no clones.` | `provider.folders(pool)` is `[]` at a start |
| (thrown) | `Project "<name>" is a folder: it has no branches.` | `branches` on a folder project |
| (thrown) | `session <sessionId> is still claiming a Unity clone` | `clear` on a claiming row |

Log lines: `session <sessionId> claiming a clone of <pool> on <branch>`, `session <sessionId> claimed <path>`,
`session <sessionId> claim failed (<result.error>): <result.message>`,
`claim for session <sessionId> settled after its row closed`, `launched session <sessionId> in project <name>` (a
project launch; a folder launch keeps today's line), `session <sessionId> not started after its claim:
<errorText(error)>`.

### Resolving a target

One private resolver in `createChatSessions`, run before anything opens, so every rejection opens no row, writes no
slot and starts no claim. In this order:

1. `'projectDir' in request` → a folder start in `request.projectDir`, as today.
2. Find the project by `name` in `deps.projects()`; none → the unknown-project text.
3. `project.profile !== null && project.profile !== request.profile` → the fixed-profile text.
4. Folder project: `branch !== null` → the folder-with-branch text; else a folder start in
   `deps.paths.expandTilde(project.folder, deps.homeDir)`. A folder project's start is a folder start in every way:
   same origin, same `sessionOpened`, same save.
5. Pool project: `branch === null` → the name-a-branch text; `deps.poolProvider()` null → the no-provider text;
   `provider.folders(project.pool)[0]` undefined → the no-clones text. Else a pool start with that first folder as the
   placeholder.

`profileNamed(request.profile)` and `requireHarness()` run before the resolver's pool branch opens the row, as
`startNew` runs them today, so an unknown profile or no harness still throws and opens nothing.

### The pool start

`HeldSession` gains, with its comment:

```ts
// A pool project's claim while the row waits on it, and its failure after;
// null for every other row and from the moment the claim lands. A row with a
// claim is left out of the saved sessions, fires no `sessionOpened` or
// `sessionClosed`, and starts no process.
claim:
  | { state: 'claiming'; abort: AbortController; origin: SessionOrigin; branch: string; isQueuedShown: boolean }
  | { state: 'failed' }
  | null;
```

`openRow` gains `opening.claim: HeldSession['claim']` (null on every existing caller). When it is non-null, `openRow`
emits no `sessionOpened`; the emit moves into a new helper `emitSessionOpened(session, profileName, profileDir,
origin)` that `openRow` calls for a null claim and the claim's landing calls later.

The pool start, as a new function beside `startNew`, for `start` (origin `new`, `{ select: true }`) and `launch`
(origin `launched`, `{ select: false }`, its flags):

1. `requireNotDetached(hostId)`; `hostId = deps.randomUuid()`.
2. `openRow(placeholder, profile.name, profileDirOf(profile), { …the same opening `openAndStart` builds for a new
   session…, claim: { state: 'claiming', abort: new AbortController(), origin, branch, isQueuedShown: false } },
   options)`.
3. Add the info notice `Claiming a Unity clone on <branch>…`. A launch then `appendQueued`s its message (so it shows in
   `chat.queued` while the claim runs and goes out first once the process starts). Log the claiming line.
4. Call `provider.claim({ pool, branch, hostSessionId: session.hostId, rowId: session.sessionId }, abort.signal,
   queued)`. A synchronous throw or a rejection counts as `{ ok: false, error: 'internal', message: errorText(error)
   }`. `queued`: when the row is still held, still claiming and `isQueuedShown` is false, add the info notice `Waiting
   for a Unity clone…` and set `isQueuedShown`; any other call does nothing.
5. Return the session at once: `start` stays synchronous and returns the row id; `launch` returns the row id
   synchronously as today, so `ChatMainExports.launch` resolves once the row is open.

When the claim settles:

- **Row gone or chat detached** (`held.get(sessionId) !== session || isDetached`): log the settled-after-close line
  and do nothing else. (Closing the row and `detachAll` aborted the signal; the provider answers `cancelled`, 04.)
- **`ok: true`**, in this order: `session.claim = null`; `sessions.relocate(sessionId, result.path)`;
  `session.slots.relocate(result.path)`; `session.slots.setInfo({ repo: path.basename(result.path) })`; `readBranch`
  and `readWorktreeRoots` for the new folder; the note notice when `result.note !== null`; `emitSessionOpened` with the
  clone as `projectDir` and the claim's origin; log the claimed line. Then, in one `try`: `profileNamed(<the row's
  profile>)` read again (settings may have changed during the claim), `requireHarness()`, `startProcess(session,
  harness, profile, false)`, `writeNextQueued(session)`. A throw there adds the error notice `Claude did not start:
  <error>`, sends `sessionRested` with the error text, and logs; the row rests in the clone, saved, and its queued
  messages stay queued for the next send, which starts the process there as any resting row's does. Last, `save()`.
- **`ok: false`**: `session.claim = { state: 'failed' }`; the error notice `Unity clone not claimed: <message>`;
  `returnAllHeld(session)`, so the launch message and anything sent during the claim go back to the box; log the
  failed line. The row stays resting in the placeholder and is never saved.

### What a claiming or claim-failed row does elsewhere

| Member | Claiming | Failed |
|---|---|---|
| `snapshot` (every save) | left out (`[...held.values()].filter((s) => s.claim === null)`); `selectedHostSessionId` then null when it is selected | left out |
| `waits` | true, so `send` queues | as today (false) |
| `writeAtIdle` | not reached (`waits`) | throws `CLAIM_FAILED_TEXT` before any profile lookup or start |
| `sendAllNowSettled` | queues a non-null `message` with `appendQueued` + `save`, writes nothing, returns | as today: reaches `writeAtIdle`, which throws |
| `sendNow` | logs `sendNow in session <id> ignored: claiming a Unity clone`, does nothing | as today (nothing is queued) |
| `clear` | throws `session <id> is still claiming a Unity clone` before changing anything | throws `CLAIM_FAILED_TEXT` before changing anything |
| `closed` | aborts `claim.abort`, then as today but with no `fireSessionClosed` | as today but with no `fireSessionClosed` |
| `detachAll` | aborts every claiming row's `claim.abort` (after `writeSaved`, which already leaves it out) | — |
| `stopAll`, `interrupt`, `setControl`, `compact`, `loadHistory` | unchanged: the row is resting with no process | unchanged |

A relaunch mid-claim therefore drops the row (plan.md decision), and the abort stops the CLI.

### Launch's first message

Today `launch` calls `deliverWritten` right after `startNew`, since the process started synchronously. A folder start
keeps that. A pool start queues the message (step 3 above) and the landing's `writeNextQueued` writes it right after
`startProcess`, so the first message waits for the process and reaches it before any message sent during the claim.
`setFirstMessageTitle` runs at that write, as for any first write.

### `branches` and `projectPastSessions`

- `branches(project, refresh)`: unknown → unknown text; folder project → folder-no-branches text; no provider →
  no-provider text; else `branchChoices(project.pinnedBranches, await provider.branches(project.pool, refresh))`. A
  rejection from the provider passes through.
- `projectPastSessions(project, profile)`: unknown → unknown text; the folders are `[expandTilde(project.folder,
  homeDir)]` for a folder project and `provider.folders(project.pool)` for a pool project (no provider →
  no-provider text; `[]` folders → `[]` rows). It runs today's `pastSessions(folder, profile)` for each folder in
  parallel, adds `projectDir: folder` to each row, and sorts by `modified` descending; equal `modified` keeps folder
  order, then each folder's own order (a stable sort). One folder's rejection rejects the call, as `pastSessions`
  rejects today. No fixed-profile check: the page passes the project's profile.

### Chat slots

`SessionSlots.setInfo` omits `projectDir` on purpose, so a slot write cannot move a row by accident. Add
`relocate(projectDir: string): void` instead, writing `{ ...info(), projectDir }` (and the detached copy after
`close`, as `setInfo` does). Its comment: the one move a row makes, from a pool project's placeholder clone to the
claimed one, before its process starts. This file is outside plan.md's File Structure; report it in the Proof.

### `start.ts`

- **Projects held.** `let projectSettings = api.settings().projects;` and `let projects = readProjects(projectSettings,
  services.log);` once at start, so a bad entry logs once per settings change, not per read. If 02 already holds a
  checked list in `start.ts`, use that one instead of a second read.
- **Settings change.** In the existing `api.onSettingsChanged` listener (or a second one beside it): when
  `!isSameJson(settings.projects, projectSettings)`, store the new raw value, recompute `projects`, and call
  `namer.changed()`. A change to any other setting re-reads nothing.
- **Namer.** After `createChatSessions`: `const namer = sessions.addProjectNamer((projectDir) => projectOf(projectDir,
  projects, (pool) => poolProvider()?.folders(pool) ?? [], services.homeDir, services.paths)?.name ?? null);
  namer.changed();` (02's `projectOf` takes `paths` fifth, for `isInside` and `expandTilde`.) The
  handle needs no dispose of its own: sessions' consumer view tracks it (01).
- **Provider changes.** Widen 02's `addPoolProvider` export (`consumer.track(poolProviders.add(provider))`) so it
  calls `namer.changed()` after the provider registers and after its registration disposes, so rows in clones
  regroup when unity-pool starts after chat or stops.
- **`createChatSessions` deps** gain `projects: () => projects`, `poolProvider`, `homeDir: services.homeDir`,
  `paths: services.paths`.
- **Channel handlers**: `projects` → `[...projects]`; `branches` → `chat.branches(project, refresh)`;
  `projectPastSessions` → `chat.projectPastSessions(project, profile)`.
- **Tool deps**: `startSessionToolSession({ …, projects: () => projects })`.
- The drive action `chat.start` keeps its `projectDir` argument; it gains no project argument.
- `chatMainPart` block comment gains: names each row's project from the `projects` setting for the side bar, and
  lists the projects, a pool project's branches and a project's saved sessions for the start prompt.

### `start_session`

- Input gains `project` and `branch` (strings). `folder` and `project` together → error `Name folder or project, not
  both.`; `branch` without `project` → `branch is only for a project.`; a non-string or blank `project` →
  `project must be a non-empty string.`; a non-string or blank `branch` → `branch must be a non-empty string.` Each
  starts nothing and stats nothing. These checks run after the prompt check and before the profile choice.
- With `project`: no folder stat. The profile is the named one when one is named (checked against `profileNames` as
  today), else the project's own `profile` from `deps.projects()` when the project is found and has one, else
  `defaultProfile(session.id)`. A named profile that differs from the project's own is passed through, and chat's
  launch rejects it with the fixed-profile text, so the rule lives in one place; an unknown project is likewise left
  to chat's unknown-project text. The launch is `{ project, branch: branch ?? null, profile, message, headless }`.
- Success texts: folder project or a project with no branch → `Launched session <id> in project <name> under profile
  <profile>. A failure to start shows on its row.`; with a branch → `Launched session <id> in project <name> on branch
  <branch> under profile <profile>. It starts once a Unity clone on <branch> is claimed; a failure shows on its row.`
  A folder launch keeps today's text.
- `START_SESSION_TOOL.description` becomes, word for word:

  > Start a new, independent chat session in the Auri app with `prompt` as its first message. It opens in the
  > background as a new row in the side bar, without taking focus. It is a full agent session running the user's whole
  > agent setup, not a lightweight subagent: even a one-word prompt spends tens of thousands of tokens of the user's
  > plan, so start one only when the work needs its own session. It always runs on Claude, whichever agent calls this
  > tool. It runs on its own: its output does not come back here, and this tool cannot message or end it. Name where
  > it starts with `folder` or `project`, not both; with neither it starts in this session's folder when there is one.
  > `folder` must be an absolute path to a folder that exists. `project` names one of the app's projects: a folder
  > project starts in its folder, and a Unity pool project needs `branch` and starts once the app has claimed a clone
  > on that branch. `profile` defaults to the project's own profile when it has one, else to this session's when the
  > app started this session, else to the app's first profile; a project with its own profile refuses any other.
  > Returns the new session's id.

- New properties: `project` — `"The name of one of the app's projects to start in, in place of folder."`; `branch` —
  `"For a Unity pool project: the branch its clone checks out. Only with project."`. `folder`'s description becomes
  `"The absolute path of an existing folder to start in, in place of project. Defaults to this session's folder, when
  it has one."`.
- `startSessionToolSession`'s comment gains: a call naming a project starts there, under the project's profile when it
  has one.

## Modifications, member by member

`src/plugins/chat/contract.ts`

- `StartRequest` and `LaunchRequest` become the types in Produces; `StartTarget` and `ProjectPastSessionRow` are added
  beside them. Carry the field comments over as comments above each type: `headless` "true opens the row headless";
  `unattended` and the launch `headless` keep today's wording. Add above `StartTarget`: a folder, or a project from
  chat's `projects` setting with the branch a pool project's clone checks out (null for a folder project).
- `ChatChannel.invoke.start` doc: now "The new row's sessionId." After: the new row's sessionId; a pool project's row
  opens resting and starts its agent once a clone on the branch is claimed; throws, opening nothing, on an unknown
  project, a missing or stray branch, a profile other than the project's, no pool provider, or a pool with no clones.
- New invoke members with comments: `projects` — chat's checked projects in settings order; `branches` — pinned
  first, then every other origin branch newest commit first, rejecting for a folder or unknown project or with no
  provider; `projectPastSessions` — the saved sessions of every folder the project covers under the profile, newest
  first, each with its folder.
- `ChatSessionInfo`: add a comment on `projectDir`: a pool project's row moves once, from the pool's lowest clone to
  the claimed one, before its process starts.
- `ChatMainEvents` comment on `sessionOpened`: add that a pool project's row fires it when its claim lands, with the
  clone as `projectDir` and after its slots exist, and fires none (nor `sessionClosed`) when its claim fails or the
  row closes first.
- `ChatMainExports.launch` doc: add the project rejections above and that a pool project's launch resolves once the
  row is open, its first message waiting for the claim.

`src/plugins/chat/main/chat-sessions.ts`

- `ChatSessionsDeps`: the four new members with comments (`projects` read at each start; `poolProvider` the newest
  registered, read at each pool start, branch list and past-session read; `homeDir` and `paths` expand a folder
  project's `~`); `sessions` Pick gains `'relocate'`.
- `ChatSessions.start` doc: now "Opens a row selected; a request with `headless` true opens it headless." After: adds
  the target resolution, the claim on a pool row, and the rejections. `ChatSessions.launch` doc: adds that a pool
  project's first message is queued until the claim lands and returned to the box when it fails. Add docs for
  `branches` and `projectPastSessions`. `closed` doc: a claiming row's claim is aborted and it fires no
  `sessionClosed`. `detachAll` doc: aborts every running claim. `clear` doc: throws on a row with a claim.
- `HeldSession.claim` as above; `openRow` and its comment (a row with a claim emits no `sessionOpened`); the new
  `emitSessionOpened`; `snapshot` filter and its comment; `waits` comment (a claiming row waits); `startNew` takes the
  resolved folder instead of reading `request.projectDir`; `launch` and its log line; `fireSessionClosed` call sites
  in `closed` skip a row with a claim; `writeAtIdle`, `sendAllNowSettled`, `sendNow`, `clear`, `detachAll` per the
  table.
- `createChatSessions` block comment gains: the pool claims a project's new rows wait on.

`src/plugins/chat/main/start-session-tool.ts`: `START_SESSION_TOOL`, `StartSessionToolDeps`, `StartSessionArgs`
(`project?: unknown; branch?: unknown`), `chooseProfile` (takes the project's own profile), `startSession`.

`src/plugins/usage/main/selftest-script.test.ts:57`: `calls.push(\`launch ${'projectDir' in request ?
request.projectDir : request.project}\`)`.

## Behaviour

- GIVEN a folder project `AI Dev` at `~/ai-dev` WHEN `start({ project: 'AI Dev', branch: null, profile: 'personal' })`
  THEN a row opens selected in `/home/me/ai-dev` and its process starts there at once, with no claim.
- GIVEN a pool project WHEN it starts on `main` THEN `start` returns the row id at once, the row rests in the pool's
  first clone with `Claiming a Unity clone on main…`, no process runs, no `sessionOpened` fires, and the provider gets
  `{ pool, branch: 'main', hostSessionId: <the row's host id>, rowId: <the row id> }`.
- GIVEN that claim WHEN it answers `{ ok: true, path: <clone 2> }` THEN sessions relocates the row, `chat.session`'s
  `projectDir` reads clone 2, `sessionOpened` fires with clone 2, the process starts there under the same host id, and
  the saved snapshot holds the row in clone 2.
- GIVEN a claim WHEN it answers `ok: true` with a note THEN the note shows as an info notice and the agent starts.
- GIVEN a claim WHEN it answers `ok: false` THEN the row shows `Unity clone not claimed: <message>`, stays resting in
  the placeholder, is absent from every saved snapshot, and a send on it rejects with `CLAIM_FAILED_TEXT`.
- GIVEN a claiming row WHEN the user closes it, or chat detaches THEN the claim's signal aborts, and a result landing
  later starts nothing.
- GIVEN a pool launch WHEN the claim lands THEN its message is the process's first send.
- GIVEN a rejected target (unknown project, null branch on a pool, a branch on a folder, another profile, no
  provider, no clones) WHEN start or launch runs THEN it throws its text and opens nothing.
- GIVEN the `projects` setting changes WHEN chat hears it THEN the namer is re-asked once; another setting's change
  re-asks nothing.
- GIVEN `start_session` with `project` WHEN called THEN it launches by project with the profile rule above and never
  stats a folder.

## Tests

Read `wigley:writing-tests` (`plugins/wigley/skills/writing-tests/SKILL.md` in the marketplace clone) before writing.
Messages are matched by the fragment that carries the caller's data, except the notice texts, which the user reads in
the row and the page's tests and task 05 pin: assert those whole.

**Harness changes in `chat-sessions.test.ts` `setUp`.** Options gain `projects?: ChatProject[]` (default `[]`) and
`poolProvider?: PoolProvider | null` (default null). Deps gain `projects: () => options.projects ?? []`,
`poolProvider: () => options.poolProvider ?? null`, `homeDir: '/home/me'`, `paths: posixPaths`. The fake `sessions`
gains `relocate: (sessionId, projectDir) => relocated.push([sessionId, projectDir])`, and `relocated` is returned.
A test double `fakePoolProvider(folders: Record<string, string[]>)` returns `{ provider, claims, branchCalls }`:
`folders(pool)` answers the record or `[]`; `branches(pool, refresh)` records `[pool, refresh]` and resolves the
double's `branchesAnswer` (default `['feature/x', 'main']`); `claim(request, signal, queued)` records `{ request,
signal, queued, settle }` and returns a promise `settle(result)` resolves. Fixtures:

```ts
const NEW_GAMES: ChatProject = { kind: 'pool', name: 'New Games', pool: 'ng', profile: 'work', pinnedBranches: ['main'] };
const AI_DEV: ChatProject = { kind: 'folder', name: 'AI Dev', folder: '~/ai-dev', profile: null };
const CLONES = { ng: ['/pool/ng-1', '/pool/ng-2'] };
```

New `describe('createChatSessions projects')` in `chat-sessions.test.ts`; every pool test restores
`NOTHING_SAVED` first so saving runs.

1. **`start_folderProject_StartsInTheExpandedFolder`** — `start({ project: 'AI Dev', branch: null, profile:
   'personal' })`: `opened[0].projectDir` and `harness.processes[0].request.projectDir` are `'/home/me/ai-dev'`,
   `claims` is empty. Break: `~` not expanded; a folder project routed through a claim.
2. **`start_RejectedTarget_ThrowsAndOpensNothing: $name`** (`it.each`): each row asserts `toThrow(<fragment>)`,
   `opened` `[]`, and `claims` `[]`.

   | name | projects | provider | request (profile `work` unless named) | fragment |
   |---|---|---|---|---|
   | an unknown project names the known ones | `[NEW_GAMES, AI_DEV]` | `CLONES` | `{ project: 'Nope', branch: null }` | `New Games, AI Dev` |
   | an unknown project with none set | `[]` | `CLONES` | `{ project: 'Nope', branch: null }` | `Projects: none` |
   | a pool project with no branch | `[NEW_GAMES]` | `CLONES` | `{ project: 'New Games', branch: null }` | `name a branch` |
   | a folder project with a branch | `[AI_DEV]` | `CLONES` | `{ project: 'AI Dev', branch: 'main' }` | `takes no branch` |
   | a profile other than the pool project's | `[NEW_GAMES]` | `CLONES` | `{ project: 'New Games', branch: 'main' }`, profile `personal` | `profile work, not personal` |
   | a profile other than the folder project's | `[{ ...AI_DEV, profile: 'work' }]` | `CLONES` | `{ project: 'AI Dev', branch: null }`, profile `personal` | `profile work, not personal` |
   | no provider registered | `[NEW_GAMES]` | null | `{ project: 'New Games', branch: 'main' }` | `No Unity pool provider` |
   | a pool with no clones | `[NEW_GAMES]` | `{}` | `{ project: 'New Games', branch: 'main' }` | `Pool "ng" has no clones` |

   Break: a check dropped or moved after `openRow`; the fixed profile not compared.
3. **`start_PoolProject_OpensRestingInTheFirstCloneAndClaims`** — returns `ROW_ID` synchronously; `opened[0].projectDir`
   `'/pool/ng-1'`; `openOptions` `[{ select: true }]`; `harness.processes` `[]`; the row's entries are one info notice
   `Claiming a Unity clone on main…`; `claims[0].request` equals `{ pool: 'ng', branch: 'main', hostSessionId:
   'uuid-1', rowId: ROW_ID }`; no `sessionOpened` emitted; the last saved snapshot's `sessions` is `[]`. Break: the
   agent started in the placeholder; the row saved mid-claim; wrong ids to the claim.
4. **`claim_Lands: $name`** (`it.each`): settle the claim, `await flush()`, then assert `relocated` `[[ROW_ID,
   '/pool/ng-2']]`, the slot's `projectDir` `'/pool/ng-2'`, `processes[0].request` `projectDir` `'/pool/ng-2'` and
   `sessionId` `'uuid-1'`, one `sessionOpened` with `projectDir: '/pool/ng-2'` and `origin: 'new'`, the last saved
   snapshot holding one record with `projectDir: '/pool/ng-2'`, and the row's notices (text and tone) equal the row's.

   | name | result | notices |
   |---|---|---|
   | ok | `{ ok: true, path: '/pool/ng-2', note: null }` | `[['Claiming a Unity clone on main…','info']]` |
   | diverged keeps the clone with the note | `{ ok: true, path: '/pool/ng-2', note: 'main diverged from origin' }` | `[['Claiming a Unity clone on main…','info'], ['main diverged from origin','info']]` |

   Break: relocate or the slot move skipped; started before the move; no save after; the note dropped.
5. **`claim_Queued_ShowsTheWaitingNoticeOnce`** — call `claims[0].queued()` twice: exactly one `Waiting for a Unity
   clone…` info notice. Break: a notice per call.
6. **`claim_Fails_RowRestsUnsavedAndRefusesSends`** — settle `{ ok: false, error: 'dirty', message: 'clone 2 has
   uncommitted changes' }`: the last notice is `Unity clone not claimed: clone 2 has uncommitted changes`, tone
   `error`; `processes` `[]`; `relocated` `[]`; after `chat.titleChanged(ROW_ID)` the last saved snapshot's `sessions`
   is `[]`; `chat.send(ROW_ID, IDLE_SEND)` rejects with `This session has no Unity clone`, and `processes` stays `[]`;
   `chat.clear(ROW_ID)` throws the same. Break: a failed row saved; a send starting the agent in the unclaimed
   placeholder.
7. **`claimingRow_SendQueuesUntilTheClaimLands`** — while claiming, `chat.send(ROW_ID, IDLE_SEND)`: `processes` `[]`
   and `chat.queued` holds it; `clear` throws `still claiming`; settle ok: `processes[0].calls` equals `[{ method:
   'send', text: 'idle send', imageCount: 0 }]`. Break: a send during the claim starting a process.
8. **`claimingRow_Closed_AbortsAndIgnoresTheResult`** — `chat.closed(ROW_ID, 'user')`: `claims[0].signal.aborted`
   true; no `sessionClosed` emitted; `ownedEnds()` 1; settle ok afterwards: `relocated` `[]`, `processes` `[]`, the
   log holds `claim for session row-1 settled after its row closed`. Break: the signal not aborted; a late landing
   starting a process for a gone row.
9. **`detachAll_AbortsARunningClaim`** — `await chat.detachAll()`: `claims[0].signal.aborted` true; settle ok:
   `processes` `[]`. Break: a relaunch leaving the CLI running.
10. **`launch_PoolProject_SendsTheFirstMessageOnceStarted`** — `launch({ project: 'New Games', branch: 'main',
    profile: 'work', message: { text: 'fix the chip', images: [] } })` returns `ROW_ID`; `openOptions` `[{ select:
    false }]`; `processes` `[]`; settle ok: `processes[0].calls` equals `[{ method: 'send', text: 'fix the chip',
    imageCount: 0 }]`; `sessionOpened` carries `origin: 'launched'`. A second case in the same test file,
    **`launch_PoolProject_ClaimFails_ReturnsTheMessageToTheBox`**: settle `ok: false`; `sentReturned()` holds `fix
    the chip` for `ROW_ID`. Break: the first message lost or written before the process exists.
11. **`claim_LandsButStartThrows_RestsInTheCloneSaved`** — `harness.failNextStart('boom')` before settling ok: last
    notice `Claude did not start: boom`, tone `error`; one `sessionRested` with error `boom`; the last saved snapshot
    holds the row in `/pool/ng-2`. Break: an unhandled rejection; the row left claiming.
12. **`projectPastSessions_MergesEveryCoveredFolder: $name`** (`it.each`) — under profile `personal`; asserts the
    `listSessions` calls' `projectDir`s (`harness.pastSessionCalls`) and the rows' `[hostSessionId, projectDir]` pairs
    in order (the fake lists `FAKE_PAST_SESSIONS` for every folder).

    | name | project | listed folders | rows |
    |---|---|---|---|
    | a pool's clones, newest first across them | `New Games` | `['/pool/ng-1','/pool/ng-2']` | `[[ONE,'/pool/ng-1'],[ONE,'/pool/ng-2'],[TWO,'/pool/ng-1'],[TWO,'/pool/ng-2']]` |
    | a folder project's expanded folder | `AI Dev` | `['/home/me/ai-dev']` | `[[ONE,'/home/me/ai-dev'],[TWO,'/home/me/ai-dev']]` |

    (`ONE`/`TWO` are `PAST_ONE.sessionId`/`PAST_TWO.sessionId`.) Plus `projectPastSessions('Nope', 'personal')`
    rejects with `Unknown project`. Break: one clone listed; rows per folder concatenated rather than sorted;
    `projectDir` missing.
13. **`branches_PinnedFirstAndRejections: $name`** (`it.each`) — `branchesAnswer` `['feature/x', 'main']`.

    | name | provider | project | result |
    |---|---|---|---|
    | pinned first, refresh passed on | `CLONES` | `New Games`, refresh `true` | resolves `['main','feature/x']`; `branchCalls` `[['ng', true]]` |
    | a folder project | `CLONES` | `AI Dev` | rejects `is a folder: it has no branches` |
    | an unknown project | `CLONES` | `Nope` | rejects `Unknown project` |
    | no provider | null | `New Games` | rejects `No Unity pool provider` |

    Break: pinned order ignored (proves the `branchChoices` wiring once; its cases are 02's); `refresh` dropped.

**`start.test.ts`.** `startChatPart` options gain `projects?: ProjectSetting[]`; its settings answer `projects:
options.projects ?? []` (unless 02 added it); the fake `sessions` gains `addProjectNamer(namer)` recording the namer
and returning `{ changed: () => namerChanges.count++, dispose: () => undefined }`, and `relocate`; the fake `services`
gain `homeDir: '/home/me'` and `paths.expandTilde` (`posixPaths.expandTilde`).

14. **`projectNamer_NamesAFolderUnderAProject`** — projects `[{ name: 'AI Dev', folder: '/home/me/ai-dev' }]`: the registered namer answers `'AI Dev'` for `/home/me/ai-dev/wigley-ai-gui` and null for
    `/elsewhere`; `namerChanges.count` is 1 after start. Break: the namer not registered, or not asked once at start.
15. **`settingsChange_ReasksTheNamerOnlyWhenProjectsChange: $name`** (`it.each`): rows `projects changed` (new list →
    `namerChanges` +1 and the namer answers by the new list), `another setting changed` (same `projects`, other
    `keepIdleMinutes` → +0). Break: the cache never refreshed; every settings change regrouping every row.
16. **`branches_ThroughTheRegisteredProvider`** — `exports.addPoolProvider(<double with folders {ng: [...]}>)`;
    `namerChanges` +1 at the registration; `invoke('branches', 'New Games', false)` resolves pinned first. Break: the
    channel not wired to chat-sessions, or the registry not passed to it.

**`start-session-tool.test.ts`.** `Row` gains `projects?: ChatProject[]` (default `[AI_DEV_TOOL, NEW_GAMES_TOOL]`:
`{ kind: 'folder', name: 'AI Dev', folder: '/dev/ai', profile: null }` and `{ kind: 'pool', name: 'New Games', pool:
'ng', profile: 'work', pinnedBranches: [] }`); `toolSession` passes `projects: () => row.projects ?? <default>`. New
`ROWS` entries (every existing row stays and still passes):

| name | args | launched / errors | statCalled |
|---|---|---|---|
| a folder project takes the caller's default profile | `{ prompt: 'go', project: 'AI Dev' }` | `{ project: 'AI Dev', branch: null, profile: 'home', message: message('go'), headless: false }`; success `Launched session row-7 in project AI Dev under profile home. A failure to start shows on its row.` | false |
| a pool project's own profile beats the caller's default | `{ prompt: 'go', project: 'New Games', branch: 'main' }` | `{ project: 'New Games', branch: 'main', profile: 'work', … }`; success `Launched session row-7 in project New Games on branch main under profile work. It starts once a Unity clone on main is claimed; a failure shows on its row.` | false |
| a named profile beats the caller's default | `{ prompt: 'go', project: 'AI Dev', profile: 'work' }` | profile `work` | false |
| a named profile other than the project's goes to chat to refuse | `{ prompt: 'go', project: 'New Games', branch: 'main', profile: 'home' }` | profile `home` | false |
| folder and project together | `{ prompt: 'go', folder: '/other', project: 'AI Dev' }` | errors `['folder', 'project']` | false |
| a branch with no project | `{ prompt: 'go', branch: 'main' }` | errors `['branch']` | false |
| a blank project | `{ prompt: 'go', project: '  ' }` | errors `['project']` | false |
| a non-string branch | `{ prompt: 'go', project: 'New Games', branch: 7 }` | errors `['branch']` | false |

Breaks: a project launch statting the caller's folder; the fixed profile ignored; the named profile silently replaced;
folder and project both accepted.

## Done when

`npm run typecheck`, `npm run lint`, and `npm test -- src/plugins/chat/main/chat-sessions.test.ts
src/plugins/chat/main/start.test.ts src/plugins/chat/main/start-session-tool.test.ts
src/plugins/usage/main/selftest-script.test.ts` pass. The chat self-test is not run here: the start prompt changes in
05, and the self-test's starts still name folders.

## Commit

One commit for the group, e.g.: `Chat starts sessions from projects: a folder project starts in its folder, a pool
project's row waits on a clone claim and starts the agent in the claimed clone; chat names rows' projects for the
side bar, lists projects, branches and project sessions on its channel, and start_session takes project and branch`.

## Proof

