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

Commit `67a838d6` on branch `project-picker`:

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
- `src/plugins/chat/contract.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/chat/main/start.ts` (02, 03)
- `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/start-session-tool.ts`,
  `src/plugins/chat/main/chat-slots.ts` (`SessionSlots.relocate`), `src/plugins/usage/main/selftest-script.test.ts`
  (reads `projectDir` off a `LaunchRequest`) (03)
- `src/contracts/processes.ts`, `src/main/processes/node-processes.ts`, `src/shared/fake-processes.ts`,
  `src/plugins/unity-pool/main/pool-cli.ts`, `src/plugins/unity-pool/main/start.ts`,
  `src/plugins/unity-pool/manifest.ts` (doc comment only) (04)
- `src/plugins/chat/page/start-prompt.ts`, `src/plugins/chat/page/start-prompt-items.ts`,
  `src/plugins/chat/page/picker-row.ts`, `src/plugins/chat/page/resume-items.ts`, `src/contracts/list-picker.ts`,
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
- [ ] [Sessions: project namers and relocate](01-sessions-namer-relocate.md)
- [ ] [Chat: projects setting, membership and pool provider registry](02-chat-projects-core.md)

### Wave 2
- [ ] [docs and workflow follow a relocated row](01b-relocated-listeners.md) — after 01
- [ ] [Chat: start path for projects, channels and start_session](03-chat-project-start.md) — after 01, 02
- [ ] [unity-pool: pool provider](04-unity-pool-provider.md) — after 02

### Wave 3
- [ ] [Start prompt: Project, Branch and Other folder steps](05-start-prompt-steps.md) — after 03

### Wave 4
- [ ] [Doc re-read](06-doc-re-read.md) — after 04, 05

### Wave 5
- [ ] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
