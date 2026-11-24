# Builds — design

Built, in `src/plugins/builds/`, `src/plugins/builds-teamcity/` and `src/plugins/builds-local/`: everything below describes the landed code.

**Contents**

- **Intent** — what Builds is for and what a good result looks like.
- **Plugins** — `builds` and the backend plugins, and what each owns.
- **Configuration** — the `builds.backends` setting: backends, games, kinds and sets.
- **The backend seam** — `BuildBackend`, `addBackend`, and what a backend must answer.
- **The TeamCity backend** — the CLI calls, progress, revisions, a job's prerequisites, links and log saves.
- **The local backend** — detached commands, run records, the progress estimate and log saves.
- **Polling and the model** — cadence, the pure fold, and finish detection.
- **Logs and files** — log saves, a kind's files, the Downloads folder and the `builds.downloads` slot.
- **Builds mode** — the side bar, the build list, the detail pane and its job graph, queueing, keys.
- **Sessions** — the row line, the hub section and its Open in Builds button, the activity word, the finish message.
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
            "dev": {
              "label": "Dev",
              "target": "vggt_BashBest_Dev_BuildChain",
              "downloads": [
                {
                  "label": "Android zip",
                  "path": "~/Library/CloudStorage/GoogleDrive-you@example.com/My Drive/bash best/builds/{version}/Dev/android_BashBest_{version}.{number}_android.zip"
                }
              ]
            },
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
  `id`, `label`, `clone` (optional; a path, `~` expanded), `defaultBranch`, `kinds` (id → `label`,
  `target` and an optional `downloads`), `sets` (optional). A set's `kinds` name kinds of the same game, `branches` is a
  git ref pattern under `refs/heads/`, and `agentPrompt` is optional.
- **A kind's `downloads`**: a list of files each build of the kind can have, each a `label` and a `path` template.
  The path is a full path, `~` expanded at parse; `{version}` and `{number}` are filled from each build, and any other
  `{…}` stays as written. A template that names a field the build lacks gives that build no file. An absent list is
  `[]`. A list that is not a list, or an element without a non-empty `label` and `path`, drops the game with its
  problem on the backend's heading (`game <id>: kind <kind>: downloads is not a list`,
  `game <id>: kind <kind>: download <n> needs a label and a path`). No backend reads it: `builds` checks the files
  (§ Logs and files). A Google Drive folder is reached through the Google Drive for desktop mount, which holds only
  My Drive, so a shared folder is added to My Drive as a shortcut first.
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
  - `capabilities`: `cancel` (the backend can cancel a running build), `choosesBranch` (a queue
    takes a branch and a pinned revision; false for a backend that builds a folder as it stands) and
    `saveLog` (the backend can save a job's or a build's whole log to a file)
  - `list(game, limit)` — the game's newest builds across its kinds, newest first, each a
    `BuildRecord`
  - `queue(game, request)` — queues one kind on a branch and revision, and returns the new
    build's id
  - `cancel(game, buildId)` — present only when `capabilities.cancel` is true
  - `saveLog(game, buildId, jobId, path)` — present only when `capabilities.saveLog` is true: writes the
    job's whole log to the full path `path`; a null `jobId` saves the build's own log
  - `dispose()`
- **`BuildRecord`**: `id` (unique within the backend), `gameId`, `kind`, `number`, `version`,
  `branch`, `revision`, `state` (`queued`, `running`, `finished`), `result` (`success`,
  `failure`, `cancelled`, or null until finished), `statusText`, `percent`, `leftSeconds`,
  `stepText`, `queuedAt`, `startedAt`, `finishedAt`, `startEstimate`, `webUrl`, `links` (label and
  url, such as install links), `jobs` and `triggeredBy`. Times are epoch milliseconds. A field the backend
  cannot read is null, or an empty list.
- **`BuildJob`**: its own `id`, `label`, `state`, `result`, `percent`, `leftSeconds`, `stepText`, `webUrl` (the
  job's own page in the backend), `startedAt`, `finishedAt`, and `dependsOn`: the ids of the jobs of the same build
  that this job directly waits on. A job's prerequisites through another prerequisite are not listed.

Three adapters stand behind the seam: TeamCity, local, and the `fixture` backend. `fixture` loads in the self-test and in
a drive run (`runMode` `'drive'`); only the self-test hands over its script.

## The TeamCity backend

All TeamCity access goes through one internal function in `builds-teamcity`, which runs the CLI
with given arguments and parses its JSON. It is the only place the plugin spawns `teamcity`, so
every parse is tested over recorded JSON.

- **List**: `run list --job <target> --limit <n> --json=<fields>` per kind of the game, merged
  newest first with the build queue by id. A running build, and a finished build once, then reads
  its progress and jobs through `teamcity api "/app/rest/builds/id:<id>?fields=…"`: the chain's
  `snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,
  webUrl,startDate,finishDate,buildType(name),running-info(percentageComplete,leftSeconds,
  currentStageText),revisions(revision(version)),snapshot-dependencies(build(id))))`, one GET per build.
  A queued build reads no detail: it takes `startEstimate` and
  `waitReason` from `/app/rest/buildQueue`, since a queued chain is composite and runs no job yet.
  A read that fails backs off by build id: a finished build waits 10 minutes before its detail or
  a log is read again, a running build one list, and a build keeps the record and links already
  read meanwhile.
- **Build jobs**: nothing in a chain marks a job as a Build job, so the optional
  `config.buildJobPattern` (a regex tested against each snapshot dependency's `buildTypeId`) names
  them. With no pattern, every dependency that carries a revision counts as a Build job.
- **Prerequisites**: each snapshot dependency lists its own snapshot dependencies, every one it waits on
  through others too. A job's `dependsOn` keeps the ids of the chain's jobs in that list that no other member of the
  list already reaches: its direct prerequisites, in the chain's job order. The rule holds whether the list is
  transitive or direct.
- **Job fields**: each job's `webUrl`, `startDate` and `finishDate` become its `webUrl`, `startedAt` and
  `finishedAt`. A finished build's cached record carries them; a record cached without them is read again once, and
  its install links stay in the cache file, across restarts, until that read caches the build.
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
- **Log saves**: `teamcity api "/downloadBuildLog.html?buildId=<id>"` prints a job's whole log, or the chain's own
  log for the chain's id, and the backend writes it to the given path. One Android build job's log was 22 MB, so the
  call waits up to 5 minutes. `/app/rest/builds/id:<id>/log` does not answer through the CLI.
- **Capabilities**: `choosesBranch` true, `saveLog` true, `cancel` false: the account cannot cancel runs.
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
  backend entry across a re-apply or a plugin restart share the history. They run no calls at once
  (§ Polling and the model).
- **Progress**: `percent` is elapsed time over the last successful run of the same game and kind,
  capped at 99 until the exit-code file appears, and null with no earlier success. `stepText` is the
  log's last non-empty line, read from the log's end through the files service's `readEnd`.
- **Result**: exit code 0 is `success`, any other is `failure`, a cancel is `cancelled`. A cancel whose kill
  exits non-zero found no process to end, so the run ends as if it had gone: by its exit-code file
  when there is one, else a `failure` with the status text "ended without an exit code". A run
  whose pid is gone with no exit-code file ends the same way.
- **Log saves**: a build's log is its run's `log.txt`, copied through the files service's `copy` to the given path,
  as it stands when the save starts. A local build lists no jobs, so a save names none. A run with no log fails the
  save, naming the log's path.
- **Capabilities**: `cancel` true (the pid is signalled), `choosesBranch` false (the folder is built
  as it stands), `saveLog` true.

## Polling and the model

- **Cadence**: main polls each backend every 10 s while Builds mode shows or a build linked to a
  session runs, and every 2 minutes otherwise. One backend instance never has two polls in flight; a re-apply disposes the old
  instance, which then refuses new calls with "the backend was replaced; try again". The entry's new instance is created only
  once the `list`, `queue` and `cancel` calls of every instance replaced over its data folder settle, a plugin restart's
  included; past `DRAIN_TIMEOUT_MS` (30 s) it logs once that it is still waiting. A `saveLog` is refused after dispose
  but not waited on, since it writes no data folder. Until then queueing answers "<label>: still starting" and the poller skips the entry. A backend
  with no games is not polled. Each poll lists 20 builds per game.
- **The model** (`builds-model.ts`, pure) folds the backends' records, the session links and the
  offers into the published slots, and reports what changed since the last fold: a linked build
  that has a failed job while it still runs (once per build), a linked build whose state moved to
  `finished`, and a set whose last build finished. A set's build that no list holds counts as ended 10 minutes
  after the set run was made, but only once its game has listed. A game's `GameView.listed` says whether the entry's
  current instance has listed it: false at start and after each re-apply until its first good list. It is tested by
  tables over built records.
- **Finish detection** survives a restart: each session link carries a `failingNotified` and a
  `notified` flag in plugin data, each written before its message is sent, so nothing is told
  twice. An ending missed while the app was closed is told on the first poll after start.
- **Clock and timers** are injected into the poller, the model's callers, the downloads and the local backend.

## Logs and files

`builds` main runs every save into the user's Downloads folder (`services.downloadsDir`), in
`main/downloads.ts`, so a save outlives a page reload.

- **A build's files**: after each list, main fills each build's kind `downloads` and checks each path with the
  files service's `stat`. The checks run beside the poll and never hold it: each `stat` gives up after 5 seconds and
  keeps that file's last result, and every path is checked again each poll, except one whose last check has not
  settled, so a deleted file leaves the list. The
  snapshot's `GameView.files` maps a build id to the files its last check found, in the kind's order, each with its
  `entry`: its index in the kind's `downloads`, which `download` takes. A build's end message, and a set's, waits for
  the ended builds' checks in flight, then checks each of those paths again, since its `stat` may have begun before
  the file landed; each check is bounded by the same 5 seconds, so the message waits at most 10 seconds and names a
  file that landed since the last poll.
- **A log save** runs the backend's `saveLog` for a job, or for the build with no job. Its file name is
  `<game label>-<kind label>-<number>-<job label>.log`, each part with every run of characters other than ASCII
  letters and digits turned to one `-`, leading and trailing `-` dropped: `Tiki-Smash-Dev-332-Build-Android-Dev.log`.
  A build with no number has `build-<build id>` for the number, and a save with no job has `build` for the job label.
- **A file download** copies the file through the files service's `copy`, keeping its own name. It needs only the
  listed build, not the backend's instance, so it runs while the entry is still starting. A Drive for desktop file
  not yet on disk is expected to be fetched as it is read for the copy; that is unchecked against Google's docs.
- **Names**: a name the Downloads folder holds already gets ` (2)`, ` (3)` and so on before its extension, and two
  saves at once never take one name.
- **The slot**: `builds.downloads` holds one `BuildDownload` per save, keyed by its id
  (`<backend id>/<build id>/log` for the build's own log, `<backend id>/<build id>/log/<job id>`, or
  `<backend id>/<build id>/file/<entry>`): its label, its state
  (`running`, `saved`, `failed`), the saved file's path, the failure's text and when it started. A save of an id
  that runs is refused (`that download is already running`). An ended save leaves the slot 10 minutes after it ends.
  A save still running when the plugin restarts shows as failed, with "the builds plugin restarted during the save;
  the file may still arrive": the replaced backend may still write it.
- **Reveal**: a saved file opens in Finder (Explorer on Windows) through `services.revealPath`. The self-test and a
  drive run save under the run's home and log the reveal instead.
- The page starts a save over the channel's `saveLog` and `download`, each answering once the save is in the slot,
  or with the refusal's `{ problem }`.

## Builds mode

`<Leader>km` shows Builds mode (vim's `:make`). It draws through the `builds` layout.

- **Side bar**: an All entry first, then each backend's games under the backend's label, each game
  with a dot for its newest build's state. A backend's problem shows under its heading.
- **Main, one game**: the game's name, a button per kind and per set (a set with an `agentPrompt`
  also gets a "with agent" button), and its build list beside a detail pane. The list holds one row per build:
  kind, number and version, branch, short revision and the commit's subject, state with a progress bar and time left
  (or the queue's start estimate), and who queued it — a session's title, or the backend's `triggeredBy`. A set's
  builds show as one group.
- **Main, All**: one feed of every tracked game's builds, newest first, with filter chips (All,
  Running, From sessions), beside the same detail pane.
- **Detail pane**: the selected build, updated live as each poll lands: the status text, the links, Open in the
  backend (`webUrl`), a button per file the build has (§ Logs and files), and its jobs as a graph. A build that lists
  no job, as a local build, shows its step text and a Log button for the build's own log instead of the graph.
- **Job graph**: one box per job, in columns left to right, with an arrow from each prerequisite's box to the box of
  each job that directly waits on it (`dependsOn`), the arrowhead at the dependent's end. A job's column is the length of its longest chain of prerequisites, so a job with none
  sits in column 0. Inside a column, jobs keep their order in `BuildRecord.jobs`. A box shows the job's label, its
  state with a progress bar while it runs, and how long it ran once finished. Boxes keep their size, and the graph
  scrolls sideways when the pane is narrower. Opening a build selects its first running job, else its first failed
  job, else the last job of the last column. Under the graph the selected job shows its step text, a Log button and
  its TeamCity link (`webUrl`).
- **Saves in the pane**: a Log or file button starts a save; the button shows it running, then the saved path or
  the failure, from `builds.downloads`, so a page reload keeps it.
- **Commit subjects** come from the game's `clone` through the app's git service, and the row shows
  the short sha alone when the game names no clone or the commit is not in it.
- **Queueing**: a kind or set button, or `q`, opens the shared list picker: the game's kinds and
  sets, then (when the backend `choosesBranch`) its branches, with the game's `defaultBranch`
  first, or for a set only the branches its pattern matches. The branch's origin head, read from
  the game's clone, is the pinned revision. Enter queues. A user's queue needs no confirm.
- **Keys**: the game list scope (`builds.games`) takes `j`/`k`, `gg`/`G`, `Enter` to show the game
  and `q` to queue. The build list scope (`builds.list`) takes `j`/`k`, `gg`/`G`, `q` to queue, `o` to open the
  build in the backend, `s` to download the build's file (the list picker chooses when it has several), `x` to cancel
  where the backend can, and `Enter` (`builds.focusGraph`) or the pane move `Alt+l` (`Alt+j` while the split stacks) to move into the job graph. The graph's scope (`builds.graph`) takes
  `h`/`l` to step between columns, `j`/`k` within one and `gg`/`G` to its first and last job, `s` to save the selected job's log, `o` to open its
  backend page and `Esc` to go back to the list. A build with no jobs has no job cursor: `s` saves the build's own log
  and `o` opens the build's page.
  The queue picker's scope (`builds.picker`) takes the shared list picker's keys. `<Leader>mq` opens the queue picker
  from anywhere. The offer card's scope (`builds.offer`) takes `Enter` to queue, `x` to dismiss, `k` or
  `Esc` to leave the card, and `i` and `a` to focus the chat box.

## Sessions

- **Row line**: under a session's row, through sessions' `addRowPart`: the session's newest build
  — game, kind, number, a progress bar and time left while it runs; its result after it ends —
  until the session's next build replaces it.
- **Activity**: the row's activity reads `building` while a build linked to it runs. A running activity draws no row
  label; the workflow chip's running tag reads it (`Building`), and chat's working outranks it.
- **Hub section**: a Builds section in the session hub, through chat's `addSidePart`, listing every
  build the session queued, newest first: branch, short revision, per-job progress, links, and an Open in Builds
  button (`builds.showBuild`) that shows Builds mode with that build selected.
- **Finish message**: when a build linked to a session ends, or the last build of a set it queued,
  `builds` sends that session one message through chat's `send`:

  ```
  Build ended: Tiki Smash Dev #331 (0.12.0) — success
  Branch protos/physics-fun @ 2993a9e4
  Links: iOS https://appdistribution.firebase.google.com/… · Android https://…
  Files: Android zip /Users/you/Library/CloudStorage/…/android_BashBest_0.12.0.331_android.zip
  Open: https://peoplefun.teamcity.com/buildConfiguration/…
  ```

  The `Files:` line names each file the build has when the message is sent, by label and full path; a build whose
  file has not reached the disk yet has none. A failure adds `Failed: <job label> (<job id>) — <status text>` per failed job. A set lists one
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
  session; Dismiss (`<Leader>mx`, or `x` on the stop) drops it. The card is the first composer part (order 10), over
  the agent strip, so its stop takes `j` from the last entry first; once the offer goes, `j` reaches the strip again.
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
| `builds.focusGraph`, `builds.openWeb`, `builds.download`, `builds.cancel` | page | none | the build list's `Enter` (and `Alt+l`), `o`, `s`, `x`; `openWeb` opens the cursor's build |
| `builds.graphLeft`, `graphRight`, `graphUp`, `graphDown`, `graphTop`, `graphBottom`, `saveLog`, `openJob`, `leaveGraph` | page | none | the graph's `h`, `l`, `k`, `j`, `gg`, `G`, `s`, `o`, `Esc` |
| `builds.selectJob`, `downloadFile` | page | a job id, a file index | clicks; no key |
| `builds.listDown`, `listUp`, `listTop`, `listBottom` | page | none | the build list's `j`, `k`, `gg`, `G` |
| `builds.gameDown`, `gameUp`, `gameTop`, `gameBottom`, `openGame` | page | none | the game list's `j`, `k`, `gg`, `G`, `Enter` |
| `builds.selectEntry`, `selectBuild`, `queueButton`, `withAgent`, `setFilter`, `openLink` | page | one value or object | clicks; no key; the detail's Open in the backend runs `openLink` with the build's `webUrl` |
| `builds.showBuild` | page | `{ backend, build }` | the hub's Open in Builds button: shows Builds mode with the build selected |
| `builds.queueSessionOffer`, `dismissSessionOffer` | page | a session id | the offer card's buttons |
| `builds.leaveOffer`, `offerFocusBox`, `offerAppendBox` | page | none | the offer card's `k` or `Esc`, `i`, `a` |

The page reaches main's queue, branches, cancel, log saves, file downloads and shown state over the plugin's own
channel. An agent reads `builds.snapshot` and `builds.downloads` with the `read_state` tool.

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
- **A Google Drive API sign-in** — the app has no secret store, and Google Drive for desktop already mounts the
  files under the user's own login.
- **A live log tail** — a saved log answers "what happened"; the step text answers "what is it doing".
