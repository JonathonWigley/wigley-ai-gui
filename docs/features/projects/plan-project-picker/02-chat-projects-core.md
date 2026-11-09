# 02 — Chat: projects setting, membership and pool provider registry

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Chat gains the `projects` setting, the project and pool-provider types in its contract, the `addPoolProvider` export,
and the pure rules every later task reads projects through: `readProjects` (the setting checked), `projectOf` (which
project a folder belongs to) and `branchChoices` (a pool project's Branch list). Nothing reads the setting or the
provider yet: task 03 wires them into the start path and registers the namer with sessions. Read
`docs/features/projects/design.md` (all of it) and `AGENTS.md`'s settings bullet (grep `A setting\*\* is a core
setting`) and plugin-exports bullet (grep `exports(consumer)`) first.

**Files**

- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/manifest.ts`
- modify `src/plugins/chat/main/start.ts`
- create `src/plugins/chat/main/projects.ts`
- test (create) `src/plugins/chat/main/projects.test.ts`

No sessions file changes, and nothing calls `sessions.addProjectNamer` (task 03 does).

**Consumes**: nothing from another task.

**Produces**

In `src/plugins/chat/contract.ts`, word for word from plan.md:

```ts
export interface ProjectSetting {
  name: string;
  folder?: string;
  pool?: string;
  profile?: string;
  pinnedBranches?: string[];
}
export type ChatProject =
  | { kind: 'folder'; name: string; folder: string; profile: string | null }
  | { kind: 'pool'; name: string; pool: string; profile: string | null; pinnedBranches: readonly string[] };

export interface PoolClaimRequest { pool: string; branch: string; hostSessionId: string; rowId: string }
export type PoolClaimResult =
  | { ok: true; path: string; note: string | null }
  | { ok: false; error: string; message: string };
export interface PoolProvider {
  folders(pool: string): readonly string[];
  branches(pool: string, refresh: boolean): Promise<string[]>;
  claim(request: PoolClaimRequest, signal: AbortSignal, queued: () => void): Promise<PoolClaimResult>;
}
// ChatMainExports gains:
addPoolProvider(provider: PoolProvider): Disposable;
```

In `src/plugins/chat/main/projects.ts`:

```ts
export function readProjects(raw: readonly ProjectSetting[], log: (line: string) => void): ChatProject[];
export function projectOf(folder: string, projects: readonly ChatProject[],
  poolFolders: (pool: string) => readonly string[], homeDir: string,
  paths: Pick<Paths, 'isInside' | 'expandTilde'>): ChatProject | null;
export function branchChoices(pinned: readonly string[], origin: readonly string[]): string[];

// Added beyond plan.md's list (the registry addPoolProvider writes and task 03 reads):
export interface PoolProviders {
  add(provider: PoolProvider): Disposable;
  current(): PoolProvider | null;
}
export function createPoolProviders(): PoolProviders;
```

`projectOf` takes `paths` as its fifth parameter (plan.md's signature; Decisions, Path compare).

In `src/plugins/chat/main/start.ts`: `const poolProviders = createPoolProviders();` inside `chatMainPart.start`, next
to `folderChoices`, which task 03 reads through `poolProviders.current()`.

## Decisions

**The setting.** `chatManifest.settings` gains `projects: [] as ProjectSetting[]` after `profiles`, and `settingInfo`
gains:

```ts
projects: {
  label: 'Projects',
  description:
    'The projects a new session starts from, in the order the start prompt lists them: a name, and a folder or a unity-pool pool, each; an optional profile every session of the project runs under, and a pool's pinned branches.',
},
```

No `optionalSettings` entry: the default list is empty, so the settings check (`checkElements` in
`src/main/config/user-settings.ts`) checks no element, and `projects` is one leaf (`SettingPath` takes an array whole).
The existing `manifests_SettingInfo_DeclaresEveryLeafSetting` test covers the declaration; the default is a design
value and gets no test.

**`readProjects(raw, log)`** checks each element in order and returns the kept ones as `ChatProject`s, in settings
order. Because the settings check cannot type an empty default's elements, `raw` may hold any JSON whatever its type
says; each check below reads the element as `unknown`. An element failing a check is left out and logs one line:

`projects[<index>] <name> skipped: <fault>` — `<index>` its place in `raw`, `<name>` its `name` as
`JSON.stringify` writes it when the name is a string, else the word `unnamed`.

A key whose value is JSON `null` counts as absent, as `start_session` treats a null `folder` or `profile`: a
hand-written `"profile": null` keeps the project with no fixed profile. Add one table row: `{ name: 'A', folder:
'/a', profile: null, pool: null }` → kept as a folder project, `profile` null.

Checks, first failing one wins:

| Fault | Element |
|---|---|
| `not an object` | anything but a plain JSON object |
| `name must be a non-empty string` | `name` missing, not a string, or `''` |
| `needs a folder or a pool` | neither `folder` nor `pool` present |
| `has both a folder and a pool` | both present |
| `folder must be a non-empty string` / `pool must be a non-empty string` | the present one not a string, or `''` |
| `profile must be a string` | `profile` present and not a string |
| `pinnedBranches belongs to a pool project` | `pinnedBranches` present on a folder project |
| `pinnedBranches must be a list of branch names` | `pinnedBranches` present and not an array of strings |
| `the name an earlier project took` | `name` equal (`===`) to a **kept** earlier entry's name |

- A name is taken only by a kept entry: a later entry with the name of a skipped one is kept.
- `profile` absent → `null`. Whether the profile exists in chat's `profiles` is not checked here (`readProjects` has
  no profiles); task 03's start rejects an unknown profile.
- `pinnedBranches` absent on a pool → `[]`; present, kept as written (duplicates included; `branchChoices` drops them).
- `folder` is kept **unexpanded**: a `~` stays `~` in the result. Every reader expands it with
  `paths.expandTilde(project.folder, homeDir)` — `projectOf` below, and task 03's start in the folder. `readProjects`
  takes no `paths` or `homeDir`, so it checks no path shape: a relative folder is kept and matches no session folder.
- `readProjects` logs on every call; the caller reads it once per settings change, not per question (task 03).

**`projectOf(folder, projects, poolFolders, homeDir, paths)`** returns the first project in `projects` order that
covers `folder`, else `null`:

- a folder project covers `folder` when `paths.isInside(folder, paths.expandTilde(project.folder, homeDir))`;
- a pool project covers `folder` when `poolFolders(project.pool).some((clone) => paths.isInside(folder, clone))`;
  clone paths are used as the provider gives them (full paths), not tilde-expanded. An unknown pool gives `[]` and
  covers nothing.

`folder` is a session's `projectDir`, a full path. `homeDir` is `services.homeDir`, `paths` is `services.paths`,
`poolFolders` is `(pool) => poolProviders.current()?.folders(pool) ?? []` at the call site (task 03).

**Path compare.** Chat compares folders through the `Paths` service: `paths.samePath` (`folder-choices.ts`
`mergeFolderChoices`, `recent-folders.ts`, `start.ts` `closeSessionsIn`) and, for "the folder or below it",
`paths.isInside` (`folder-choices.ts` `isInTempFolder`), whose contract says "compared as samePath does" —
case-insensitive on Windows, normalized, whole segments. `AGENTS.md` makes every path compare in either process go
through `Paths`. plan.md's `projectOf` signature has no `Paths`, and a pure module cannot pick the OS's adapter
itself, so `projectOf` takes `paths: Pick<Paths, 'isInside' | 'expandTilde'>` as its fifth parameter. `Paths` is
imported from `src/contracts/paths.ts`.

**`branchChoices(pinned, origin)`**: each name of `pinned` in its order, then each name of `origin` not in `pinned`,
in origin order; each name once (a repeat in either list is dropped at its later place). Names compare with `===`
(git ref names are case-sensitive). A pinned branch missing from `origin` is still listed: the user wrote it, and the
claim answers `unknown-branch` if origin lacks it.

**`createPoolProviders()`**: one registration object per `add` call, held in a `Set` in registration order (the
pattern of `addIdleCompactThreshold` in `chat-sessions.ts`). `current()` is the newest registration still held, else
`null`. The handle's `dispose` removes its registration, so the one registered before it answers again; a second
`dispose` does nothing. It lives in `projects.ts` so its rule is tested with the other pure rules, without the chat
part harness.

**`addPoolProvider` wiring** in `chatMainPart.start`'s `exports(consumer)`:
`addPoolProvider: (provider) => consumer.track(poolProviders.add(provider))`, after `addResumeSection`, so a dependent's
stop removes its provider. The `exports_ConsumerDisposed_DropsContribution` table in `start.test.ts` gets no row here:
nothing in this task reads the provider through the part; task 03 adds that row once `branches` reads it.

## Modifications, member by member

`src/plugins/chat/contract.ts`

- Add `ProjectSetting`, `ChatProject`, `PoolClaimRequest`, `PoolClaimResult` and `PoolProvider` after `ChatProfile` /
  `RecentFolder`, each with a comment: `ProjectSetting` is one element of the `projects` setting as written, its
  fields unchecked by the settings check; `ChatProject` one entry `readProjects` kept, `folder` unexpanded;
  `PoolClaimResult.note` the CLI's message on a `diverged` claim, else null, and `error` the CLI's error code
  (`dirty`, `unknown-branch`, `no-cli`, `internal`, and `cancelled` when the claim's signal aborted, task 04; open-ended `string`); `PoolProvider.folders` the pool's clone paths by clone number,
  `[]` for an unknown pool, `branches` origin's branch names newest commit first (`refresh` true fetching first),
  `claim` claiming a clone on `branch` for the session's ids, calling `queued` when the claim waits in the pool's
  queue, and stopping the claim when `signal` aborts.
- `ChatMainExports`: add `addPoolProvider(provider: PoolProvider): Disposable;` after `addResumeSection`, with the
  comment: the newest provider still registered answers every pool question; disposing the handle removes it and the
  one registered before it answers again; with none registered a pool project lists no branches and cannot start.

`src/plugins/chat/manifest.ts`

- Import `ProjectSetting` beside `ChatProfile`. `settings` gains `projects: [] as ProjectSetting[]`; `settingInfo`
  gains the `projects` entry above.

`src/plugins/chat/main/start.ts`

- Import `createPoolProviders` from `./projects`. Create `poolProviders` after `folderChoices`; add `addPoolProvider`
  to `exports`.
- `chatMainPart` block comment: its list of exports ("… and one of the resume sections the start prompt lists")
  gains "and one of the pool provider a pool project's branches, clones and claim come from".

`src/plugins/chat/main/projects.ts` (new): a file comment naming it the pure project rules (the setting's checks,
membership, the branch order, the provider registry), each export with the doc comment its Decisions give.

## Behaviour

- GIVEN `projects: [{ "name": "Wigley AI Dev", "folder": "~/Documents/ai-dev" }]` WHEN chat reads it THEN it holds one
  folder project with folder `~/Documents/ai-dev` and profile `null`, and logs nothing.
- GIVEN an entry with both `folder` and `pool` WHEN chat reads the setting THEN that entry is left out, the rest kept
  in order, and the log names `projects[<index>]` and the entry's name.
- GIVEN a folder project on `~/Documents/ai-dev` and home `/Users/u` WHEN asked for `/Users/u/Documents/ai-dev/x`
  THEN `projectOf` answers that project; for `/Users/u/Documents/ai-development` it answers `null`.
- GIVEN two projects that both cover a folder WHEN asked for it THEN the one earlier in settings wins.
- GIVEN pinned `['main', 'protos/b']` and origin `['protos/a', 'main', 'protos/c', 'protos/b']` WHEN the Branch list is
  built THEN it reads `main, protos/b, protos/a, protos/c`.
- GIVEN providers A then B registered WHEN B's handle disposes THEN A answers.

## Tests

`src/plugins/chat/main/projects.test.ts` (new), modelled on `folder-choices.test.ts`: `describe` per export, plain
inputs built in the test, `posixPaths` / `windowsPaths` from `src/shared/paths/`.

1. **`readProjects_KeepsOrSkipsEachEntry: $name`** (`it.each`). Each row: `raw` (cast `as unknown as ProjectSetting[]`
   where it holds a wrong kind), the expected `ChatProject[]`, and `skipped`, the indexes logged. Asserts the result
   with `toEqual`, and `logged` equals `skipped.map((index) => expect.stringMatching(new RegExp('^projects\\[' + index
   + '\\] ')))` (one line per skipped entry, in order, each naming its index).

   | name | raw | expected | skipped |
   |---|---|---|---|
   | a folder project keeps `~` and takes a null profile | `[{name:'Wigley AI Dev', folder:'~/Documents/ai-dev'}]` | `[{kind:'folder', name:'Wigley AI Dev', folder:'~/Documents/ai-dev', profile:null}]` | `[]` |
   | a pool project keeps its profile and pinned order | `[{name:'New Games', pool:'ngp', profile:'work', pinnedBranches:['protos/b','main']}]` | `[{kind:'pool', name:'New Games', pool:'ngp', profile:'work', pinnedBranches:['protos/b','main']}]` | `[]` |
   | a pool with no pinned branches takes none | `[{name:'New Games', pool:'ngp'}]` | `[{kind:'pool', name:'New Games', pool:'ngp', profile:null, pinnedBranches:[]}]` | `[]` |
   | neither folder nor pool | `[{name:'A'}]` | `[]` | `[0]` |
   | both folder and pool | `[{name:'A', folder:'/a', pool:'p'}]` | `[]` | `[0]` |
   | pinned branches on a folder project | `[{name:'A', folder:'/a', pinnedBranches:['main']}]` | `[]` | `[0]` |
   | a name an earlier entry took, the first kept | `[{name:'A', folder:'/a'}, {name:'A', pool:'p'}]` | `[{kind:'folder', name:'A', folder:'/a', profile:null}]` | `[1]` |
   | a name only a skipped entry held is free | `[{name:'A'}, {name:'A', folder:'/a'}]` | `[{kind:'folder', name:'A', folder:'/a', profile:null}]` | `[0]` |
   | a non-object entry | `['New Games']` | `[]` | `[0]` |
   | a missing or empty name | `[{folder:'/a'}, {name:'', folder:'/b'}]` | `[]` | `[0, 1]` |
   | a folder, pool or profile of the wrong kind | `[{name:'A', folder:3}, {name:'B', pool:''}, {name:'C', folder:'/c', profile:true}]` | `[]` | `[0, 1, 2]` |
   | pinned branches that are not names | `[{name:'A', pool:'p', pinnedBranches:['main', 4]}]` | `[]` | `[0]` |
   | a skipped entry leaves the rest in order | `[{name:'A', folder:'/a'}, {name:'Bad'}, {name:'C', pool:'p'}]` | `[{kind:'folder', name:'A', folder:'/a', profile:null}, {kind:'pool', name:'C', pool:'p', profile:null, pinnedBranches:[]}]` | `[1]` |

   Breaks caught: each check removed or flipped; the first of two duplicates dropped instead of the second; a skipped
   entry's name blocking a later one; `~` expanded or `profile` left `undefined`; a missing `pinnedBranches` left
   `undefined`; order lost.

2. **`readProjects_LogLine_NamesTheEntry`**. `[{name:'New Games', folder:'/a', pool:'p'}, {folder:'/b'}]` logs exactly
   two lines, the first starting `projects[0] "New Games" skipped: `, the second `projects[1] unnamed skipped: `.
   Break caught: the log losing the entry's name, which is how the user finds the entry in `settings.json`.

3. **`projectOf_FindsTheCoveringProject: $name`** (`it.each`). Shared fixture: home `/Users/u`; projects, in order,
   `{kind:'folder', name:'Wigley AI Dev', folder:'~/Documents/ai-dev', profile:null}` and `{kind:'pool', name:'New
   Games', pool:'ngp', profile:'work', pinnedBranches:[]}`; `poolFolders` answering `ngp` → `['/Users/u/dev/ngp',
   '/Users/u/dev/ngp-2']` and any other pool → `[]`. A row may replace `projects`, `paths` and `homeDir`. Asserts
   `projectOf(...)?.name ?? null`.

   | name | folder | override | expected |
   |---|---|---|---|
   | the folder project's folder | `/Users/u/Documents/ai-dev` | — | `'Wigley AI Dev'` |
   | below the folder project's folder | `/Users/u/Documents/ai-dev/wigley-ai-gui/.worktrees/x` | — | `'Wigley AI Dev'` |
   | a sibling sharing the folder's prefix | `/Users/u/Documents/ai-development` | — | `null` |
   | a pool clone other than the first | `/Users/u/dev/ngp-2` | — | `'New Games'` |
   | below a pool clone | `/Users/u/dev/ngp/Assets` | — | `'New Games'` |
   | the clones' parent folder | `/Users/u/dev` | — | `null` |
   | a pool the provider does not know | `/Users/u/dev/ngp` | projects: `[{kind:'pool', name:'Other', pool:'other', profile:null, pinnedBranches:[]}]` | `null` |
   | the first of two covering projects wins | `/Users/u/dev/ngp` | projects: `[{kind:'folder', name:'Dev', folder:'~/dev', profile:null}, <the fixture's New Games>]` | `'Dev'` |
   | settings order decides, not depth | `/Users/u/dev/ngp` | projects: `[<the fixture's New Games>, {kind:'folder', name:'Dev', folder:'~/dev', profile:null}]` | `'New Games'` |
   | compared as the OS's paths compare | `c:\users\u\documents\ai-dev\x` | paths `windowsPaths`, home `C:\Users\u` | `'Wigley AI Dev'` |

   Breaks caught: a string-prefix compare (the sibling row); `~` not expanded (every folder row); only the first
   clone checked; the most specific project picked instead of the first; a compare that bypasses `paths` (the Windows
   row).

4. **`branchChoices_PinnedFirstThenOrigin: $name`** (`it.each`), asserting the whole list.

   | name | pinned | origin | expected |
   |---|---|---|---|
   | pinned in their order, then origin's rest in its order | `['main','protos/b']` | `['protos/a','main','protos/c','protos/b']` | `['main','protos/b','protos/a','protos/c']` |
   | a pinned branch missing from origin stays | `['release/x']` | `['main']` | `['release/x','main']` |
   | no pinned branches leaves origin's order | `[]` | `['b','a']` | `['b','a']` |
   | a repeated name shows once | `['main','main']` | `['dev','main']` | `['main','dev']` |
   | names differing only in case are two | `['Main']` | `['main']` | `['Main','main']` |

   Breaks caught: origin re-sorted; pinned dropped when not on origin; duplicates kept; a case-folding compare.

5. **`poolProviders_NewestStillRegisteredAnswers: $name`** (`it.each`). Each row runs `steps` on a fresh
   `createPoolProviders()` with providers `A` and `B` (plain objects cast `as PoolProvider`, compared by identity),
   then asserts `current()`.

   | name | steps | current |
   |---|---|---|
   | none registered | — | `null` |
   | the newer of two | add A, add B | B |
   | the older after the newer disposes | add A, add B, dispose B | A |
   | the newer after the older disposes | add A, add B, dispose A | B |
   | none after every one disposes | add A, dispose A | `null` |
   | a second dispose removes nothing | add A, dispose A, add B, dispose A again | B |

   Breaks caught: oldest answering; dispose removing the wrong registration or the newest regardless; a repeated
   dispose removing a later registration.

## Done when

`npm run typecheck`, `npm run lint`, and `npx vitest run src/plugins/chat/main/projects.test.ts
src/plugins/manifests.test.ts` pass (the test gate runs them).

## Commit

One commit for the group, e.g.: `Chat gains the projects setting (folder or unity-pool projects, checked entry by
entry, a bad one skipped and logged), the pure membership and branch-order rules in main/projects.ts, and
addPoolProvider, whose newest registration answers pool questions`.

## Proof

Commit 3a2a0444 · proof: diff read (every Produces present; ChatProject pool variant only reformatted), typecheck and lint clean, projects.test.ts 36 pass · concerns: readProject casts pool as string since unknown does not narrow; branchChoices relies on Set insertion order
