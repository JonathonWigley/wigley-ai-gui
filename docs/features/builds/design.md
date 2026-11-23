# Builds — design

Built, in `src/plugins/builds/`, `src/plugins/builds-teamcity/` and `src/plugins/builds-local/`: everything below describes the landed code.

**Contents**

- **Intent** — what Builds is for and what a good result looks like.
- **Plugins** — `builds` and the backend plugins, and what each owns.
- **Configuration** — the `builds.backends` setting: backends, games, kinds and sets.
- **The backend seam** — `BuildBackend`, `addBackend`, and what a backend must answer.
- **The TeamCity backend** — the CLI calls, progress, revisions and links.
- **The local backend** — detached commands, run records and the progress estimate.
- **Polling and the model** — cadence, the pure fold, and finish detection.
- **Builds mode** — the side bar, the list, the detail, queueing, keys.
- **Sessions** — the row line, the hub section, the activity word, the finish message.
- **Offers** — `builds.offer`, the offer card, and the end of a workflow.
- **Sets and RCs** — a set on one commit, and "with agent".
- **Commands** — every command, its process, argument and risk.
- **Skills** — the app's `builds` skill and the skills that call it.
- **Rejected** — choices weighed and left out.

## Intent

Builds lets the user see the CI builds of the games they track, queue builds and build sets in one
press, see which branch and commit each build was made from, and follow a build's progress in the
app instead of a background agent that waits on it. Agents queue and stop; the app tracks the
build and tells the session when it ends. A machine picks its own backends: TeamCity for work
builds on one machine, local commands for personal builds on another.

## Plugins

- **`builds`** — the core of the feature. It owns the backend registry, the `builds.backends`
  setting, the poller, the model, the published slots, the session links and offers (plugin data),
  Builds mode, the session row line, the hub section, the offer card, the layout contract and its
  `default` layout, and every command below. Its main part depends on `chat` (send, launch) and
  reads `sessions` (rows). Its page part depends on `sessions` (row parts, activities) and `chat`
  (side parts, composer parts).
- **`builds-teamcity`** — a backend kind, `teamcity`, over the `teamcity` CLI. Main part only, plus
  a demo skip.
- **`builds-local`** — a backend kind, `local`, that runs a command per build kind. Main part only,
  plus a demo skip.

A backend plugin registers its kind through `builds`' main export `addBackend`. A machine without
TeamCity lists no `teamcity` backend in its settings, or names `builds-teamcity` in
`plugins.disabled`. A third backend kind is a new plugin and no edit to `builds`.

## Configuration

`builds` declares `backends` (default `[]`, so settings accepts any record shape) and `layout`
(default `'default'`, control `layout`). Each backend entry names its kind, and the backend of
that kind parses the rest. A bad entry shows its reason on that backend's heading in Builds mode
and does not blank the others.

```json
"builds": {
  "backends": [
    {
      "id": "work",
      "kind": "teamcity",
      "label": "TeamCity",
      "config": { "command": "", "buildJobPattern": "_Build(IOS|Android)_" },
      "games": [
        {
          "id": "tiki-smash",
          "label": "Tiki Smash",
          "clone": "~/Documents/dev/peoplefun/new-games-prototypes",
          "defaultBranch": "protos/physics-fun",
          "kinds": {
            "dev":     { "label": "Dev",     "target": "vggt_BashBest_Dev_BuildChain" },
            "qa":      { "label": "QA",      "target": "vggt_BashBest_QA_BuildChain" },
            "release": { "label": "Release", "target": "vggt_BashBest_Release_BuildChain" }
          },
          "sets": [
            {
              "id": "rc",
              "label": "RC set",
              "kinds": ["dev", "release"],
              "branches": "releases/physics-fun/*",
              "agentPrompt": "Make an RC set of Tiki Smash with the create-rcs skill."
            }
          ]
        }
      ]
    }
  ]
}
```

- **Generic fields**, parsed by `builds`: a backend's `id`, `kind`, `label`, `games`; a game's
  `id`, `label`, `clone` (optional; a path, `~` expanded), `defaultBranch`, `kinds` (id → `label`
  and `target`), `sets` (optional). A set's `kinds` name kinds of the same game, `branches` is a
  git ref pattern under `refs/heads/`, and `agentPrompt` is optional.
- **Backend fields**, parsed by the backend: `config`, and each kind's `target`. TeamCity: `config`
  holds an optional `command` (a path, `~` expanded; empty means `teamcity` on PATH) and an optional
  `buildJobPattern` (a regex; see The TeamCity backend), and a `target` is a build configuration id. Local: `config` is `{}`, and a `target` is `{ "command": string, "args":
  string[] }`, run in the game's `clone`, which a local game must name.
- Ids are unique within their list. A duplicate is a problem on that backend's heading.
- An agent adds a game on the user's ask ("track Tiki Smash") by looking it up with the backend's
  own tools and writing the entry into `~/.config/wigley-ai-gui/settings.json`. The app reloads
  the setting live.

## The backend seam

`src/plugins/builds/contract.ts` holds the seam. A backend kind is a factory; an instance answers
for one backend entry.

- **`BackendKind`**: `kind` (the entry's `kind` string), `label`, and
  `create(entry, services)`, which returns a `BuildBackend` or a `{ problem }` naming what is wrong
  with the entry's `config` or a kind's `target`.
- **`BuildBackend`**:
  - `capabilities`: `cancel` (the backend can cancel a running build) and `choosesBranch` (a queue
    takes a branch and a pinned revision; false for a backend that builds a folder as it stands)
  - `list(game, limit)` — the game's newest builds across its kinds, newest first, each a
    `BuildRecord`
  - `queue(game, request)` — queues one kind on a branch and revision, and returns the new
    build's id
  - `cancel(game, buildId)` — present only when `capabilities.cancel` is true
  - `dispose()`
- **`BuildRecord`**: `id` (unique within the backend), `gameId`, `kind`, `number`, `version`,
  `branch`, `revision`, `state` (`queued`, `running`, `finished`), `result` (`success`,
  `failure`, `cancelled`, or null until finished), `statusText`, `percent`, `leftSeconds`,
  `stepText`, `queuedAt`, `startedAt`, `finishedAt`, `startEstimate`, `webUrl`, `links` (label and
  url, such as install links), `jobs` (each with its own id, label, state, result, percent,
  leftSeconds, stepText) and `triggeredBy`. Times are epoch milliseconds. A field the backend
  cannot read is null, or an empty list.

Three adapters stand behind the seam: TeamCity, local, and the self-test's fixture backend.

## The TeamCity backend

All TeamCity access goes through one internal function in `builds-teamcity`, which runs the CLI
with given arguments and parses its JSON. It is the only place the plugin spawns `teamcity`, so
every parse is tested over recorded JSON.

- **List**: `run list --job <target> --limit <n> --json=<fields>` per kind of the game, merged
  newest first with the build queue by id. A running build, and a finished build once, then reads
  its progress and jobs through `teamcity api "/app/rest/builds/id:<id>?fields=…"`: the chain's
  `snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,
  buildType(name),running-info(percentageComplete,leftSeconds,currentStageText),
  revisions(revision(version))))`. A queued build reads no detail: it takes `startEstimate` and
  `waitReason` from `/app/rest/buildQueue`, since a queued chain is composite and runs no job yet.
  A read that fails backs off by build id: a finished build waits 10 minutes before its detail or
  a log is read again, a running build one list, and a build keeps the record and links already
  read meanwhile.
- **Build jobs**: nothing in a chain marks a job as a Build job, so the optional
  `config.buildJobPattern` (a regex tested against each snapshot dependency's `buildTypeId`) names
  them. With no pattern, every dependency that carries a revision counts as a Build job.
- **Revision**: a chain has no VCS root. The revision is the most common
  `revisions.revision[0].version` among the Build jobs, ties going to the earliest: a job of another
  VCS root can come first.
- **Progress**: a chain's `percent` is the mean of its Build jobs' percents, and `leftSeconds` the
  largest of theirs. Each job keeps its own values in `jobs`.
- **Links**: once a chain finishes, the deploy jobs' logs are read once each for Firebase App
  Distribution release URLs (`https://appdistribution.firebase.google.com/…`), each kept as a link
  labelled by its platform. A finished build's record is cached, so a log that is read
  is read once per build; a log that fails is read again after the backoff above.
- **Queue**: `run start <target> --branch <branch> --revision <sha> --no-push --json`. `--no-push`
  is always passed, since without it the CLI pushes the branch. Its answer names the branch as
  `<default>` while TeamCity checks for changes, so the backend keeps the branch and revision it queued with, in its data file beside the finished-build cache, across restarts and re-applies. A pin is kept until its build is cached, or until `LINK_WINDOW_MS` (3 days) after it was queued; a pin stored without a queue time is dropped.
- **Capabilities**: `choosesBranch` true, `cancel` false: the account cannot cancel runs.
- **Dates**: TeamCity writes `20261123T191020+0000`; the parser turns it into epoch milliseconds.

## The local backend

- **Queue** starts the kind's `target` command detached, in the game's `clone`, through a per-OS
  wrapper line that writes a pid file and, at exit, an exit-code file beside the run's log in the
  plugin's data folder. The build outlives an app restart. The run's branch and revision are read
  from the clone through the app's git service as it starts.
- **Run records** — `id` (`<game id>/<kind>/<startedAt>`), `gameId`, `kind`, `branch`, `revision`,
  `startedAt`, `finishedAt`, `exitCode`, `cancelled` and `lastLine` — live in `runs.json` in the
  backend's data folder (`backends/<entry id>/` under the plugin's data folder). They are this
  backend's history. A run's log, pid file and exit-code file sit beside it under
  `runs/<game id>/<kind>/<startedAt>/`. Each call reads `runs.json` afresh, so the two instances of one
  backend entry across a re-apply share the history. They run no calls at once, unless the 30 s drain bound passes
  (§ Polling and the model).
- **Progress**: `percent` is elapsed time over the last successful run of the same game and kind,
  capped at 99 until the exit-code file appears, and null with no earlier success. `stepText` is the
  log's last non-empty line, read from the log's end through the files service's `readEnd`.
- **Result**: exit code 0 is `success`, any other is `failure`, a cancel is `cancelled`. A cancel whose kill
  exits non-zero found no process to end, so the run ends as if it had gone: by its exit-code file
  when there is one, else a `failure` with the status text "ended without an exit code". A run
  whose pid is gone with no exit-code file ends the same way.
- **Capabilities**: `cancel` true (the pid is signalled), `choosesBranch` false (the folder is built
  as it stands).

## Polling and the model

- **Cadence**: main polls each backend every 10 s while Builds mode shows or a build linked to a
  session runs, and every 2 minutes otherwise. One backend instance never has two polls in flight; a re-apply disposes the old
  instance, which then refuses new calls with "the backend was replaced; try again". The entry's new instance is created only
  once the old instance's `list`, `queue` and `cancel` calls settle, or once `DRAIN_TIMEOUT_MS` (30 s) passes, which is
  logged. Until then queueing answers "<label>: still starting" and the poller skips the entry. A backend
  with no games is not polled. Each poll lists 20 builds per game.
- **The model** (`builds-model.ts`, pure) folds the backends' records, the session links and the
  offers into the published slots, and reports what changed since the last fold: a linked build
  that has a failed job while it still runs (once per build), a linked build whose state moved to
  `finished`, and a set whose last build finished. A set's build that no list holds counts as ended 10 minutes
  after the set run was made, but only once its game has listed. It is tested by tables over built records.
- **Finish detection** survives a restart: each session link carries a `failingNotified` and a
  `notified` flag in plugin data, each written before its message is sent, so nothing is told
  twice. An ending missed while the app was closed is told on the first poll after start.
- **Clock and timers** are injected into the poller, the model's callers and the local backend.

## Builds mode

`<Leader>km` shows Builds mode (vim's `:make`). It draws through the `builds` layout.

- **Side bar**: an All entry first, then each backend's games under the backend's label, each game
  with a dot for its newest build's state. A backend's problem shows under its heading.
- **Main, one game**: the game's name, a button per kind and per set (a set with an `agentPrompt`
  also gets a "with agent" button), and its builds, one row each: kind, number and version, branch,
  short revision and the commit's subject, state with a progress bar and time left (or the queue's
  start estimate), and who queued it — a session's title, or the backend's `triggeredBy`. A set's
  builds show as one group.
- **Main, All**: one feed of every tracked game's builds, newest first, with filter chips (All,
  Running, From sessions).
- **Detail**: `Enter` on a row opens it under the row: the build's step text (only when it lists no job, as
  the local backend's builds do), each job with its own progress and step text, the status text, the
  links, and Open in the backend (`webUrl`), which opens the detail's own build wherever the list
  cursor has moved. `o` opens the cursor's build.
- **Commit subjects** come from the game's `clone` through the app's git service, and the row shows
  the short sha alone when the game names no clone or the commit is not in it.
- **Queueing**: a kind or set button, or `q`, opens the shared list picker: the game's kinds and
  sets, then (when the backend `choosesBranch`) its branches, with the game's `defaultBranch`
  first, or for a set only the branches its pattern matches. The branch's origin head, read from
  the game's clone, is the pinned revision. Enter queues. A user's queue needs no confirm.
- **Keys**: the game list scope (`builds.games`) takes `j`/`k`, `gg`/`G`, `Enter` to show the game
  and `q` to queue. The build list scope (`builds.list`) takes `j`/`k`, `gg`/`G`, `Enter` to open the
  detail, `q` to queue, `o` to open the build in the backend and `x` to cancel where the backend can.
  The queue picker's scope (`builds.picker`) takes the shared list picker's keys. `<Leader>mq` opens the queue picker
  from anywhere. The offer card's scope (`builds.offer`) takes `Enter` to queue, `x` to dismiss, `k` or
  `Esc` to leave the card, and `i` and `a` to focus the chat box.

## Sessions

- **Row line**: under a session's row, through sessions' `addRowPart`: the session's newest build
  — game, kind, number, a progress bar and time left while it runs; its result after it ends —
  until the session's next build replaces it.
- **Activity**: the row's activity reads `building` while a build linked to it runs.
- **Hub section**: a Builds section in the session hub, through chat's `addSidePart`, listing every
  build the session queued, newest first: branch, short revision, per-job progress, links.
- **Finish message**: when a build linked to a session ends, or the last build of a set it queued,
  `builds` sends that session one message through chat's `send`:

  ```
  Build ended: Tiki Smash Dev #331 (0.12.0) — success
  Branch protos/physics-fun @ 2993a9e4
  Links: iOS https://appdistribution.firebase.google.com/… · Android https://…
  Open: https://peoplefun.teamcity.com/buildConfiguration/…
  ```

  A failure adds `Failed: <job label> (<job id>) — <status text>` per failed job. A set lists one
  block per build under a first line `Set ended: Tiki Smash RC set — <n> of <m> succeeded`.
- **Failing message**: the first time a linked build that still runs has a failed job, `builds`
  sends the session `Build failing: Tiki Smash Release #332 — <job label> (<job id>) failed:
  <status text>`, so the agent can read the failed log while the other jobs run. A build of a set
  sends its own. The build's finish message follows as usual.
- **Links** between a session and its builds live in plugin data and are dropped 14 days after
  their build ends. A link or set run whose build never ended is dropped 14 days after it was made,
  once its backend lists without it and every game of that backend has listed.

## Offers

- An agent at its wrap-up, when a change reaches players only through a build, runs
  `builds.offer` with the game, kind or set, and branch. The offer is stored for the calling
  session, one per session, a new one replacing the last. A second `queueOffer` while the first
  still queues is refused (`the offer is already queueing`); the page also holds a press per
  session while one is in flight.
- The session shows an offer card above its chat box, through chat's `addComposerPart`: the game,
  the kind or set, the branch, the branch's origin head and its subject, a Queue button and a
  Dismiss button. Queue (`<Leader>mm`, or `Enter` on the card's stop) queues it linked to the
  session; Dismiss (`<Leader>mx`, or `x` on the stop) drops it.
- An offer outlives a page reload and an app restart, and goes when queued or dismissed.

## Sets and RCs

- A set queues each of its kinds on one branch and one revision, read once before the first queue,
  so every build of the set holds the same code. The model groups a set's builds by a set-run id
  kept in plugin data.
- A set's "with agent" button launches a session through chat's `launch` in the game's `clone`,
  with the set's `agentPrompt` as its first message. The agent cuts branches and carries fixes; its
  own `builds.queue` call then links the set to its session.

## Commands

| Command | Runs in | Argument | Notes |
|---|---|---|---|
| `builds.showMode` | page | none | `<Leader>km` |
| `builds.queue` | main | `{ backend, game, kind, branch }` | `risky: true`; `kind` may name a set; links to `callerSessionId` when set |
| `builds.offer` | main | `{ backend, game, kind, branch }` | refused with no calling session |
| `builds.queueOffer` | page | none | the focused session's offer; `<Leader>mm`, `Enter` in `builds.offer` |
| `builds.dismissOffer` | page | none | `<Leader>mx`, `x` in `builds.offer` |
| `builds.pickQueue` | page | none | the queue picker; `<Leader>mq`, `q` in the mode |
| `builds.launchSetAgent` | main | `{ backend, game, set }` | the set's "with agent" button |
| `builds.openDetail`, `builds.openWeb`, `builds.cancel` | page | none | the build list's `Enter`, `o`, `x`; `openWeb` opens the cursor's build |
| `builds.listDown`, `listUp`, `listTop`, `listBottom` | page | none | the build list's `j`, `k`, `gg`, `G` |
| `builds.gameDown`, `gameUp`, `gameTop`, `gameBottom`, `openGame` | page | none | the game list's `j`, `k`, `gg`, `G`, `Enter` |
| `builds.selectEntry`, `selectBuild`, `queueButton`, `withAgent`, `setFilter`, `openLink` | page | one value or object | clicks; no key; the detail's Open in the backend runs `openLink` with the build's `webUrl` |
| `builds.queueSessionOffer`, `dismissSessionOffer` | page | a session id | the offer card's buttons |
| `builds.leaveOffer`, `offerFocusBox`, `offerAppendBox` | page | none | the offer card's `k` or `Esc`, `i`, `a` |

The page reaches main's queue, branches, cancel and shown state over the plugin's own channel. An
agent reads `builds.snapshot` with the `read_state` tool.

## Skills

- **`agent-plugin/skills/builds/`** — the app's skill: queueing (`builds.queue` through
  `run_command`), offering at a wrap-up (`builds.offer`), adding a tracked game, reading state, and
  queueing then stopping, since the app tells the session when the build ends.
- The user's own TeamCity skills keep the team's specifics (projects, chains, RC steps) and queue
  through the app when it runs, falling back to the CLI and their watch scripts when it does not.
- The wrap-up's `device build` chip becomes a `builds.offer` call when the app runs.

## Rejected

- **REST with a stored token** — the app has no secret store, and the CLI already holds the login.
- **Discovering every TeamCity build chain** — it puts one team's naming convention into app code;
  an agent writes explicit entries instead.
- **Clickable wrap-up chips** — needs a new bridge out of the sandboxed visual frame, where the
  agent's `builds.offer` call gives one press already.
- **The app inferring the offer from a finished workflow** — the agent knows where the work landed;
  a pool clone's branch does not.
- **A TeamCity cancel button** — the account cannot cancel runs.
