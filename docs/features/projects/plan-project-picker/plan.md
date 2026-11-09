# Project picker — plan

Feature: Projects · Implements: none · Ticket: none
Target: main (wigley-ai-gui) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A new session starts from a **project** instead of a folder. New Games (a `unity-pool` pool) always runs under the
`work` profile and asks for the branch, pinned branches first; the app claims a clone on that branch and starts the
agent inside it. Wigley AI Dev (a folder project, `~/Documents/ai-dev`) asks for the profile and starts there with
nothing checked out. The side bar groups sessions by project, and `start_session` can start a project session.

## Architecture

Systems touched, all in `wigley-ai-gui`:

- **chat** (`src/plugins/chat/`) owns projects: the `projects` setting, the membership rule, the `addPoolProvider`
  registration, the start path, the start prompt's Project and Branch steps, and `start_session`.
- **sessions** (`src/plugins/sessions/`) gains `addProjectNamer` (a row's project from a registered rule, before the
  origin-repo lookup) and `relocate` (moves a row that has not started to another folder).
- **unity-pool** (`src/plugins/unity-pool/`) registers as chat's pool provider: clone folders, branch list, claim.
- **contracts** (`src/contracts/processes.ts` and its adapter) gain `setEnv` so the claim runs under a session's ids.

Dependency direction stays as it is: unity-pool → chat → sessions. Chat never imports unity-pool.

## Preconditions

Re-run each before the first dispatch.

- `git -C <worktree> log --oneline -1` is at or after `ef3408e9` and holds the docs commit named below.
- `grep -n "dependsOn" src/plugins/unity-pool/manifest.ts` shows `main: ['sessions', 'chat']`, and
  `src/plugins/chat/manifest.ts` shows no `unity-pool` (the reason chat exports a registration).
- `grep -n "rowId" src/plugins/sessions/contract.ts` shows `OpenOptions.rowId` (measured at plan time; the restore
  path uses it, this plan does not).
- `grep -n "session-id" src/main/claude-code/claude-launch.ts` shows chat passes `--session-id` for a new session, so
  the host session id is known before the process starts.
- `grep -n "WIGLEY_SESSION_ROW\|CLAUDE_CODE_SESSION_ID" ~/wigley-agents/tools/unity-pool/unitypool/commands.py`
  shows the claim's holder read from those two variables (`current_holder`), and `policy.py` `renew` touches only
  `renewedAt` — so the row id must be in the claim's environment.
- `git -C ~/Documents/dev/peoplefun/new-games-prototypes for-each-ref refs/remotes/origin | wc -l` — about 430
  (measured at plan time, re-verify): the Branch step must filter.

## Docs written ahead

Commit `caee8922` on branch `project-picker`:

- `docs/features/projects/design.md` (new) — the feature's design; every task reads it.
- `docs/features/agent-chat/design.md` — the Flow block and the Start prompt and Resume bullets.
- `docs/features/session-groups/design.md` § Projects — the namer before the origin lookup.
- `docs/features/unity-pool/design.md` — § Claims for a project; "claiming from the app" left out-of-scope removed.
- `AGENTS.md` — the chat, sessions and unity-pool lines of the plugin map.

## Mandatory Reads

- `AGENTS.md` (root) — the sections on plugin parts, `dependsOn` and exports, settings (`settingInfo`,
  `optionalSettings`, array element checks), the layer rules, and testing. Every task.
- `docs/features/projects/design.md` — every task.
- `docs/features/agent-chat/design.md` § Chat plugin (Start prompt, Resume and archive, Starting a session from an
  agent) — tasks 03, 05.
- `docs/features/session-groups/design.md` § Projects — task 01.
- `docs/features/unity-pool/design.md` and `~/wigley-agents/tools/unity-pool/README.md` § Claims, § Branch sync on
  claim, § Commands — task 04.
- No `CLAUDE*.md` or `.claude/rules/` exist in the repo (checked at plan time).

## Design Overview

```
Space b n
  └─ Project step ── New Games (pool) ──► Branch step (pinned, then origin newest-first, /filter)
       │            └ Wigley AI Dev (folder) ──► Profile step (no fixed profile)
       │            └ Other folder… ──► the old Folder step
       ▼
  sign-in check ─► session step (project's saved sessions from every covered folder | new)
       ▼
  channel start({project, branch, profile})                      [chat main]
       ├─ folder project: startNew in the project's folder (as a folder start)
       └─ pool project:
            openRow(placeholder = pool's lowest clone, notice "Claiming a Unity clone on <b>…")
            provider.claim({pool, branch, hostSessionId, rowId}, signal, onQueued)   [unity-pool main]
                 └─ python unity-pool claim --branch b --pool p --wait --json
                    env CLAUDE_CODE_SESSION_ID=<hostId>, WIGLEY_SESSION_ROW=<rowId>
            ok      → sessions.relocate(row, clone) → chat slot projectDir → startProcess → save
            diverged→ same as ok, plus an info notice with the CLI message
            error   → row stays resting, error notice; nothing saved
            row closed meanwhile → signal aborts the CLI
  sessions row.project = first namer's name (chat: projectOf) ?? origin repo name
```

Decisions (from the interview, by round):

- Projects first, **Other folder…** opens the old folder step unchanged (round 1).
- Settings shape: `folder` xor `pool`, optional fixed `profile`, `pinnedBranches` for a pool (round 1).
- Branch list: pinned, then every origin branch newest-first, filtered by typing (round 1).
- The app claims before the agent starts, in the clone it got (round 1).
- Membership is worked out from the folder, never stored; the side bar groups by it (rounds 1, 2).
- `start_session` and `launch` take `project` and `branch` (round 2).
- The claim waits on the row, opened at once; closing the row cancels (round 3).
- Chat owns projects; unity-pool registers through `addPoolProvider` (design review: unity-pool already depends on
  chat).
- `projectOf` is one pure function, tested as a table (design review).
- A bad project entry is skipped and logged (design review).
- A row is not written to `open-sessions.json` until its claim lands, so a relaunch mid-claim drops it rather than
  restoring a resting row in the placeholder clone (plan time).
- A start whose `profile` differs from the project's fixed `profile` rejects (plan time: fail loud).
- Resume of a pool project's saved session runs in its saved clone with no claim (round 1 notice).
- `chat.projects` defaults to `[]`; the user's two projects are written into `settings.json` by task 07.
- A pool project's row fires `chat.sessionOpened` when its claim lands, in the claimed clone, not when the row
  opens; a row whose claim fails or closes mid-claim fires neither `sessionOpened` nor `sessionClosed` (plan time:
  session-log, usage, workflow and session-stash record `projectDir` from it).
- `relocate` emits `sessions.relocated`, and docs and workflow re-read the folder on it, as they re-read the host id
  on `hostSessionChanged` (plan time: both copy `projectDir` at connect).
- The Branch step's refresh reopens the list with the typed filter kept (`ListPickerRequest.keepFilter`), rather than
  clearing what the user typed while the fetch ran (plan time).

Out of scope: a structured settings editor for projects; Codex claims; changes to the `unity-pool` tool itself.

## File Structure

Existing files modified:

- `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts`, `src/plugins/sessions/main/start.ts`,
  `src/plugins/sessions/main/consumer-view.ts` (01)
- `src/plugins/docs/main/start.ts`, `src/plugins/workflow/main/start.ts` (01b)
- the design docs of workflow, docs-browser, session-log, usage and session-stash, where stale (06)
- `src/plugins/chat/contract.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/chat/main/start.ts` (02, 03)
- `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/start-session-tool.ts`,
  `src/plugins/chat/main/chat-slots.ts` (`SessionSlots.relocate`), `src/plugins/usage/main/selftest-script.test.ts`
  (reads `projectDir` off a `LaunchRequest`) (03)
- `src/contracts/processes.ts`, `src/main/processes/node-processes.ts`, `src/shared/fake-processes.ts`,
  `src/plugins/unity-pool/main/pool-cli.ts`, `src/plugins/unity-pool/main/start.ts`,
  `src/plugins/unity-pool/manifest.ts` (doc comment only) (04)
- `src/plugins/chat/page/start-prompt.ts`, `src/plugins/chat/page/start-prompt-items.ts`,
  `src/plugins/chat/page/picker-row.ts`, `src/plugins/chat/page/resume-items.ts`, `src/plugins/chat/page/picker.ts`,
  `src/contracts/list-picker.ts`,
  `src/shared/page/list-picker.ts` (05)

New files:

- `src/plugins/chat/main/projects.ts` (+ `projects.test.ts`) — `readProjects`, `projectOf`, `branchChoices`: the
  pure rules, apart from `chat-sessions.ts` (already 118k) so the table tests need no session harness.
- `src/plugins/unity-pool/main/pool-provider.ts` (+ test) — the provider over the CLI runner, the snapshot and git.

Shared names and signatures (every task uses these words exactly):

```ts
// src/plugins/chat/contract.ts — 02
export interface ProjectSetting {            // one element of the `projects` setting as written
  name: string;
  folder?: string;
  pool?: string;
  profile?: string;
  pinnedBranches?: string[];
}
export type ChatProject =                    // one checked entry
  | { kind: 'folder'; name: string; folder: string; profile: string | null }
  | { kind: 'pool'; name: string; pool: string; profile: string | null; pinnedBranches: readonly string[] };

export interface PoolClaimRequest { pool: string; branch: string; hostSessionId: string; rowId: string }
export type PoolClaimResult =
  | { ok: true; path: string; note: string | null }   // note: the CLI's message on `diverged`, else null
  | { ok: false; error: string; message: string };
export interface PoolProvider {
  folders(pool: string): readonly string[];                       // clone paths by number; [] for an unknown pool
  branches(pool: string, refresh: boolean): Promise<string[]>;    // origin branch names, newest commit first
  claim(request: PoolClaimRequest, signal: AbortSignal, queued: () => void): Promise<PoolClaimResult>;
}
// ChatMainExports gains:
addPoolProvider(provider: PoolProvider): Disposable;              // the newest registered answers

// src/plugins/chat/contract.ts — 03
export type StartTarget = { projectDir: string } | { project: string; branch: string | null };
export type StartRequest = StartTarget & { profile: string; headless?: boolean };
export type LaunchRequest = StartTarget & { profile: string; message: UserMessage; unattended?: boolean; headless?: boolean };
export interface ProjectPastSessionRow extends PastSessionRow { projectDir: string }
// ChatChannel.invoke gains:
projects(): ChatProject[];
branches(project: string, refresh: boolean): Promise<string[]>;   // pinned first, then the rest; rejects for a folder or unknown project, or with no provider
projectPastSessions(project: string, profile: string): Promise<ProjectPastSessionRow[]>;

// src/plugins/chat/main/projects.ts — 02
export function readProjects(raw: readonly ProjectSetting[], log: (line: string) => void): ChatProject[];
export function projectOf(folder: string, projects: readonly ChatProject[],
  poolFolders: (pool: string) => readonly string[], homeDir: string,
  paths: Pick<Paths, 'isInside' | 'expandTilde'>): ChatProject | null;   // callers pass services.paths
export function branchChoices(pinned: readonly string[], origin: readonly string[]): string[];
export interface PoolProviders { add(provider: PoolProvider): Disposable; current(): PoolProvider | null }
export function createPoolProviders(): PoolProviders;   // chat start.ts holds one; addPoolProvider is its add
// readProjects keeps `~` unexpanded; every caller expands a folder with paths.expandTilde(folder, homeDir).

// src/plugins/sessions/contract.ts (SessionsMainExports) — 01
export type ProjectNamer = (projectDir: string) => string | null;
export interface ProjectNamerHandle extends Disposable { changed(): void }   // changed(): re-ask every row
addProjectNamer(namer: ProjectNamer): ProjectNamerHandle;
relocate(sessionId: string, projectDir: string): void;
// SessionsMainEvents gains (01; docs and workflow listen in 01b):
relocated: AgentSession;

// src/contracts/list-picker.ts (ListPickerRequest) — 05
keepFilter?: boolean;   // open while already open keeps the typed filter

// src/contracts/processes.ts (ProcessRunOptions) — 04
setEnv?: Readonly<Record<string, string>>;
```

Boundary rules: chat imports no unity-pool file; sessions imports no chat file; unity-pool reads chat only through
`chatMainKey`. The pure modules (`projects.ts`, `pool-provider.ts`'s parsers) take every input as a parameter.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Sessions: project namers and relocate](01-sessions-namer-relocate.md)
- [x] [Chat: projects setting, membership and pool provider registry](02-chat-projects-core.md)

### Wave 2
- [x] [docs and workflow follow a relocated row](01b-relocated-listeners.md) — after 01
- [x] [Chat: start path for projects, channels and start_session](03-chat-project-start.md) — after 01, 02
- [x] [unity-pool: pool provider](04-unity-pool-provider.md) — after 02

### Wave 3
- [x] [Start prompt: Project, Branch and Other folder steps](05-start-prompt-steps.md) — after 03

### Wave 4
- [x] [Doc re-read](06-doc-re-read.md) — after 04, 05

### Wave 5
- [ ] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: 7ec307f1

### Groups
- 01 · fdaa002d · diff read (all Produces present word for word), typecheck and lint clean, session-list and start tests pass · concerns: test 5 catches a stale group but not a stale number (test 4 covers the number); addEntry asks namers before tool sessions start, so a throwing start has asked a namer for a session that never exists
- 02 · 3a2a0444 · diff read (every Produces present; ChatProject pool variant only reformatted), typecheck and lint clean, projects.test.ts 36 pass · concerns: readProject casts pool as string since unknown does not narrow; branchChoices relies on Set insertion order
- 04 · 006640e7 · diff read (every Produces present), typecheck and lint clean on the whole tree after 03, unity-pool and node-processes tests 173 pass · concerns: a part stop aborts the follow-up release of a cancelled claim, so a granted clone falls to pool expiry; a release for a session that never got a clone answers not-holder, only logged; scriptPath setting description and unity-pool design § Status left stale for 06
- 03 · f979b7c1 · diff read (StartTarget, StartRequest, LaunchRequest, ProjectPastSessionRow, channel projects/branches/projectPastSessions, SessionSlots.relocate present), typecheck and lint clean, chat and usage tests 1764 pass · concerns: claimSettled has no trailing catch, so a throw outside its two try blocks is an unhandled rejection; a profile configDir change mid-claim gives sessionOpened the old one; a move throwing after sessions.relocate leaves sessions' row in the clone while chat's slot may name the placeholder; worker ran npx vitest once (the repo's own vitest, nothing installed)
- 01b · 29ab3be6 · diff read (docs and workflow both hear sessions.relocated), typecheck and lint clean after 03, docs and workflow start tests 103 pass · concerns: none
- 05 · 503785ff · diff read (every Produces present); typecheck 0, lint 0, chat+shared-page vitest 2390 passed · concerns: branch reopen reads picker.cursorIndex() assuming the Branch request is still open; cached branch list may open the step after the refresh failed (ruling); list-picker.test filteredPickerSetup now records filter text
- 06 · 43746236 · diff read; lint 0, typecheck 0 (worker); AGENTS.md, agent-chat Flow and Resume bullets checked with no change · concerns: none
### Contract changes
- runPoolClaim deps: as planned → gains log; releaseCommandArgs and lastLine exported from pool-cli.ts; pool-watch.ts exports STATE_FILE · why: the release after a cancelled claim runs inside runPoolClaim, which alone holds the script path and python command · consumers: 04 only · group 04
- emitSessionOpened (private): (session, profileName, profileDir, origin) → (row: {sessionId, hostSessionId, projectDir}, profileName, profileDir, origin) · why: openRow emits before the HeldSession exists, and a claim landing emits with the clone · consumers: none outside chat-sessions.ts · group 03
- 05 (additions, own files): projectName exported from start-prompt-items.ts; SessionItem/sessionItems/withArchived generic over the row type (default PastSessionRow)
### Rulings
- A project lookup landing for an entry the list no longer holds, or for a folder the session no longer holds, changes nothing — closes a reused-rowId hazard — a late project would be lost only for an ended entry · group 01 · group 01
- The consumer view relocates only sessions that dependent opened, throwing otherwise; it wraps end before filing it so a dependent's stop forgets the id — chat must relocate through its own sessions view, which it does — a plugin relocating another's row would throw · group 01 · group 01
- relocate has no isStopped check, since the task named none — a relocate after sessions stops would write a row — low, owners stop with sessions · group 01 · group 01
- A JSON null counts as absent for every key of a project entry, not only folder and profile — matches the null-as-absent decision — a null pinnedBranches reads as none · group 02 · group 02
- A skipped entry's log line names a string name through JSON.stringify (empty shows as ""), any other as unnamed — cosmetic · group 02 · group 02
- plan.py resolves a task by its leading digits, so 01b resolves to 01; the lead sets 01b's Status and tick by hand, and keeps its Groups line through plan.py log — editor tooling only · lead
- HeldSession gains recordsRecentFolder, false for a pool row and a folder-project start, so a project row never records a recent folder on any process start in the run; not saved, so a restored project row records again — a project row's restarts stay out of recents · group 03 · group 03
- startNew checks profile and harness before resolveTarget, so an unknown profile's error wins over a project rejection — only which error text shows · group 03 · group 03
- A move that throws fails the claim with error code internal — plan named no code · group 03 · group 03
- start_session's chooseProject runs after the prompt check and before the profile choice, JSON null as absent for folder, project and branch; a project call never stats a folder · group 03 · group 03
- addPoolProvider's registration and its dispose each call namer.changed(), so rows in a pool's clones regroup when a provider comes or goes · group 03 · group 03
- Workflow overwrites its connected entry on relocated even for a row with none; the docs test pins the move through a Codex session's context run — relocate precedes sessionOpened by design · group 01b
- 05: the cached branch read still opens the Branch step after the refresh rejected; 'ignore the cached answer' applies only once the step is open — otherwise that order shows nothing and no toast
### Review rounds
### Test gate
