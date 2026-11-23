# 03 — Builds main part

Status: done
Type: Task
Rung: deep · crosses lifecycle (live settings, kinds that register late), async polls that must not overlap, and plugin data written before each message
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/builds/main/start.ts` (task 02's skeleton)
- create `wigley-ai-gui/src/plugins/builds/main/backend-registry.ts`
- create `wigley-ai-gui/src/plugins/builds/main/backend-config.ts`
- create `wigley-ai-gui/src/plugins/builds/main/poller.ts`
- create `wigley-ai-gui/src/plugins/builds/main/link-store.ts`
- create `wigley-ai-gui/src/plugins/builds/main/build-messages.ts`
- create `wigley-ai-gui/src/plugins/builds/main/queueing.ts`
- create `wigley-ai-gui/src/plugins/builds/main/fixture-backend.ts`
- create `wigley-ai-gui/src/plugins/builds/main/selftest-script.ts`
- test `wigley-ai-gui/src/plugins/builds/main/backend-registry.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/backend-config.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/poller.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/link-store.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/build-messages.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/queueing.test.ts`
- test `wigley-ai-gui/src/plugins/builds/main/start.test.ts`

Consumes:
- `remoteHeads(root, pattern)`, `commitSubject(root, sha)` and `GitRemoteHead` ← 01
- `buildsManifest`, every contract name (`BuildBackend`, `BackendKind`, `BackendEntry`,
  `GameEntry`, `BackendServices`, `BuildsMainExports`, `buildsSnapshotSlot`, `buildsSessionsSlot`,
  `BuildsChannel`, `BuildOffer`, `BuildRef`, `BUILDS_PER_GAME`), `foldBuilds`, `kindLabel`, `shortRevision`, `SessionLink`,
  `SetRun`, `BackendState`, `GameState`, `BuildsEvent`, and the builders and
  `createFixtureBackend` / `fixtureBackendKind` of `contract.test-support.ts` ← 02
- from the tree: `ChatMainExports.send(sessionId, message)`, `launch(request)`,
  `defaultProfile(sessionId)` and `restored()` through `chatMainKey` (`src/plugins/chat/contract.ts`);
  `sessionsRowsSlot` (`src/plugins/sessions/contract.ts`); `scopedFiles(files, root, paths)`
  (`src/shared/scoped-files.ts`); `readIfPresent` (`src/contracts/files.ts`); `errorText`
  (`src/shared/error-text.ts`); `startMainPart`, `fakeDependency` and `deferred`
  (`src/shared/plugin-part-harness.test-support.ts`); `sessionRow`
  (`src/plugins/sessions/contract.test-support.ts`)

Produces:
- `export const buildsMainPart: MainPart<typeof buildsManifest>` in `main/start.ts` (02 made the
  skeleton and registered it; this task fills it), with
  `exports(consumer)` returning `BuildsMainExports`: `addBackend(kind)` is
  `consumer.track(registry.add(kind))`. Tasks 04 and 05 call `addBackend` from their own main
  parts. Task 07 adds its `registerSessionDemoStep` call and the layout contract registration to
  this file after this task lands.
- `export const FAST_POLL_MS = 10_000;` and `export const SLOW_POLL_MS = 120_000;` in
  `main/poller.ts`
- `export const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;` and
  `export const LINKS_FILE = 'session-links.json';` in `main/link-store.ts`
- the log lines in Decisions › Log lines, which `main/selftest-script.ts` expects and task 10
  reads in its drive runs

Decisions:
- **Pattern.** `src/plugins/system-stats/main/start.ts` and its `poller.ts` for the shown flag
  over the channel, a poller with injected `timers` and `clock`, and the stop flag; `src/plugins/scheduling/main/history-store.ts` for a JSON file in plugin data written
  whole and in order; `src/plugins/workflow/main/start.ts` (`exports: (consumer) => ({ addWorkflow:
  (workflow) => consumer.track(addWorkflow(workflow)) })`) for a registry behind an export;
  `src/plugins/chat/main/start.ts` (`sendTo`) for a main command that reads `callerSessionId` and
  throws its refusal.
- **Start.** `start` registers no layout contract: task 07 adds that call once task 06's
  `layouts/layout.d.ts` exists (lead's ruling). `start` publishes both slots, sets `buildsSnapshotSlot` to
  `{ backends: [], polledAt: null }`, and starts the link store's `load()`. `ready()` awaits the
  load and `chat.restored()` together. Then it sets `isReady` and applies the setting for the
  first time, so every backend plugin that started with the app has called `addBackend` first
  (AGENTS.md § Architecture **A plugin**: "put work that needs its siblings started there").
  - While `isReady` is false, a registry change or an `api.onSettingsChanged` call does nothing.
    After it, each one starts an apply.
  - Chat reopens the saved rows asynchronously, and `sessionsRowsSlot` holds a reopened row only
    after `restored()` settles. So the first fold and the first event handling come after that,
    and a missing row is final only then.
- **Setting parse** (`backend-config.ts`, design.md § Configuration). Export
  `parseBackends(value: readonly unknown[], expandTilde: (text: string) => string): ParsedBackend[]`
  with `interface ParsedBackend { id: string; kind: string; label: string; entry: BackendEntry |
  null; problems: string[] }`. `start` passes `(text) => services.paths.expandTilde(text,
  services.homeDir)`. `n` is the element's 1-based place in its list. A backend-level problem
  leaves `entry` null, so the backend shows its problem and is not polled. A game-level problem
  drops only that game and adds its text to the backend's `problems`. Each element (a backend, a
  game, a kind or a set) gives only its first failing check, in table order. `problems` holds the
  texts in parse order: the backend's own problem first, then each game's in game order. The
  texts, verbatim:

  | check | problem text | result |
  |---|---|---|
  | element not an object | `entry <n> is not an object` | id `#<n>`, entry null |
  | `id` not a non-empty string | `entry <n> has no id` | id `#<n>`, entry null |
  | `id` not matching `/^[A-Za-z0-9._-]+$/`, or equal to `.` or `..` | `<id> is not a valid id` | id `#<n>`, entry null |
  | `id` equal to an earlier backend's id, ignoring case | `duplicate backend id "<id>"` | id `<id>#<n>`, entry null |
  | `kind` not a non-empty string | `<id> has no kind` | entry null |
  | `label` not a non-empty string | `<id> has no label` | label = id, entry null |
  | `games` not an array | `<id>: games is not a list` | entry null |
  | game not an object, or no string `id` | `game <n> has no id` | game dropped |
  | game `id` used by an earlier game | `duplicate game id "<id>"` | game dropped |
  | game `label` not a non-empty string | `game <id> has no label` | game dropped |
  | `clone` present, not null and not a string | `game <id>: clone is not a path` | game dropped |
  | `defaultBranch` not a non-empty string | `game <id> has no defaultBranch` | game dropped |
  | `kinds` not an object, or empty | `game <id> has no kinds` | game dropped |
  | a kind not an object, its `label` not a string, or no `target` key | `game <id>: kind <k> needs a label and a target` | game dropped |
  | `sets` present and not an array | `game <id>: sets is not a list` | game dropped |
  | set not an object, or no string `id` | `game <id>: set <n> has no id` | game dropped |
  | set `id` used by an earlier set | `game <id>: duplicate set id "<s>"` | game dropped |
  | set `id` equal to a kind id | `game <id>: set "<s>" has a kind's id` | game dropped |
  | set `label` not a non-empty string | `game <id>: set <s> has no label` | game dropped |
  | set `kinds` not a non-empty array of strings | `game <id>: set <s> has no kinds` | game dropped |
  | a set kind not a kind of the game | `game <id>: set <s> names no kind "<k>"` | game dropped |
  | set `branches` not a non-empty string | `game <id>: set <s> has no branches` | game dropped |
  | `agentPrompt` present and neither a string nor null | `game <id>: set <s>: agentPrompt is not text` | game dropped |

  A `clone` string is passed through `expandTilde`; a missing or null `clone` is null. A missing
  `sets` is `[]`, and a missing or null `agentPrompt` is null. `config` and each kind's `target`
  pass through unread (the backend parses them, design.md § Configuration).
- **Registry** (`backend-registry.ts`). Export `createBackendRegistry(): BackendRegistry` with
  `add(kind: BackendKind): Disposable`, `get(kind: string): BackendKind | null` and
  `onChanged(listener: () => void): Disposable`. `add` throws `backend kind "<kind>" is already
  added` for a kind string another live registration holds. Each add and each first `dispose` of
  an add calls every listener; a second `dispose` does nothing.
- **Instances.** Each apply (at `ready()`, and after it on `api.onSettingsChanged` and on each
  registry change) parses the setting. When `JSON.stringify` of the parsed backends and the
  registry's kind set (its kind strings, sorted) both equal those of the last apply, the apply
  does nothing: a `layout`-only settings change, for example, creates no instance. Else the apply
  disposes every live `BuildBackend` and calls `create` (async, lead's ruling) for each parsed
  `entry`. Each entry publishes as its own `create` settles, so a slow `create` holds back only
  its own backend:
  - no kind registered: problem `no backend kind "<kind>": its plugin is off or missing`
  - `create` resolves `{ problem }`: that text is a problem
  - `create` rejects: problem `create failed: <errorText>`
  - else the instance, with `capabilities` from it.

  Each apply takes a new generation number. A `create` that settles under an older generation
  (a later apply started, or the part stopped) gives an instance that is disposed at once and
  publishes nothing. The backend's last good builds stay in the snapshot through a `create`
  problem. Each backend bounds its own `create`, `list` and `queue` with process timeouts (task
  04 § Timeouts, task 05's `timeoutMs`), so `builds` sets no timeout of its own.

  `BackendServices` per entry: `processes`, `git`, `files`, `paths`, `clock`, `timers`, `homeDir`
  and `platform` from `api.services`; `dataFolder` is `services.paths.join(api.dataFolder,
  'backends', entry.id)`; `dataFiles` is `scopedFiles(services.files, dataFolder,
  services.paths)`; `log(message)` calls `services.log(`${entry.id}: ${message}`)`. The last
  records of each backend id and game id stay in memory across applies, so the mode does not go
  blank; a game no longer in the entry drops its records. A poll that an apply overtook (its
  instance disposed) is dropped by a generation count, as system-stats' poller drops a hidden
  sample.
- **Problems on the heading.** `BackendState.problem` is the parsed `problems`, then the instance
  problem, then each game's last list failure as `<game label>: <errorText>`, joined with `; `;
  null when there are none (design.md § Configuration: "A bad entry shows its reason on that
  backend's heading in Builds mode and does not blank the others"). A good list clears that game's
  failure.
- **Poller** (`poller.ts`, design.md § Polling and the model). Export
  `createBuildsPoller(deps: { timers: Timers; poll(backendId: string): Promise<void>;
  isFast(backendId: string): boolean; log(message: string): void }): BuildsPoller` with
  `setBackends(ids: readonly string[], replaced: readonly string[]): void`, `pollNow(id: string):
  void`, `reschedule(): void` and `dispose(): void`:
  - `setBackends` takes the ids of backends with an instance and at least one game ("A backend with
    no games is not polled"), and the ids whose instance was just replaced. `start` calls it each
    time an entry's `create` settles, with that entry's id in `replaced`. An id newly listed, or
    listed and in `replaced`, polls at once; when its poll runs, it takes the `pollNow` "one more"
    mark instead. A listed id that is not new and not in `replaced` keeps its timer. An id no
    longer listed clears its timer, and its running poll arms nothing when it settles.
  - `pollNow` on a listed id that waits on a timer clears that timer and polls at once, so the id
    never holds two timers. `pollNow` on an id that is not listed does nothing.
  - When a poll settles, a rejection included (logged as `poll handling failed: <errorText>`), the
    poller arms that id `FAST_POLL_MS` when `isFast(id)` and `SLOW_POLL_MS` otherwise.
  - "One backend never has two polls in flight": `pollNow` on an id whose poll runs marks one more
    poll, which runs once the running one settles; any number of such calls give one.
  - `reschedule`: an id that waits on a `SLOW_POLL_MS` timer and is now fast polls at once. An id
    that waits on a fast timer keeps it, and its next arm reads `isFast` again.
  - `isFast(id)` in `start` is `shown || fold.activeBackends.includes(id)`; `shown` is the last
    value of the channel's `setShown`. `start` calls `reschedule` after each `setShown` and after
    each fold.
- **One poll** of a backend: for each game in entry order, `backend.list(game, BUILDS_PER_GAME)`.
  A good list replaces that game's records. Then, for each record with a non-null `revision` in a
  game with a non-null `clone`, read the subject through `services.git.commitSubject(clone,
  revision)` unless a cache holds it. Cache each non-null subject by clone and sha for the part's
  life (a commit's subject never changes). Cache a null by clone and sha with its time, for
  `SLOW_POLL_MS`: a poll asks again only when the null is `SLOW_POLL_MS` or more old. A poll asks
  only for the records whose subject the cache does not hold. A `commitSubject` rejection is
  logged once per distinct text as `commit subject failed: <errorText>` and leaves the subject
  out. After the games, `polledAt` is `clock.now()`, and `start` folds. A poll whose generation
  is older than the current one (an apply replaced its instance, or the part stopped) changes no
  record and does not fold.
- **Fold and publish.** Each fold calls `foldBuilds` with the backends' states in settings order,
  the store's links, set runs and offers, `polledAt` and `clock.now()`. `start` folds after each
  poll, after each apply and after each store change. It sets `buildsSnapshotSlot` and writes `buildsSessionsSlot`: `set` for each key of `fold.sessions`,
  `delete` for each key the slot holds that the fold does not. Then it prunes (below) and handles
  the events.
- **Events, flags and messages** (design.md § Polling and the model › Finish detection, § Sessions).
  For each event, in fold order:
  1. Set the flags in the store's memory at once, before any `await`, so a fold that runs during
     the write cannot report the event again: `failing` sets the link's `failingNotified`;
     `ended` sets the link's `notified` and `endedAt` (`build.finishedAt ?? clock.now()`);
     `setEnded` sets the set run's `notified` and `endedAt` (the largest `finishedAt` of its
     builds, else `clock.now()`), and the same on every link whose `setRunId` is the set run's id.
  2. Await the store's write. When it fails, log the line below and send nothing: the flags stay
     set in memory, so nothing is told twice in this run.
  3. When `isStopped` is true, send nothing and log nothing. Else send through
     `chat.send(sessionId, { text, images: [] })` when `sessionsRowsSlot` holds a row for the
     session id; else log and send nothing. A `setEnded` with `sessionId` null sends nothing and
     logs nothing.
- **Message texts** (`build-messages.ts`, design.md § Sessions, verbatim). Export
  `failingMessage(game: GameEntry, build: BuildRecord, failedJobs: BuildJob[]): string`,
  `endedMessage(game: GameEntry, build: BuildRecord): string` and `setEndedMessage(game: GameEntry,
  setRun: SetRun, builds: BuildRecord[]): string`. With `<kind>` = task 02's
  `kindLabel(game, build.kind)`:
  - The head: `<game label> <kind>`, then ` #<number>` when `number` is not null, then
    ` (<version>)` when `version` is not null.
  - `Build ended: <head> — <result>`, `<result>` being `success`, `failure` or `cancelled`
    (`failure` when `result` is null). Then `Branch <branch> @ <shortRevision(revision)>`,
    or `Branch <branch>` when `revision` is null. Then, for a `failure`, one line per job with
    `result` `'failure'`: `Failed: <job label> (<job id>) — <text>`, `<text>` being the job's
    `stepText`, else the build's `statusText`, the ` — <text>` left out when both are null; a
    `failure` with no failed job gives one line `Failed: <kind> (<build id>) — <statusText>`, the
    ` — <statusText>` left out when it is null. Then `Links: <label> <url>` for each link joined
    with ` · `, only when `links` is not empty. Then `Open: <webUrl>`, only when `webUrl` is not
    null. Lines join with `\n`.
  - `Build failing: <head without the version> — <job label> (<job id>) failed: <text>`, one
    clause per failed job joined with `; `; `<text>` as above, and ` failed` with no `: <text>`
    when the job has none.
  - `Set ended: <game label> <set label> — <n> of <m> succeeded`, `<n>` the builds with `result`
    `'success'` and `<m>` the refs in `setRun.builds`; then, for each ref in set order, an empty
    line and that build's `Build ended:` block, or `Build <build id>: no longer listed` for a ref
    with no record in `builds` (task 02's model counts such a ref as ended after
    `UNLISTED_ACTIVE_MS`).
- **Log lines** (each through `services.log`, so it shows as `[builds] …`):
  - `backends applied: none`, or `backends applied: ` then per backend `<id> <n> games`, with
    ` (problem: <problem>)` when it has one, joined with `; `
  - `first poll <backend id>: <n> builds` once per instance, at its first settled poll
  - `poll <backend id> failed: <game label>: <errorText>` once per distinct text, until a good list
  - `commit subject failed: <errorText>` once per distinct text
  - `failing <backend id>/<build id> for <session id>: sent`, `ended …: sent`,
    `set ended <set run id> for <session id>: sent`; the same lines end `: no session row, not
    sent`, `: not written, not sent` or `: send failed: <errorText>` in place of `: sent`
  - `queued <backend id>/<build id> on <branch>`, once per queued build
  - `launched set agent <set id> of <game id>: <session id>`
- **Links, set runs and offers** (`link-store.ts`). Export `createLinkStore(files: Files,
  log: (line: string) => void): LinkStore` over `api.data`, holding `LINKS_FILE` as
  `{ links: SessionLink[]; setRuns: SetRun[]; offers: Record<string, BuildOffer> }`.
  - `load()`: a missing file is empty. Text that is not JSON rejects; `start` logs
    `session-links.json unreadable: <errorText>` and, as `history-store.ts` does, writes nothing for
    the rest of the run, so the file stays for the user to read. JSON whose top level is not an
    object (an array, a string, null) rejects the same way. A missing `links`, `setRuns` or
    `offers` member reads as empty. An element of the wrong shape (a link, a set run, or an offer
    value) is dropped, and the count over all three is logged once as
    `session-links.json: dropped <n> bad entries`.
  - Reads: `links()`, `setRuns()`, `offers()`. Changes: `addLinks(links)`, `addSetRun(run)`,
    `setOffer(sessionId, offer | null)`, `updateLinks(match, change)`, `updateSetRun(id, change)`,
    each applied in memory at once. `written(): Promise<boolean>` resolves after every write so far
    settled: true when the last one landed, false when it rejected (logged
    `session-links.json not written: <errorText>`) or the store is not writable. Each change
    writes the whole file, `JSON.stringify(value, null, 2)`, after every earlier write.
  - `prune(now, isListed: (ref: BuildRef) => boolean): boolean` drops each link and set run older
    than `PRUNE_AFTER_MS` (design.md § Sessions: "dropped 14 days after their build ends"): a
    link when `endedAt` is not null and `now - endedAt > PRUNE_AFTER_MS`, or when `endedAt` is null,
    `isListed` is false and `now - linkedAt > PRUNE_AFTER_MS`; a set run by the same rule over its
    `endedAt` and `createdAt`, `isListed` true when any of its refs is listed. It drops an offer
    when `now - offer.createdAt > PRUNE_AFTER_MS`, so an offer that no one answers does not stay
    for ever. It writes and returns true when it dropped something. The second rule drops a link whose build fell out of
    the backend's newest 20 before it was seen to end. `start` prunes after each fold.
- **Queueing** (`queueing.ts`, design.md § Builds mode › Queueing, § Sets and RCs, § Offers,
  § Commands). Export `createQueueing(deps): Queueing` over the live instances, the store, `git`,
  `clock`, `randomHex`, chat's `launch` and `defaultProfile`, and the poller's `pollNow`, with
  `queue`, `offer`, `queueOffer`, `dismissOffer`, `branches`, `cancel` and `launchSetAgent`. Each
  returns `{ ok: true }` or `{ problem }` (`branches` returns the heads or `{ problem }`), never
  rejects, and changes nothing on a problem. Problem texts, verbatim:

  | case | problem |
  |---|---|
  | no parsed backend with the id | `no backend "<id>"` |
  | the backend has no instance | `<backend label>: <BackendState.problem>` |
  | no game with the id in the entry | `no game "<id>" in <backend label>` |
  | the id is neither a kind nor a set of the game | `no kind or set "<id>" in <game label>` |
  | `branches` or `launchSetAgent` on a game with no clone | `<game label> names no clone` |
  | `remoteHeads` returned null | `could not read the branches on origin of <clone>` |
  | the branch is not on origin | `no branch "<branch>" on origin` |
  | a set's branch is not among `remoteHeads(clone, set.branches)` | `"<branch>" does not match the set's branches <pattern>` |
  | `cancel` on a backend whose `capabilities.cancel` is false | `<backend label> cannot cancel builds` |
  | `launchSetAgent` on a set with a null `agentPrompt` | `set "<id>" has no agentPrompt` |
  | `defaultProfile(null)` is null | `no profile to launch with` |
  | `queueOffer` with no offer stored | `no offer for this session` |
  | `backend.queue`, `cancel` or `launch` rejects | its `errorText` |
  | a set's later queue rejects | `queued <k> of <m>: <errorText>` |

  - `queue({ backend, game, kind, branch, sessionId, revision })`, with `revision?: string`: the
    id names a kind first, then a set. An absent `revision` (the page's and the command's queue)
    means `queue` reads it. The revision is read once, before the first queue: when
    `capabilities.choosesBranch` is true and the game names a clone, it is the sha of the head
    named exactly `branch` in `remoteHeads(clone, branch)`; for a set, the branch must be in
    `remoteHeads(clone, set.branches)`, and that list gives the sha. With no clone, or when
    `choosesBranch` is false, the revision is null and nothing is read. A `revision` passed in (an
    offer's) is used as it is and nothing is read. A kind queues once; a set queues each of its
    `kinds` in order, on the one branch and revision.
  - `queue` stores nothing while a `backend.queue` awaits. After the last `backend.queue` settles
    (the one that rejected, when a later queue of a set fails), and only when at least one build
    was queued, it adds in one synchronous block: a `SessionLink` for each queued build when
    `sessionId` is not null (`linkedAt` now, both flags false, `endedAt` null, `setRunId` the set
    run's id or null), and for a set one `SetRun` (`id` from `randomHex()`, `notified` false)
    whose `builds` holds the queued refs. When the first queue rejects, `queue` stores no set run
    and no link. Then `pollNow(backend)`, so the new build shows (design.md: "A user's queue needs
    no confirm").
  - `offer({ backend, game, kind, branch }, sessionId)`: checks as `queue` does, reads the revision
    the same way, reads the subject with `commitSubject(clone, revision)` when both are known, and
    stores the `BuildOffer` (`createdAt` now) for the session, replacing its last one (design.md
    § Offers: "one per session, a new one replacing the last").
  - `queueOffer(sessionId)`: queues the stored offer's backend, game, kind and branch with its
    `sessionId`, and with its `revision` when that is not null (a null revision is left absent); on `{ ok: true }` it removes the offer. The card showed that head,
    so the queue pins it.
  - `dismissOffer(sessionId)`: removes the session's offer; no offer is no problem.
  - `branches({ backend, game, set })`: with `set` null, `remoteHeads(clone, '*')`; else
    `remoteHeads(clone, set.branches)`. The list puts the head named `game.defaultBranch` first,
    then the rest by `name` with `localeCompare`.
  - `cancel({ backend, game, build })`: `backend.cancel(game, build)`, then `pollNow(backend)`.
  - `launchSetAgent({ backend, game, set })`: `chat.launch({ projectDir: clone, profile:
    chat.defaultProfile(null), message: { text: agentPrompt, images: [] } })` (design.md § Sets
    and RCs). The agent's own `builds.queue` links the set to its session later.
- **Commands** (design.md § Commands). `queue` calls `queueing.queue` with `callerSessionId ??
  null`; `offer` throws `builds.offer: no calling session` when `callerSessionId` is undefined,
  else calls `queueing.offer`; `launchSetAgent` calls `queueing.launchSetAgent`. Each throws
  `new Error(`builds.<short id>: ${problem}`)` on a `{ problem }`, so an agent's `run_command`
  reports it. `queue` is `risky` in the manifest; the user's Allow is the gate.
- **Channel handlers.** `setShown`, `branches`, `queue` (with the page's `sessionId`),
  `queueOffer`, `dismissOffer`, `cancel` and `launchSetAgent`, each calling its `queueing`
  function and returning its result.
- **Self-test** (`fixture-backend.ts`, `selftest-script.ts`, design.md § The backend seam: "the
  self-test's fixture backend"). When `services.selfTest` is not null, `start` adds
  `selfTestBackendKind(clock)` from `fixture-backend.ts` (named apart from the test-support
  `fixtureBackendKind`) to the registry: kind `fixture`, label
  `Fixture`, capabilities `{ cancel: true, choosesBranch: false }`. For each game its `list`
  returns build `<game id>-1` (finished, success) and build `<game id>-2`, whose state moves one
  step per `list` call of that instance: call 1 running with job `ios` running; call 2 running
  with job `ios` `'failure'`, `stepText` `Archive failed`; from call 3 finished, `'failure'`.
  `queue` returns `<game id>-<n>` from 3 up and adds a queued record. The script (pattern:
  `src/plugins/system-stats/main/selftest-script.ts`):
  - `open()` adds a link `{ sessionId: 'selftest-session', backendId: 'fixture', buildId: 'game-a-2',
    setRunId: null, linkedAt: now, failingNotified: false, notified: false, endedAt: null }` to
    the store, returns `shownLine` `[builds] self-test link added`, which `open` logs, and a
    `result` that resolves with that link once its `ended` event is handled.
  - Group `setting`, why `A backends setting applies live; a duplicate game shows as the backend's
    problem and leaves the other game.`: one step with `writeFile` `{ path:
    '.config/wigley-ai-gui/settings.json', text }` and `keys: []`, where `text` is
    `JSON.stringify` of `{ builds: { backends: [{ id: 'fixture', kind: 'fixture', label: 'Fixture',
    config: {}, games: [gameA, gameA] }] } }` and `gameA` is `{ id: 'game-a', label: 'Game A',
    defaultBranch: 'main', kinds: { dev: { label: 'Dev', target: 'dev' } } }`. `expect`
    `[builds] backends applied: fixture 1 games (problem: duplicate game id "game-a")`,
    `alsoExpect` `/^\[builds\] first poll fixture: 2 builds$/`.
  - Group `endings`, why `A linked build's first failed job and its end each reach the session
    once, flags first; a session with no row gets no message.`: two steps with `keys: []` and
    `timeoutMs: 15000` (one fast poll is 10 s): `expect` `[builds] failing fixture/game-a-2 for
    selftest-session: no session row, not sent`, then `[builds] ended fixture/game-a-2 for
    selftest-session: no session row, not sent`.
  - `problems(result)`: `[]` when the link has `failingNotified` and `notified` true, else
    `['the fixture link was not marked told']`. `pageBinds: []`, `settings: {}`,
    `scrollsItself: []`.
  - The self-test covers the main part only. It has no page group.
- **Demo steps.** This task writes no demo file. Step `builds.mode` is page-only (task 06's
  `page/demo-sample.ts`), and step `builds.session`'s main half is task 07's
  `main/session-demo-step.ts`. The plugin needs no `demoSkip`.
- **Dispose.** Set `isStopped` first, and bump the apply and poll generations, so an apply or a
  poll that still awaits `create` or `list` publishes nothing when it settles. A `create` that
  resolves after the stop gives an instance that is disposed at once. Then dispose the poller,
  every instance and the registry's listener through `callEach` (AGENTS.md § Architecture **A
  registration**). A stop awaits nothing else: the store's writes are each whole-file and in
  order. An event whose write settles after the stop sends nothing (Events step 3).
- **Boundary.** No code under `src/plugins/builds/main/` names a server, project id, branch or
  path of the user's (plan.md § Boundary rules); test fixtures and the demo samples may.

GIVEN Builds mode is hidden and no linked build runs WHEN a poll settles THEN the next poll of that
backend is armed at `SLOW_POLL_MS`
GIVEN a linked build runs WHEN its backend's poll settles THEN the next poll is armed at
`FAST_POLL_MS`
GIVEN a poll is in flight WHEN `pollNow` runs three times THEN exactly one more poll runs, after it
GIVEN a linked build has ended and its `notified` is false at start WHEN the first poll after
`ready()` folds THEN the session gets one `Build ended:` message, and a second fold sends nothing
GIVEN chat reopens the session's row only when `restored()` settles WHEN `ready()` runs THEN the
first fold waits for it, and the session gets the `Build ended:` message
GIVEN the first queue of a set rejects WHEN `queue` returns THEN the store holds no set run and no
link
GIVEN the part stops while a `create` awaits WHEN that `create` resolves THEN its instance is
disposed at once and nothing is sent
GIVEN the store write fails WHEN an `ended` event is handled THEN nothing is sent
GIVEN a backend entry naming kind `teamcity` and no such kind added WHEN a kind `teamcity` is added
later THEN the backend is created and polled at once
GIVEN `builds.offer` runs with no calling session THEN it throws `builds.offer: no calling session`

Tests:
- `backend-config.test.ts`, `describe('parseBackends')`: `it.each` "$case → $problem", one row per
  row of the parse table above, each built from one valid backend with one valid game and one
  valid set and one field changed. Each row asserts the parsed backend's `problems` equals
  `[problem]`, and its `entry` is null for a backend-level row; for a game-level row the entry
  holds the other valid game `g2` only. The id rows use these literal inputs:

  | case | input | problems |
  |---|---|---|
  | id with a slash | backend `id` `a/b` | `['a/b is not a valid id']` |
  | id of dots | backend `id` `..` | `['.. is not a valid id']` |
  | id with a space | backend `id` `my ci` | `['my ci is not a valid id']` |
  | duplicate id, other case | two backends with `id` `Work` and `work` | the second gives `['duplicate backend id "work"']`, id `work#2` |

  Plus `it.each` "first check and order: $case":

  | case | input | problems |
  |---|---|---|
  | one game fails two checks | game `g1` with `label` `''` and `defaultBranch` `''` | `['game g1 has no label']` |
  | two games fail | game `g1` with no `kinds`, then game `g3` with `defaultBranch` `''` | `['game g1 has no kinds', 'game g3 has no defaultBranch']` |
  | backend fails two checks | backend `b1` with `kind` `''` and `label` `''` | `['b1 has no kind']`, entry null |

  Plus `it('expands ~ in clone and fills the optional
  fields')`: `clone: '~/dev/game'` with `expandTilde` `(text) => text.replace('~', '/home/u')`
  gives `'/home/u/dev/game'`; a game with no `sets` gives `[]`; a set with no `agentPrompt` gives
  null; `config` `{ command: '' }` and a target `{ command: 'make', args: [] }` come back equal.
- `backend-registry.test.ts`, `describe('createBackendRegistry')`: `it('gets an added kind until
  its dispose')`; `it('throws on a second add of one kind')` with the text `backend kind "local" is
  already added`; `it('tells listeners once per add and per first dispose')` — add, dispose,
  dispose again: two calls.
- `poller.test.ts`, `describe('createBuildsPoller')`, over the harness-style fake timers
  (`trackedTimers` or a `vi.useFakeTimers()` clock) and a `poll` that resolves on a `deferred`:
  - `it.each` "$case arms $ms": `isFast` true → `FAST_POLL_MS`; false → `SLOW_POLL_MS`; a
    rejected poll with `isFast` false → `SLOW_POLL_MS` and the log line
    `poll handling failed: boom`. Each row advances `ms - 1` (no second poll) and then 1 (second
    poll).
  - `it('runs one more poll after the running one for any number of pollNow calls')`: three
    `pollNow` while poll 1 is pending; after it settles, `poll` has been called twice.
  - `it('polls at once when a slow wait turns fast')`: armed slow, `isFast` becomes true,
    `reschedule()`: a poll starts with no time advanced.
  - `it('arms nothing for a backend dropped while its poll runs')`: `setBackends(['b1'], [])`, then
    `setBackends([], [])` while the poll is pending; it settles; advancing `SLOW_POLL_MS` polls
    nothing.
  - `it.each` "setBackends $case", each starting from `setBackends(['b1'], [])` with poll 1
    settled and `b1` armed slow:

    | case | call | new polls with no time advanced |
    |---|---|---|
    | unchanged id keeps its timer | `setBackends(['b1'], [])` | none; one `b1` poll after `SLOW_POLL_MS` |
    | replaced id polls at once | `setBackends(['b1'], ['b1'])` | one `b1` poll |
    | new id polls at once | `setBackends(['b1', 'b2'], [])` | one `b2` poll, no `b1` poll |

  - `it('marks one more for a replaced id whose poll runs')`: `setBackends(['b1'], ['b1'])`
    while poll 1 is pending: no second poll starts; after poll 1 settles, `poll` has been called
    twice.
  - `it('pollNow on a waiting id clears its timer and polls at once')`: `b1` armed slow;
    `pollNow('b1')` starts poll 2 with no time advanced; after it settles and is armed slow again,
    advancing `SLOW_POLL_MS - 1` gives no third poll, so the old timer is gone.
  - `it('pollNow on an unlisted id does nothing')`: `setBackends(['b1'], [])`; `pollNow('b9')`:
    `poll` was never called with `b9`.
- `link-store.test.ts`, `describe('createLinkStore')` over `createMemoryFiles`:
  - `it('writes each change whole and reads it back after a new load')`.
  - `it('loads a missing file as empty and drops bad entries')`: one bad link among two gives one
    link and the log `session-links.json: dropped 1 bad entries`.
  - `it.each` "writes nothing after a load of $case": `not JSON` (text `{`) and `an array` (text
    `[]`): `load()` rejects; after `addLinks`, the file still holds the bad text and `written()`
    resolves false.
  - `it('reads a missing member as empty and counts bad entries across members')`: text
    `{"links":[]}` loads with `setRuns()` `[]` and `offers()` `{}`, and logs nothing; text
    `{"links":[1],"setRuns":["x"],"offers":{"s1":5}}` loads empty and logs
    `session-links.json: dropped 3 bad entries` once.
  - `it('resolves written false when a write rejects')`.
  - `it.each` "prune keeps $case: $kept", with `now` = `10 * PRUNE_AFTER_MS`:

    | case | link | listed | kept |
    |---|---|---|---|
    | ended at the limit | `endedAt` = `now - PRUNE_AFTER_MS` | true | true |
    | ended past the limit | `endedAt` = `now - PRUNE_AFTER_MS - 1` | true | false |
    | untold, listed, old | `endedAt` null, `linkedAt` = `now - PRUNE_AFTER_MS - 1` | true | true |
    | untold, unlisted, old | as above | false | false |
    | untold, unlisted, at the limit | `linkedAt` = `now - PRUNE_AFTER_MS` | false | true |

    and one row pair for a set run over `endedAt` at and past the limit, and one row pair for an
    offer of `s1`:

    | case | offer | kept |
    |---|---|---|
    | offer at the limit | `createdAt` = `now - PRUNE_AFTER_MS` | true |
    | offer past the limit | `createdAt` = `now - PRUNE_AFTER_MS - 1` | false |
- `build-messages.test.ts`, `describe('build messages')`, with game `Tiki Smash` and kind `dev`
  labelled `Dev`. The texts are read by agents, so each row asserts the full text:

  | case | input | text |
  |---|---|---|
  | success, every field | `#331`, `0.12.0`, branch `protos/physics-fun`, revision `2993a9e4c1d2…`, links iOS `https://a/ios` and Android `https://a/and`, `webUrl` `https://ci/331` | `Build ended: Tiki Smash Dev #331 (0.12.0) — success\nBranch protos/physics-fun @ 2993a9e4\nLinks: iOS https://a/ios · Android https://a/and\nOpen: https://ci/331` |
  | failure, one failed job | `#332`, no version, job `ios` `iOS build` failure with `stepText` `Archive failed`, no links, no `webUrl` | `Build ended: Tiki Smash Dev #332 — failure\nBranch protos/physics-fun @ 2993a9e4\nFailed: iOS build (ios) — Archive failed` |
  | failure, no jobs | build `run-7`, no number, `statusText` `exit code 3`, revision null | `Build ended: Tiki Smash Dev — failure\nBranch main\nFailed: Dev (run-7) — exit code 3` |
  | cancelled | `#5`, revision null | `Build ended: Tiki Smash Dev #5 — cancelled\nBranch main` |
  | failing, two jobs | `#332` `0.12.0`, jobs `ios` failure `Archive failed`, `and` failure no text | `Build failing: Tiki Smash Dev #332 — iOS build (ios) failed: Archive failed; Android build (and) failed` |
  | set ended | set `RC set`, builds `#331` success and `#332` failure | `Set ended: Tiki Smash RC set — 1 of 2 succeeded\n\n<#331's block>\n\n<#332's block>` |
  | set ref unlisted | set `RC set` over refs `tiki-1`, `tiki-2`; `builds` holds only `tiki-1` (`#331` success) | `Set ended: Tiki Smash RC set — 1 of 2 succeeded\n\n<#331's block>\n\nBuild tiki-2: no longer listed` |
  | kind not in the game | kind `qa` (not in `game.kinds`), `#5`, success, revision null | `Build ended: Tiki Smash qa #5 — success\nBranch main` |
  | failed job with no text | `#332`, job `ios` `iOS build` failure with `stepText` null, build `statusText` null, revision null | `Build ended: Tiki Smash Dev #332 — failure\nBranch main\nFailed: iOS build (ios)` |
  | result null, no job, no status | build `run-8`, `#6`, `result` null, no jobs, `statusText` null, revision null | `Build ended: Tiki Smash Dev #6 — failure\nBranch main\nFailed: Dev (run-8)` |

- `queueing.test.ts`, `describe('createQueueing')`, over `createFixtureBackend`, a fake `git` with
  `remoteHeads` and `commitSubject` mocks, a memory store, and a fake chat:
  - `it.each` "$case → $problem", one row per row of the problem table above, each asserting the
    exact text and that the fixture's `queued` is empty.
  - `it('pins one revision across a set and links each build to the session')`: set `rc` over
    `dev` and `release`, `remoteHeads(clone, 'releases/x/*')` → `[{ name: 'releases/x/1', sha:
    SHA }]`: `queued` holds two requests with `revision` `SHA`, `remoteHeads` ran once, the store
    holds one set run with both refs and two links with its `setRunId`, and `pollNow` ran once.
  - `it('queues with no revision when the backend does not choose the branch')`: capabilities
    `{ cancel: true, choosesBranch: false }`: `revision` null and `remoteHeads` never ran.
  - `it('keeps the queued builds of a set whose second queue fails')`: problem
    `queued 1 of 2: offline`, a set run with one ref.
  - `it('stores nothing when the first queue of a set rejects')`: set `rc` over `dev` and
    `release`, session `s1`, the fixture's `queue` rejects `offline` on its first call
    (`vi.spyOn(backend, 'queue')`): problem `offline`, `setRuns()` `[]` and `links()` `[]`.
  - `it('adds the set run and its links together after the last queue')`: the fixture's `queue`
    waits on a `deferred` per call; while the second call waits, `setRuns()` and `links()` are
    `[]`; after it resolves, both hold the run and its two links.
  - `it('stores an offer with its revision and subject and replaces the last')`: `offer` for `s1`
    with `remoteHeads` → `[{ name: 'main', sha: SHA }]` and `commitSubject` → `'Fix the menu'`:
    `offers().s1` holds `revision` `SHA` and `subject` `'Fix the menu'`; a second `offer` for
    `s1` with `kind` `release` leaves one offer, of kind `release`.
  - `it('dismisses an offer, and a missing offer is no problem')`: after `dismissOffer('s1')`,
    `offers()` has no `s1`, and a second `dismissOffer('s1')` returns `{ ok: true }`.
  - `it('cancels through the backend, then polls now')`: `cancel({ backend: 'b1', game: 'g1',
    build: 'x' })` returns `{ ok: true }`; the fixture's `cancelled` equals `[{ gameId: 'g1',
    buildId: 'x' }]`, and `pollNow` ran once with `b1`, after it.
  - `it('queues an offer on its own revision and then drops it')`: `queueOffer` passes the
    offer's revision, `remoteHeads` never ran, and `offers()` no longer holds the session.
  - `it('lists branches with the default branch first')`: heads `b`, `main`, `a` with
    `defaultBranch` `main` → names `['main', 'a', 'b']`.
  - `it('launches the set agent in the clone with its prompt')`: `launch` got `{ projectDir:
    '/c', profile: 'work', message: { text: 'Make an RC set.', images: [] } }`.
- `start.test.ts`, `describe('buildsMainPart')`, through `startMainPart` with `fakeDependency`
  for `chatMainKey` (a `send` mock, `launch`, `defaultProfile`, and a `restored` that resolves at
  once unless a row says otherwise), a seeded `sessionsRowsSlot` row
  for `s1`, `settings` naming one backend of kind `fixture`, and a test kind added through the
  part's exports (`fixtureBackendKind('fixture', backend)`):
  - `it('applies the setting at ready, after a kind added at start')`: the snapshot holds the
    backend with no problem only after `ready()`.
  - `it('creates a backend when its kind is added later')`: an entry of kind `late` shows the
    problem `no backend kind "late": its plugin is off or missing`; adding kind `late` clears it
    and its `list` runs with no time advanced.
  - `it('tells a missed ending once, writing the flag first')`: the store file holds a link of
    `s1` with `notified` false and its build finished. After `ready()` and one poll, `send` was
    called once with a text starting `Build ended:`; the `send` mock reads `session-links.json`
    when it is called and finds that link's `notified` already true; a second poll sends nothing.
  - `it('sends nothing when the flag write fails')`: after `ready()`, make the data folder's
    writes reject (`vi.spyOn(harness.files, 'write').mockRejectedValue(new Error('disk full'))`,
    or a `services.files` override whose `write` rejects when `api.data` does not write through
    `harness.files`): no `send`, and the log `ended b1/x for s1: not written, not sent`.
  - `it('sends to no session without a row')`: link for `s9`: no `send`, log
    `ended b1/x for s9: no session row, not sent`.
  - `it('polls fast while shown')`: `invoke('setShown', true)` after a slow arm polls at once; the
    next poll comes after `FAST_POLL_MS`.
  - `it('refuses an offer with no calling session')`: running the `offer` handler with no
    `callerSessionId` rejects `builds.offer: no calling session`.
  - `it('keeps the last good builds through a rejected list or create')`: after one good poll,
    the fixture's `failLists(new Error('offline'))`; the next poll keeps the game's builds and sets
    the backend's problem `Game: offline`. A kind whose `create` rejects `boom` shows
    `create failed: boom` and keeps the builds of the earlier instance (lead's ruling).
  - `it('does nothing for a registry or settings change before ready')`: before `ready()`, add
    kind `late` and `pushSettings` with a changed backend label: no `create` ran and the snapshot
    is `{ backends: [], polledAt: null }`.
  - `it('waits for chat to restore its rows before the first fold')`: `restored` returns a
    `deferred`, and no `s1` row is seeded. Call `ready()`, write the `s1` row into
    `sessionsRowsSlot`, then resolve the deferred and await `ready()`. After one poll, `send` was
    called once with a text starting `Build ended:`.
  - `it('applies nothing for a layout-only settings change')`: after `ready()`, `pushSettings`
    with `layout` `'compact'` and the same `backends`: the fixture's `disposed` stays false, and
    the log holds one `backends applied:` line only.
  - `it('disposes a create that settles after stop')`: a test kind whose `create` waits on a
    `deferred`. Call `ready()`, stop the part, then resolve the deferred with a fresh
    `createFixtureBackend()`: that backend's `disposed` is true, and the snapshot holds no
    instance's builds.
  - `it('drops an apply that a later apply overtook')`: a test kind whose `create` waits on one
    `deferred` per call, each giving a fresh `createFixtureBackend()`. After `ready()`,
    `pushSettings` with backend label `Second` while call 1 waits; resolve call 2, then call 1:
    call 1's backend has `disposed` true, and the snapshot's backend label is `Second`.
  - `it('drops a poll that an apply overtook')`: a backend whose `list` waits on a `deferred`.
    While poll 1 waits, `pushSettings` with backend label `Second`; resolve poll 1 with build `x`:
    the snapshot's game holds no build `x`.
  - `it.each` "subjects: $case", over a `services.git` whose `commitSubject` is a mock, game `g1`
    with `clone` `/c`, and build `x` with revision `SHA`:

    | case | `commitSubject` | polls | `commitSubject` calls | result |
    |---|---|---|---|---|
    | cache hit | resolves `'Fix the menu'` | two | 1 | `subjects` `{ [SHA]: 'Fix the menu' }` |
    | null inside the window | resolves null | two, `FAST_POLL_MS` apart | 1 | `subjects` `{}` |
    | null after the window | resolves null | two, `SLOW_POLL_MS` apart | 2 | `subjects` `{}` |
    | rejection | rejects `bad object` | two | 2 | one log line `commit subject failed: bad object`; `subjects` `{}` |

  - `it.each` "heading problem: $case":

    | case | setup | `problem` |
    |---|---|---|
    | parsed, then instance | games `g1`, `g1` (duplicate); `create` resolves `{ problem: 'no cli' }` | `duplicate game id "g1"; no cli` |
    | parsed, then game failure | games `g1`, `g1`; `failLists(new Error('offline'))` | `duplicate game id "g1"; Game: offline` |
    | a good list clears the failure | as above, then `failLists(null)` and one poll | `duplicate game id "g1"` |
    | none | one valid game, a good list | null |

  - `it('tells a failing build once, writing the flag first')`: link `x` of `s1`; `x` running
    with job `ios` `'failure'`. After one poll, `send` was called once with a text starting
    `Build failing:`; the file's link has `failingNotified` true; a second poll sends nothing.
  - `it('marks a set run and its links told when the set ends')`: set run `r1` of `s1` over `x`
    and `z`, links `x` and `z` with `setRunId` `r1`; `x` finished with `finishedAt` 100 and `z`
    finished with `finishedAt` 300. After one poll, `send` was called once with a text starting
    `Set ended:`. The file's set run has `notified` true and `endedAt` 300, and both links have
    `notified` true and `endedAt` 300.
  - `it('sends and logs nothing for a set run with no session')`: as above with `sessionId` null
    and no links: no `send`, no log line holding `set ended`, and the file's set run has
    `notified` true.
  - `it('passes the caller to the queue command and throws its problem')`: the `queue` command
    with `callerSessionId` `s1` and kind `dev` stores a link of `s1`; with no `callerSessionId`
    it stores no link; with `game` `nope` it rejects `builds.queue: no game "nope" in Backend`.

Done when: compiles (`npm run typecheck`); `npm run lint` (task 02 registered the plugin); the
test gate runs the tests above. The self-test script runs in `npm run selftest -- --plugin
builds`; live checks defer to task 10 "Final verification" (checks 5, 6 and 8 show the
message, the offer across a restart and a bad entry's problem).

Commit: one commit for the group.

## Proof

Commit 223f644f2 · proof: diff read: buildsMainPart, FAST_POLL_MS, SLOW_POLL_MS, PRUNE_AFTER_MS, LINKS_FILE, parseBackends present; wave typecheck and lint pass · concerns: it.each union rows and spy casts in start.test.ts unchecked until the gate; start.test.ts settles with five setImmediate rounds per step; api.data files are copied per start so a files spy applies from the next start; oxlint no-useless-spread warnings in start.ts and poller.ts
