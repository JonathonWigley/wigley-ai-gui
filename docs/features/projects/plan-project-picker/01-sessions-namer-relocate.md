# 01 — Sessions: project namers and relocate

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Sessions main gains two exports. `addProjectNamer` lets another plugin name a row's project from its folder ahead of
today's origin-repo lookup (chat registers one in task 03). `relocate` lets the owner of a row whose session has not
started move it to another folder (chat moves a pool project's row from the placeholder clone to the claimed one in
task 03). Read `docs/features/session-groups/design.md` § Projects and `docs/features/projects/design.md` § Pool
projects and § Membership first.

**Files**

- modify `src/plugins/sessions/contract.ts`
- modify `src/plugins/sessions/main/session-list.ts`
- modify `src/plugins/sessions/main/start.ts`
- modify `src/plugins/sessions/main/consumer-view.ts`
- test `src/plugins/sessions/main/session-list.test.ts`
- test `src/plugins/sessions/main/start.test.ts`

No file outside `src/plugins/sessions/` changes. Every other implementer of `SessionsMainExports` is a partial fake
cast with `as unknown as` / `as never` (`chat/main/start.test.ts`), so the new members break no other typecheck.

**Consumes**: nothing from another task.

**Produces**

In `src/plugins/sessions/contract.ts`, word for word:

```ts
export type ProjectNamer = (projectDir: string) => string | null;
export interface ProjectNamerHandle extends Disposable { changed(): void }
// SessionsMainExports gains:
addProjectNamer(namer: ProjectNamer): ProjectNamerHandle;
relocate(sessionId: string, projectDir: string): void;
// SessionsMainEvents gains:
relocated: AgentSession;
```

`SessionList` in `session-list.ts` is `Omit<SessionsMainExports, 'holdConnects' | 'activate'> & …`, so it carries both
members with the same signatures; `start.ts` and `consumer-view.ts` pass them through as below.

## Decisions

**A row's project.** A session's project is, in order:

1. the answer of the newest registered namer that answers non-null for its folder — namers asked newest first, the
   first non-null answer wins, no later namer asked;
2. else the origin repo name its folder's lookup (`deps.projectName`) landed with, once it landed non-null;
3. else its group (the folder's last segment, the `label` override, or the no-folder label), as today.

- A session with `projectDir === null` asks no namer and no lookup, as today.
- The origin lookup always runs at connect, open and relocate, whatever a namer answers, so a namer answering null
  later (its `changed()`, its `dispose()`) falls back to the landed origin name with no second lookup. The lookup is
  cached per folder by `createOriginRepoNames`, so this costs one git call per folder for the app's life.
- A namer that throws is logged as `project namer failed for <projectDir>: <errorText(error)>` and counts as null;
  the next namer is asked.
- Each namer is its own registration object, so one function added twice is two namers until both handles dispose
  (the pattern of `addCloseGuard`).

**When namers are asked.** At `addEntry` (connect and open), at `relocate`, at a handle's `changed()`, and at a
handle's first `dispose()` (after the namer leaves the set). `changed()` and `dispose()` re-ask every entry the list
holds, with or without a row: an entry with no row keeps the new project for its next row, as the lookup does today.
A namer registered with `addProjectNamer` asks nothing at registration: the registering plugin calls `changed()` when
it wants rows re-asked (chat does so in task 03 after registering).

- `changed()` after its handle disposed does nothing. A second `dispose()` does nothing.
- `changed()`, `dispose()` and a lookup landing after the list's `stop()` change nothing (the existing `isStopped`
  guard); the namer still leaves the set on `dispose()`.
- A re-ask writes `rows.set(id, { ...row, project })` only for a row whose project changed, never in place, and
  emits no event: the rows slot write is the notice, as the lookup's landing is today.

**`relocate(sessionId, projectDir)`.** The owner's move of a row whose session has not started: the caller promises
that no process runs in the old folder yet; sessions cannot check it and does not try.

- Throws `Error('relocate for unknown session <sessionId>')` for an id the list holds no entry for (never opened, or
  ended), and `Error('relocate for session <sessionId>, which no plugin opened')` for a connected (not owned) session.
  Neither throw writes anything.
- A `projectDir` equal (`===`) to the session's current `info.projectDir` returns without writing or logging.
- Otherwise, in one synchronous block:
  1. sets `entry.session.info.projectDir = projectDir` **in place** on the session's one info object, as
     `setHostSessionId` changes `sessionId`, so every holder of the info (each contribution's tool session, chat's
     permission tool session) sees the new folder;
  2. recomputes the label as at connect: `entry.group = groupOf(info)` (an `info.label` override stays the group),
     `entry.number = freeNumber(<every other entry>, group)` — the entry itself excluded, so it never counts its own
     old number — which frees its old group's number for the next session there;
  3. resets the origin name to null, re-asks the namers, sets `entry.project`, and starts the origin lookup for the
     new folder;
  4. writes the row, when it has one, as `{ ...row, projectDir, label: labelOf(entry), project: entry.project }`,
     keeping `marked`, `markToast`, `titles`, `hostSessionId` and the selection as they are;
  5. logs `owned session <sessionId> moved to <projectDir>`.
- A lookup that lands for a folder the entry no longer holds (`entry.session.info.projectDir !== <the lookup's
  folder>`) changes nothing: the old folder's late answer must not overwrite the new folder's project.
  6. emits `relocated` with `entry.session` (`deps.emit('relocated', entry.session)`), after the row write, as
     `setHostSessionId` emits `hostSessionChanged`.
- `SessionsMainEvents` gains `relocated: AgentSession`, its comment beside `hostSessionChanged`'s: an owned session
  moved to another folder before its process started, emitted after the row write that carries it, with the
  session's info already updated. Plugins that copy `info.projectDir` at `sessions.connected` (docs' session source,
  workflow's `connected` map) re-read it on this event; task 01b adds those listeners.
- The same-folder return emits nothing; the throws emit nothing.

**Ownership through the view.** `sessionsMainView` (consumer-view.ts) keeps a `Set<string>` of the app ids its own
`open` returned, adding each id as `open` returns and deleting it in the wrapped `end`. Its `relocate` throws
`Error('relocate for session <sessionId>, which this plugin did not open')` for an id not in the set, else calls
`exports.relocate`. A session another dependent opened, or one connected rather than opened, is therefore refused at
the view; the list's own throws cover an id the view holds whose session ended another way (`endAll`).

**Registration filing.** The view's `addProjectNamer` returns `consumer.track(exports.addProjectNamer(namer))`
(`track` returns its argument, so the `changed()` member survives), so a dependent's stop disposes its namer and the
rows are re-asked without it.

## Modifications, member by member

`src/plugins/sessions/contract.ts`

- Add `ProjectNamer` and `ProjectNamerHandle` after `ContributeToolsOptions`, each with a comment: the namer answers a
  project name for a folder or null; the handle's `changed()` re-asks every row, and `dispose` removes the namer and
  re-asks every row.
- `SessionsMainExports`: add `addProjectNamer` and `relocate` after `titles`, each with a doc comment carrying the
  Decisions above (newest first, first non-null wins, else the origin lookup; throws and in-place info change for
  `relocate`, and that the caller must call it before the session's process starts).
- `SessionRow` block comment: now says `projectDir`, `hostSessionId` and `harness` are fixed at connect. After: the
  session's info, `projectDir` also changed by the owner through `relocate`, `hostSessionId` through
  `setHostSessionId`.
- `SessionRow.project` comment: now "the origin repo name of its folder, else the folder's name, else the no-folder
  label. Set to the fallback at connect and changed once when the lookup lands." After: the newest registered namer's
  name for its folder, else the origin repo name, else the folder's name, else the no-folder label; re-asked at each
  namer's `changed()` and `dispose()`, at the lookup's landing and at `relocate`.
- `sessionsRowsSlot` comment: now "A row's `label` (`gamma 2`) is fixed for its life." After: fixed for its life
  except at a `relocate`, which renumbers it in its new folder.
- `label(sessionId)` comment on `SessionsMainExports`: add that `relocate` changes it.

`src/plugins/sessions/main/session-list.ts`

- `SessionListDeps.projectName`: comment now "The project of a session in `projectDir`". After: the origin repo name of
  `projectDir`, the project a row takes when no namer names its folder.
- `SessionEntry`: `group` and `number` comments now "Fixed at connect"; after: set at connect and again by `relocate`.
  `project` stays the row's project (comment rewritten to the three-step order). Add `namedProject: string | null` (the
  namers' last answer for the folder) and `originProject: string | null` (the lookup's landed name, null until it
  lands and again after a `relocate`).
- New closure state in `createSessionList`: `const projectNamers = new Set<{ namer: ProjectNamer }>()`.
- New inner function that asks the namers for an entry (newest first over `[...projectNamers].reverse()`, logging a
  throw) and one that sets `entry.project = entry.namedProject ?? entry.originProject ?? entry.group` and writes the
  row when the project changed. Names are the implementer's.
- `lookUpProject(entry, projectDir)`: now sets `entry.project = name` on a non-null landing. After: sets
  `entry.originProject = name` and recomputes the project, and changes nothing when the entry's
  `info.projectDir !== projectDir` or the list stopped. Its comment changes to match.
- `addEntry`: now `project: group`. After: asks the namers before the first row exists, so an owned session's row is
  written by `open` with the namer's name already set (no extra state write). Comment updated.
- Returned object: add `addProjectNamer(namer)` and `relocate(sessionId, projectDir)` per Decisions.
- `createSessionList` block comment: the sentence "so does its project, which starts as the group and writes the row
  when its lookup changes the project of a session with a row, until `stop`" becomes the namer-then-lookup order, and
  a sentence on `relocate` joins it.

`src/plugins/sessions/main/start.ts`

- `exports` in `sessionsMainPart.start`: add `addProjectNamer: (namer) => list.addProjectNamer(namer)` and
  `relocate: (sessionId, projectDir) => list.relocate(sessionId, projectDir)`.
- `sessionsMainPart` comment: "their sidebar rows" becomes "their sidebar rows and the project each row groups under,
  from the namers other plugins register".

`src/plugins/sessions/main/consumer-view.ts`

- `sessionsMainView`: add `addProjectNamer` (tracked) and `relocate` (checked against the opened ids) per Decisions;
  `open` records its id, the wrapped `end` deletes it. Its comment gains: every project namer it adds is filed too, and
  `relocate` acts only on a session this dependent opened.

## Behaviour

- GIVEN a namer naming `/work/ng-2` `New Games` WHEN a session connects in `/work/ng-2` and gets a row THEN its row's
  project is `New Games` before the origin lookup lands, and stays `New Games` after it lands `new-games-prototypes`.
- GIVEN two namers that both name a folder WHEN a session opens there THEN the newer one's name is the project.
- GIVEN a namer whose answer for a row's folder changed WHEN its handle's `changed()` runs THEN that row is rewritten
  with the new project, and a row whose project is unchanged is not written.
- GIVEN a namer naming a row's folder WHEN its handle disposes THEN the row falls back to the landed origin name, or
  to the folder's name when the lookup has not landed.
- GIVEN an owned row in `/work/ng-1` WHEN its owner relocates it to `/work/ng-3` THEN the row's `projectDir` is
  `/work/ng-3`, its label is `ng-3` (`ng-3 2` when another session holds `ng-3`), its project comes from the namers,
  else the new folder's lookup, and the session's info object reads `/work/ng-3`.
- GIVEN a relocated row WHEN the old folder's lookup lands late THEN the row's project does not change.
- GIVEN a connected session, an unknown id, or an ended one WHEN `relocate` is called THEN it throws and writes
  nothing.
- GIVEN a session dependent A opened WHEN dependent B relocates it through its view THEN it throws; through A's view
  it moves.

## Tests

All in the existing suites; the session-list tests use `setUp`, `deferred`, `MARK`, `info`, `owned`,
`fakeContribution`, `rowProjects` and `labels` as they stand. A namer in a table is written as a
`Record<string, string | null | Error>` by folder: a folder it lacks answers null, an `Error` is thrown.

`src/plugins/sessions/main/session-list.test.ts`

1. **`rowProjectFollowsTheNamers: $name`** (`it.each`, beside `rowProjectFollowsTheLookup`). Each row registers its
   namers in order (oldest first), connects its sessions and marks each, records projects, lands every lookup with
   `landings`, then records again. Asserts `projectsAtConnect`, `projects` after landing, the folders each namer was
   asked for, and `logged`.

   | name | namers (oldest → newest) | session folders | landings | projectsAtConnect | projects | logged |
   |---|---|---|---|---|---|---|
   | a namer's name shows at connect and outlasts the lookup | `[{'/work/ng-2':'New Games'}]` | `/work/ng-2` | `'new-games-prototypes'` | `['New Games']` | `['New Games']` | `[]` |
   | a namer's null leaves the origin lookup | `[{}]` | `/work/ng-2` | `'new-games-prototypes'` | `['ng-2']` | `['new-games-prototypes']` | `[]` |
   | the newest namer wins | `[{'/work/a':'Older'}, {'/work/a':'Newer'}]` | `/work/a` | `'repo'` | `['Newer']` | `['Newer']` | `[]` |
   | a newer namer's null asks the older | `[{'/work/a':'Older'}, {}]` | `/work/a` | `'repo'` | `['Older']` | `['Older']` | `[]` |
   | a throwing namer is logged and counts as null | `[{'/work/a':'Older'}, {'/work/a': new Error('bad rule')}]` | `/work/a` | `'repo'` | `['Older']` | `['Older']` | `['project namer failed for /work/a: bad rule']` |
   | no folder asks no namer | `[{'/work/a':'Named'}]` | `null` | — | `['session']` | `['session']` | `[]` |

   Breaks caught: namers asked oldest first; the origin landing overwriting a namer's name; a throw escaping or
   stopping the search; a namer asked for a null folder (the last row also asserts the namer was asked for nothing).

2. **`projectNamerHandle_ReasksEveryRow: $name`** (`it.each`). Setup: one namer reading a mutable `answers` map,
   starting `{ '/work/a': 'P' }`; sessions in `/work/a` and `/work/b` connected and marked; lookups landed
   `/work/a` → `repo-a`, `/work/b` → `repo-b` unless the row says `landed: false`. Then the row's `act` runs, and the
   test asserts the projects, the `calls` entries recorded after the act (`rows set <id>` lines), and that no state
   was written when `rowsWritten` is `[]`.

   | name | landed | act | projects after | rowsWritten |
   |---|---|---|---|---|
   | changed with a new name rewrites only that row | yes | `answers = {'/work/a':'Q'}; handle.changed()` | `['Q','repo-b']` | `[<a's id>]` |
   | changed to null falls back to the landed origin | yes | `answers = {}; handle.changed()` | `['repo-a','repo-b']` | `[<a's id>]` |
   | changed to null before the lookup lands falls back to the folder | no | `answers = {}; handle.changed()` | `['a','b']` | `[<a's id>]` |
   | changed with nothing new writes nothing | yes | `handle.changed()` | `['P','repo-b']` | `[]` |
   | dispose re-asks without the namer | yes | `handle.dispose()` | `['repo-a','repo-b']` | `[<a's id>]` |
   | changed after dispose writes nothing | yes | `handle.dispose(); answers = {'/work/b':'Z'}; <clear calls>; handle.changed()` | `['repo-a','repo-b']` | `[]` |
   | a second dispose writes nothing | yes | `handle.dispose(); <clear calls>; handle.dispose()` | `['repo-a','repo-b']` | `[]` |
   | changed after stop writes nothing | yes | `list.stop(); answers = {'/work/a':'Q'}; handle.changed()` | `['P','repo-b']` | `[]` |

   Breaks caught: re-asking only rows a namer named before; writing every row on each re-ask; a fallback to the
   group instead of the landed origin; dispose leaving the namer in the set or not re-asking; `isStopped` ignored.

3. **`changed_SessionWithNoRow_ItsNextRowCarriesTheNewName`**. A session connected in `/work/a` with no mark; the
   namer's answer moves from `P` to `Q` and `changed()` runs; no state is written; `list.mark(id, MARK)` then writes
   a row whose project is `Q`. Break caught: a re-ask that skips entries with no row.

4. **`relocate_OwnedRow_MovesItsFolderLabelAndProject: $name`** (`it.each`). Each row opens `owned('host-1',
   '/work/ng-1')` (selected), with `fakeContribution()` contributed first, lookups deferred per folder, optional
   namers and other sessions as the row says, then calls `list.relocate(<id>, '/work/ng-3')`, lands the lookups the
   row names, and asserts the row's `projectDir`, `label`, `project`, that `marked`, `titles` and the selection are as
   before the move, that `fakeContribution().startedInfos[0].projectDir` is `'/work/ng-3'`, and that the deps
   recorded one `relocated` emit whose `info.projectDir` is `'/work/ng-3'`, after the row write.

   | name | before the move | namers | landings after the move | label | project |
   |---|---|---|---|---|---|
   | takes the new folder's label and its lookup | — | none | `/work/ng-3` → `'new-games-prototypes'` | `'ng-3'` | `'new-games-prototypes'` |
   | numbers the label among the new folder's sessions | a connected, marked session in `/work/ng-3` | none | none | `'ng-3 2'` | `'ng-3'` |
   | a namer names the new folder | — | `[{'/work/ng-3':'New Games'}]` | none | `'ng-3'` | `'New Games'` |
   | the old folder's late lookup changes nothing | — | none | `/work/ng-1` → `'old-repo'` (landed after the move) | `'ng-3'` | `'ng-3'` |
   | a label override stays the group | opened with `{ ...owned('host-1','/work/ng-1'), label: 'chat' }` | none | none | `'chat'` | `'chat'` |

   Breaks caught: info replaced rather than changed in place; the row's label kept from the old folder; the entry's
   own old number counted; a stale landing overwriting; the lookup not started for the new folder; `marked` or titles
   dropped by the row rewrite; the `relocated` emit dropped or sent before the row write.

5. **`relocate_FreesTheOldFoldersNumber`**. Opens a session in `/work/ng-1`, relocates it to `/work/ng-3`, then
   connects and marks a session in `/work/ng-1`; that row's label is `'ng-1'`, not `'ng-1 2'`. Break caught: `group`
   or `number` left on the old values.

6. **`relocate_NotOwnedOrUnknown_ThrowsAndWritesNothing: $name`** (`it.each`): the arranged id, and the error text
   asserted with `toThrow(<id>)`; then `states` holds no entry written by the call and no `relocated` was emitted.

   | name | arrange |
   |---|---|
   | an unknown id | `'nope'` |
   | a connected session | `connectWithRow(list, info('/work/a')).session.id` |
   | an owned session after its end | open `owned('host-1')`, `end()` it, use its id |

7. **`relocate_SameFolder_WritesNothing`**. Relocating an owned session to the `projectDir` it holds writes no state
   logs nothing and emits no `relocated`. Break caught: a needless rewrite renumbering the row.

`src/plugins/sessions/main/start.test.ts`

8. **`addProjectNamer_DependentStops_RowsReaskedWithoutIt`**. `startSessionsPart(10, { state })` with a slot store
   the test reads rows from (`state.read(sessionsRowsSlot)`); a bystander view opens `{ sessionId: 'host-1',
   projectDir: '/p/clone', harness: 'claude' }`; a dependent view registers a namer naming `/p/clone` `Named` and calls
   `changed()`; the row's project is `'Named'`; `dependent.dispose()`; the row's project is `'clone'`. Break caught:
   the view not tracking the handle.

9. **`relocate_ThroughAView_OnlyForSessionsThatViewOpened`**. View A opens `hostInfo('host-a')`; view B's
   `relocate(<id>, '/elsewhere')` throws with the id in the message and the row's `projectDir` is unchanged; view A's
   `relocate(<id>, '/elsewhere')` moves the row to `'/elsewhere'`. Break caught: the view passing every id through.

## Done when

`npm run typecheck`, `npm run lint`, and `npx vitest run src/plugins/sessions/main/session-list.test.ts
src/plugins/sessions/main/start.test.ts` pass (the test gate runs them).

## Commit

One commit for the group, e.g.: `Sessions main gains addProjectNamer (registered namers name a row's project, newest
first, ahead of the origin-repo lookup) and relocate (the owner moves a row whose session has not started to another
folder, renumbering its label and re-reading its project)`.

## Proof

Commit fdaa002d · proof: diff read (all Produces present word for word), typecheck and lint clean, session-list and start tests pass · concerns: test 5 catches a stale group but not a stale number (test 4 covers the number); addEntry asks namers before tool sessions start, so a throwing start has asked a namer for a session that never exists
