# Builds — plan

Feature: Builds · Implements: none · Ticket: none
Target: `main` of the `ai` repo (`wigley-ai-gui/`) · Written: 2026-11-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Add a Builds feature to the app. The user sees the CI and local builds of the games they track,
queues builds and build sets (an RC set) with one press, sees the branch and commit of each build,
and follows progress in the app. A session that queues a build shows it under its row and in its
hub, and the app sends the session a message when a job fails and when the build ends, so no
agent waits on a background watch. An agent offers a build at a workflow's wrap-up with
`builds.offer`, and the user queues it from an offer card. Build backends are plugins, and each
machine's settings list the backends it uses: TeamCity on the work machine, local commands on the
personal one.

## Architecture

Three new plugins and one core change:

- `src/plugins/builds/` — the core of the feature: the backend seam, registry, setting, poller,
  pure model, session links, set runs, offers, commands, Builds mode, session parts, layout.
- `src/plugins/builds-teamcity/` — the `teamcity` backend kind over the `teamcity` CLI.
- `src/plugins/builds-local/` — the `local` backend kind: detached commands in a clone.
- `src/contracts/git.ts` and `src/main/git/` — two new reads: branch heads on origin, and a
  commit's subject.

Systems touched: the plugin registry (`src/plugins/manifests.ts`, `main.ts`, `page.ts`, in task 02), the
default keymap (`src/plugins/keymap.ts`), `README.md`, `CHANGELOG.md`, and possibly the layer
check's `PLUGIN_EXTRAS` (`scripts/check-layers.mts`).

## Preconditions

Each was checked at plan time on tip `74643ff2c` of the plan's worktree. `wigley:make` runs each
again before the first dispatch (from `/Users/jonathonwigley/Documents/ai/wigley-ai-gui` or the
run's worktree):

- No builds plugin exists: `ls src/plugins/builds` → "No such file or directory".
- The Git contract has neither new read: `grep -c "remoteHeads\|commitSubject" src/contracts/git.ts`
  → `0`.
- `<Leader>km` and a `<Leader>m` group are free:
  `grep -c "<Leader>km\|'<Leader>m" src/plugins/keymap.ts` → `0`.
- The TeamCity CLI is installed at the version whose flags the plan uses:
  `teamcity --version` → `teamcity version 1.7.0`.
- Chat main exports `send(sessionId, message)` and `launch(request)`:
  `grep -n "send(\|  launch(" src/plugins/chat/contract.ts` lists both.
- Sessions page exports `addRowPart` and `setActivity`; chat page exports `addComposerPart` and
  `addSidePart`: each `grep -n` over its contract lists it.
- A command declaration takes `risky?: true`: `grep -n "risky" src/contracts/plugin.ts`.
- `ProcessRunner.startDetached` returns `Promise<void>` (no pid):
  `grep -n "startDetached" -A5 src/contracts/processes.ts`. The local backend's wrapper writes its
  own pid file for this reason.
- A peer session runs the `shareable-app` plan on `main` (it edits `README.md`, `CHANGELOG.md`,
  `src/plugins/manifests.ts`, `main.ts`, `page.ts` and the workflow plugins). Rebase onto `main`
  at preflight, and read the chatroom board before landing.

## Docs written ahead

Commit `74643ff2c` (`builds: docs ahead of the builds plan`) holds, each marked "planned in
`builds`, not built yet" where it describes unbuilt code:

- `wigley-ai-gui/docs/features/builds/design.md` — the design every task follows
- `wigley-ai-gui/agent-plugin/skills/builds/SKILL.md` — the app's `builds` skill
- `wigley-ai-gui/AGENTS.md` — the three plugin entries in § Architecture, and the Git adapter's
  two new reads
- `wigley-ai-gui/docs/keymap.md` — `km` in the `k` row, and the new `m` row
- `wigley-agents/machine-skills/teamcity-builds/SKILL.md` and
  `wigley-agents/machine-skills/create-rcs/SKILL.md` — the "Through the app" paragraphs
- `wigley-ai-marketplace/plugins/wigley/skills/wrap-up/SKILL.md` — `builds.offer` in place of the
  `device build` chip (wigley 2.28.3)

## Mandatory Reads

Every implementer reads these before the first edit:

- `wigley-ai-gui/docs/features/builds/design.md` — whole
- `wigley-ai-gui/AGENTS.md` — § Intent, and in § Architecture the bullets **A plugin**,
  **A registration**, **A slot**, **A command**, **An event**, **A setting**, **Plugin data**,
  **A layout**, **An ambient service**, **A path**, and the `npm run lint` bullets at its end. Read
  it by line ranges: it is past the Read tool's limit (`wc -l` first).
- `wigley-ai-gui/DESIGN.md` — for tasks 06 and 07
- `wigley-ai-gui/docs/keymap.md` — § Adding a bind, for tasks 06 and 07
- `wigley-ai-gui/docs/features/layouts/design.md` — for tasks 06 and 07
- `wigley-ai-gui/docs/features/demo/design.md` — the step rules, for tasks 03, 06 and 07
- `~/wigley-agents/AGENTS.md` § Hard gates: install nothing (no `npm install`, no new package)

## Design Overview

```
 settings.json  builds.backends[]                 TeamCity server      a clone on disk
        │                                              ▲                     ▲
        ▼                                              │ teamcity CLI        │ detached command
 ┌──────────────── builds (main) ────────────────┐  ┌──┴──────────────┐  ┌───┴─────────────┐
 │ backend registry ◄── addBackend(kind) ────────┼──┤ builds-teamcity │  │ builds-local    │
 │ config parse → BuildBackend per entry         │  └─────────────────┘  └─────────────────┘
 │ poller (10 s shown/linked running, 2 min) ────┼─► BuildBackend.list / queue / cancel
 │ git.remoteHeads / commitSubject (game clone)  │
 │ links · set runs · offers  (plugin data)      │
 │ builds-model (pure fold) ─► builds.snapshot   │──► read_state (agents)
 │                          ─► builds.sessions   │
 │ endings ─► chat.send("Build failing:/ended:") │
 │ commands: queue (risky), offer, launchSetAgent│◄── run_command (agents)
 └──────────────┬────────────────────────────────┘
                │ slots + channel
 ┌──────────────▼──── builds (page) ─────────────┐
 │ Builds mode (Space k m): side bar, list, All, │
 │   detail, queue picker                        │
 │ row line (addRowPart) · building activity     │
 │ hub Builds section (addSidePart)              │
 │ offer card (addComposerPart)                  │
 └───────────────────────────────────────────────┘
```

**Decisions** (from the interview and the design review; the design doc holds the detail):

- Backend kinds are plugins that register through `builds`' main export `addBackend`; backend
  instances live in each machine's `builds.backends` setting.
- Tracked games are explicit entries in that setting; an agent writes them on the user's ask.
- Builds mode: games in the side bar under an All entry; the selected game's builds with its queue
  buttons; All shows one feed across games.
- Sessions show a row line and a hub Builds section; the row's activity reads `building`.
- The app messages the session when a linked build has a failed job (once) and when it ends; a
  set sends a summary when its last build ends.
- The wrap-up calls `builds.offer`; the offer card queues with one press.
- A set queues from an existing branch in one press; "with agent" launches a session with the
  set's `agentPrompt`.
- The local backend is a generic command backend; progress is elapsed over the last success.
- TeamCity goes through the `teamcity` CLI; it cannot cancel.
- Keys: `<Leader>km` Builds mode; `<Leader>mm` queue the offer, `<Leader>mx` dismiss it,
  `<Leader>mq` queue picker; in the mode `j` `k` `Enter` `q` `o` `x`.

**Out of scope**: clickable wrap-up chips; discovering TeamCity chains; REST with a token; a
TeamCity cancel; a progress regex for local builds; Windows wrapper testing on a Windows machine
(the wrapper line has a Windows form, checked only by its unit test).

## File Structure

### Existing files modified

| File | Task | Change |
|---|---|---|
| `src/contracts/git.ts` | 01 | two members on `Git` |
| `src/main/git/process-git.ts` | 01 | their adapter |
| `src/main/git/process-git.test.ts` | 01 | their tests |
| `src/contracts/files.ts` and every `Files` implementer | 01 | `readEnd` |
| every other `Git` implementer (fakes) | 01 | the two members |
| `src/plugins/keymap.ts` | 06, 07 | the `<Leader>km`, `<Leader>m*` and mode binds; the `m` group name |
| `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts` | 02 | register the three plugins' skeletons: `scripts/check-layers.mts` fails `npm run lint` on a plugin folder whose `manifest.ts`, `main/start.ts` or `page/start.ts` is missing from these lists, so every later task builds on registered parts |
| `scripts/check-layers.mts` | 02 | `PLUGIN_EXTRAS` entries, only if the lint asks for them |
| `README.md`, `CHANGELOG.md` | 08 | the plugins, commands, setting and skill |

### New files

- `src/plugins/builds/` — `manifest.ts`, `contract.ts`, `contract.test-support.ts`,
  `builds-model.ts` and its test, and empty `main/start.ts` and `page/start.ts` (02); `main/` (03);
  `page/` and `layouts/` (06, 07).
- `src/plugins/builds-teamcity/` — skeleton `manifest.ts` and empty `main/start.ts` (02); `main/`
  with its tests and recorded JSON (04).
- `src/plugins/builds-local/` — skeleton `manifest.ts` and empty `main/start.ts` (02); `main/` with
  its tests (05).

Task 02 declares in `builds/manifest.ts` the `backends` and `layout` settings, the main commands
and the slots. Tasks 06 and 07 add their own page commands and scopes to it.

### Shared names and signatures

Every task that names one of these uses it exactly as written here. Task 02 produces each in
`src/plugins/builds/contract.ts` unless a line names another file.

```ts
// Git (task 01, src/contracts/git.ts)
interface Git {
  // The branch heads on `origin` whose names match `pattern` (a `git ls-remote --heads`
  // pattern, such as `releases/physics-fun/*` or a full branch name), each with its full sha,
  // names without `refs/heads/`. Null when the command fails or times out.
  remoteHeads(root: string, pattern: string): Promise<GitRemoteHead[] | null>;
  // The one-line subject of `sha` in the clone at `root`; null when the clone lacks it.
  commitSubject(root: string, sha: string): Promise<string | null>;
}
interface GitRemoteHead { name: string; sha: string }

// Files (task 01, src/contracts/files.ts): the last `maxBytes` bytes as text, a character cut at
// the start left out; mirrors `readStart`.
interface Files { readEnd(path: string, maxBytes: number): Promise<string> }

// builds contract (task 02)
type BuildState = 'queued' | 'running' | 'finished';
type BuildResult = 'success' | 'failure' | 'cancelled';

interface BuildJob {
  id: string; label: string; state: BuildState; result: BuildResult | null;
  percent: number | null; leftSeconds: number | null; stepText: string | null;
}
interface BuildLink { label: string; url: string }
interface BuildRecord {
  id: string; gameId: string; kind: string;
  number: string | null; version: string | null;
  branch: string; revision: string | null;
  state: BuildState; result: BuildResult | null; statusText: string | null;
  percent: number | null; leftSeconds: number | null; stepText: string | null;
  queuedAt: number; startedAt: number | null; finishedAt: number | null;
  startEstimate: number | null;
  webUrl: string | null; links: BuildLink[]; jobs: BuildJob[];
  triggeredBy: string | null;
}

interface BuildKindEntry { label: string; target: unknown }        // target parsed by the backend
interface BuildSetEntry { id: string; label: string; kinds: string[]; branches: string; agentPrompt: string | null }
interface GameEntry {
  id: string; label: string; clone: string | null;                   // clone: `~` expanded
  defaultBranch: string; kinds: Record<string, BuildKindEntry>; sets: BuildSetEntry[];
}
interface BackendEntry { id: string; kind: string; label: string; config: unknown; games: GameEntry[] }

interface QueueRequest { kind: string; branch: string; revision: string | null }
interface BackendCapabilities { cancel: boolean; choosesBranch: boolean }
interface BuildBackend {
  readonly capabilities: BackendCapabilities;
  list(game: GameEntry, limit: number): Promise<BuildRecord[]>;
  queue(game: GameEntry, request: QueueRequest): Promise<{ id: string }>;
  cancel?(game: GameEntry, buildId: string): Promise<void>;
  dispose(): void;
}
interface BackendServices {                // what `builds` hands a backend kind's `create`
  processes: ProcessRunner; git: Git; files: Files;
  dataFiles: Files; dataFolder: string;    // this backend entry's own folder: builds data `backends/<entry id>/`
  paths: Paths; clock: Clock; timers: Timers; homeDir: string; platform: Platform;
  log(message: string): void;
}
interface BackendKind {
  kind: string; label: string;
  // async: a kind may run a program (`teamcity --version`) to find it is missing
  create(entry: BackendEntry, services: BackendServices): Promise<BuildBackend | { problem: string }>;
}
interface BuildsMainExports { addBackend(kind: BackendKind): Disposable }
const buildsMainKey: DependencyKey<BuildsMainExports>;   // the main process key

// published state
interface BuildRef { backendId: string; buildId: string }
interface SetRunView { id: string; setId: string; label: string; builds: BuildRef[]; revision: string | null }
interface GameView {
  backendId: string; game: GameEntry; builds: BuildRecord[];
  subjects: Record<string, string>;        // revision sha → commit subject
  setRuns: SetRunView[];
}
interface BackendView {
  id: string; kind: string; label: string; problem: string | null;
  capabilities: BackendCapabilities | null; games: GameView[];
}
interface BuildsSnapshot { backends: BackendView[]; polledAt: number | null }
// builds-model.ts (task 02): the one home of two display rules tasks 03, 06 and 07 share.
function kindLabel(game: GameEntry, kind: string): string;   // game.kinds[kind].label, else kind
function shortRevision(sha: string): string;                 // the first 8 characters
interface BuildOffer {
  backendId: string; gameId: string; kind: string; branch: string;
  revision: string | null; subject: string | null; createdAt: number;
}
interface SessionBuilds { builds: BuildRef[]; offer: BuildOffer | null }   // newest build first

const buildsSnapshotSlot: SlotKey<BuildsSnapshot>;          // 'builds.snapshot', main, value
const buildsSessionsSlot: KeyedSlotKey<SessionBuilds>;      // 'builds.sessions', main, keyed by session id

// page → main channel (`api.channel`). Written here as plain methods for reading; task 02 types it
// in the tree's `ChannelShape` form (`invoke` and `messages` records, called as
// `api.channel.invoke(...)`), one entry per method below.
interface BuildsChannel {
  setShown(shown: boolean): void;
  branches(arg: { backend: string; game: string; set: string | null }): Promise<GitRemoteHead[] | { problem: string }>;
  queue(arg: { backend: string; game: string; kind: string; branch: string; sessionId: string | null }): Promise<{ ok: true } | { problem: string }>;
  queueOffer(sessionId: string): Promise<{ ok: true } | { problem: string }>;
  dismissOffer(sessionId: string): void;
  cancel(arg: { backend: string; game: string; build: string }): Promise<{ ok: true } | { problem: string }>;
  launchSetAgent(arg: { backend: string; game: string; set: string }): Promise<{ ok: true } | { problem: string }>;
}
```

Test builders in `contract.test-support.ts` (02): `buildRecord(overrides)` and
`gameEntry(overrides)`. A rejected `create` or `list` becomes that backend's `problem` in the
snapshot, and the last good builds stay (03).

`Files`, `Paths`, `Clock`, `Timers`, `ProcessRunner`, `Platform`, `DependencyKey`, `SlotKey` and
`KeyedSlotKey` are the existing types of those names in `src/contracts/`. Task 02 writes each
interface's doc comments and the channel's typing in the shape the tree's other plugin channels
use; a shape the tree's typing cannot take as written is changed there and reported as a
contract change.

### Boundary rules

- No code under `src/` names a user's server, project id, branch, path or skill: those come from
  `builds.backends` (`AGENTS.md` § README, changelog and boundary). Test fixtures and demo samples
  may.
- `builds-teamcity/main/teamcity-cli.ts` is the only file that spawns `teamcity`.
- `builds-local` imports `builds`' `contract.ts` and nothing else of `builds`.
- Every git read goes through `services.git`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 02 → 06 → 07 → 08 → 09

### Wave 1
- [ ] [Git: remote heads and commit subjects](01-git-remote-heads.md)
- [ ] [Builds contract, manifest and model](02-builds-contract-model.md)

### Wave 2
- [ ] [Builds main part](03-builds-main.md) — after 01, 02
- [ ] [TeamCity backend](04-teamcity-backend.md) — after 02
- [ ] [Local backend](05-local-backend.md) — after 01, 02
- [ ] [Builds mode and layout](06-builds-mode.md) — after 02

### Wave 3
- [ ] [Session parts and offer card](07-session-parts.md) — after 03, 06

### Wave 4
- [ ] [README and changelog](08-readme-changelog.md) — after 03, 04, 05, 06, 07

### Wave 5
- [ ] [Doc re-read](09-doc-reread.md) — after 07, 08
- [ ] [Final verification](10-final-verification.md)

## Run log
