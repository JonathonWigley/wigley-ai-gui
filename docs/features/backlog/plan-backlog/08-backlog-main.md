# 08 — Backlog main part

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/backlog/manifest.ts` · create `src/plugins/backlog/contract.ts` · create
           `src/plugins/backlog/main/start.ts` · create `src/plugins/backlog/main/homes.ts` + `homes.test.ts` · create
           `src/plugins/backlog/main/commit-message.ts` + `commit-message.test.ts` · create
           `src/plugins/backlog/main/followup-writes.ts` + `followup-writes.test.ts` · test
           `src/plugins/backlog/main/start.test.ts` · modify `src/plugins/manifests.ts` (append `backlogManifest` to
           `builtInManifests`) · modify `src/plugins/main.ts` (append `backlogMainPart`) · modify
           `scripts/check-layers.mts` (`src/plugins/backlog`, `…/contract.ts`, `…/main` entries, shaped as docs' are;
           `…/contract.ts` may also import `src/shared/followups`; `…/main` may import `src/plugins/docs/contract.ts`
           and `src/shared/followups`)
Consumes:  `parseFollowups`, `applyFollowupEdit`, `newFollowupsFile`, `FollowupItem`, `FollowupEdit`,
           `FollowupEditResult` ← 01 · `Git.topLevel`, `Git.changedPaths`, `Git.fileAtHead`, `Git.commitPaths`,
           `MainServices.git` ← 02 · `DocsMainExports.machineIndex`, `rebuildMachineIndex`, `readDoc`, `writeDoc`,
           `watchDoc`, event `docs.indexLoaded` ← 04
Produces:  `backlogManifest` in `src/plugins/backlog/manifest.ts`: id `backlog`, `dependsOn: ['docs', 'keys']`,
           settings `{ tags: ['agent-ready', 'needs a feature plan'] }` with its `settingInfo` (label "Tags", one line
           "The tags Backlog's tag picker offers"), every command and scope task 09 binds (list below)
           `backlogMainPart` in `src/plugins/backlog/main/start.ts`
           in `src/plugins/backlog/contract.ts`:
           ```ts
           export interface BacklogTask { path: string; title: string; status: string | null }
           export interface BacklogPlan { path: string; feature: string; title: string; checked: number; total: number; target: string | null; written: string | null; tasks: BacklogTask[] }
           export interface BacklogFeature { path: string; slug: string; checked: number; total: number; tasks: BacklogTask[] }
           export interface BacklogFollowupFile { path: string; items: FollowupItem[] }
           export interface BacklogHome { repo: string; root: string; isCreateTarget: boolean; gitRoot: string | null; uncommitted: boolean; followupFiles: BacklogFollowupFile[]; plans: BacklogPlan[]; features: BacklogFeature[] }
           export interface BacklogRead { homes: BacklogHome[]; message: string | null }
           export type BacklogWriteResult = FollowupEditResult | { type: 'refused'; reason: string }
           export interface BacklogChannel extends ChannelShape {
             invoke: {
               load(): Promise<BacklogRead>;
               rescan(): Promise<BacklogRead>;
               readDoc(path: string): Promise<string>;
               // `path` null: the home's create target file, created when missing.
               applyEdit(homeRoot: string, path: string | null, edit: FollowupEdit): Promise<BacklogWriteResult>;
               // Rejects with the git error text; resolves to the commit message used.
               commit(homeRoot: string): Promise<string>;
             };
             messages: { changed: { homeRoot: string | null } };
           }
           ```
           `export function groupHomes(entries: readonly IndexEntry[], paths: Paths): HomeShape[]` in `homes.ts`
           (`HomeShape` is `BacklogHome` without `isCreateTarget`, `gitRoot`, `uncommitted`, follow-up items and plan
           header fields)
           `export function markCreateTargets<H extends { repo: string; root: string; gitRoot: string | null }>(homes: H[]): (H & { isCreateTarget: boolean })[]` in `homes.ts`
           `export function commitMessage(changes: { before: FollowupItem[]; after: FollowupItem[] }[]): string | null` in
           `commit-message.ts`
           `export async function writeFollowupEdit(deps, path, edit, newFileRepo): Promise<BacklogWriteResult>` in
           `followup-writes.ts`, `deps` holding `readDoc` and `writeDoc`
Decisions: Backlog parses follow-up files itself; the index finds them (design.md § Follow-ups) · Docs' guard and
           changed-on-disk check through `DocsMainExports` (design.md § Seams) · the main part owns file watching and
           git; the page holds no file or git logic

## Commands the manifest declares (all `runsIn: 'page'`)

`showMode`, `listDown`, `listUp`, `listTop`, `listBottom`, `open`, `back`, `toggle` (Enter), `filter`, `create`,
`edit`, `delete`, `toggleAgentReady`, `pickTag`, `commit`, `rescan`, `toggleDone`, `toggleAgentReadyOnly`, `save`,
`cancelEdit`, `leaveBox`, `nextField`, `previousField`, `focusDetail`, `focusList`, `openInDocs`, `lineDown`,
`lineUp`, `halfPageDown`, `halfPageUp`, `boxAccept`, `boxCancel`, `confirmYes`, `confirmNo`, plus the picker commands
the shared list picker needs (read how docs declares `pickerDown`/`pickerUp`/`pickerChoose`/`pickerCancel`). Scopes:
`backlog.list`, `backlog.detail`, `backlog.editor`, `backlog.box` (the `/` filter box), `backlog.confirm`,
`backlog.picker`, each with a title. Labels follow docs' manifest style. Task 09 writes the handlers and the keys.

## What each module does

- `groupHomes` — from the machine index entries with `source: 'features'`, group by `root` into homes, each with its
  `repo`: `followup` entries give the follow-up file paths (unique `path`), `plan` entries the plans
  (`meta.feature`, `checked`, `total`), `feature` entries the features (`meta.slug`, `checked`, `total`), `task`
  entries attach to their plan (`meta.plan`, same feature folder) or their feature (`meta.plan` null). Skip
  `followup` entries whose path is under a repo's `docs/followups/` (they are `source: 'repo'`, so the source filter
  drops them; keep a test that proves it). Sort homes by repo, then root.
- `markCreateTargets` — per repo, the first home with a `gitRoot` by `root` sort; with no git home, the first home
  by `root` sort. Exactly one per repo, so the page needs no no-target branch.
- `load` (start.ts) — `machineIndex()`, `groupHomes`, then per home: `gitRoot` from `git.topLevel(root)`, then
  `markCreateTargets`; each follow-up file read with `readDoc` and parsed with `parseFollowups`; for the create
  target, `<root>/followups.md` joins its follow-up files when it is on disk and the index lacks it, so a file
  Backlog just created shows, is watched and commits before any rescan; each plan's `plan.md` read for its first
  `# ` heading (title, a trailing ` — plan` stripped; the whole heading when it has none; the plan folder name when
  there is no heading) and its `Target: <x> · Written: <y>` line (either part null when absent); `uncommitted` true when
  `git.changedPaths(gitRoot, <home path relative to gitRoot>)` lists any follow-up file. A failed index load returns
  `{ homes: [], message }` with the load's message. One unreadable file logs `[backlog] <path>: <reason>` and is
  skipped.
- `rescan` — `rebuildMachineIndex()`, then as `load`.
- `writeFollowupEdit` — read the file. Missing (or `''`) with `newFileRepo` set: the base text is
  `newFollowupsFile(newFileRepo)` and the expected disk text is `''`. Missing with `newFileRepo` null: return
  `{ type: 'missing', title }` for edit, setTags and delete. Otherwise the base and expected text are what was read.
  `applyFollowupEdit` on the base, then `writeDoc(path, text, expected)`. On `changedOnDisk`, apply the same edit to
  `diskText` once (a `diskText` of `''` starts from `newFollowupsFile` again) and write with `diskText` as expected; a second `changedOnDisk` returns
  `{ type: 'refused', reason: '<path> keeps changing on disk; try again' }`. A guard rejection returns `refused` with
  its text. `missing` and `titleTaken` pass through.
- `applyEdit` — `path` null writes to `<create target home root>/followups.md` with `newFileRepo` the home's repo.
- `commitMessage` — per file, match items by title: in after only → added; in before only → removed; same title,
  only tags differ → tagged; any other field differs → edited. Message
  `Follow-ups edited in Backlog: added A, B; edited C; removed D; tagged E`, parts in that order, empty parts left
  out; null when nothing changed.
- `commit` — for the home: `before` from `git.fileAtHead`, `after` from disk, for each follow-up file; null message
  rejects `Nothing to commit in <root>`; else `git.commitPaths(gitRoot, <changed follow-up files>, message)`, then send
  `changed`.
- Watching — after each load, watch every listed follow-up file with `watchDoc`, disposing the last load's watches;
  each change sends `changed` with that home's root. `docs.indexLoaded` for `machine` sends `changed` with
  `homeRoot: null`. Dispose all watches in `dispose`.

GIVEN two homes for repo `r` (one with a `gitRoot`, one under `~/wigley-features/r` without) WHEN
`markCreateTargets` runs THEN only the git one has `isCreateTarget`.
GIVEN a write whose file changed on disk after the read, with the edited item still present WHEN `writeFollowupEdit`
runs THEN the edit lands on the new disk text and both changes survive.
GIVEN HEAD holds items A, B and the disk holds A (tags changed), C WHEN `commitMessage` runs THEN it returns
`Follow-ups edited in Backlog: added C; removed B; tagged A`.

Tests:     `homes.test.ts` (grouping, task attachment, repo `docs/followups` excluded; `markCreateTargets`: git home
           wins, two git homes pick the first by root, no git home picks the first by root) ·
           `commit-message.test.ts` (each part, order, null) · `followup-writes.test.ts` over fake `readDoc`/`writeDoc`
           (applied, one retry, second conflict refused, guard refusal, new file expects `''`, missing with no repo
           returns `missing`) · `start.test.ts` (load over a fake docs export and fake `Git`, `uncommitted`, a
           create target's on-disk `followups.md` the index lacks is listed, plan title with and without ` — plan`,
           `commit` calls `commitPaths` with only follow-up files, watch change sends `changed`). Build every index entry and file text in the test.
Done when: `npm test -- src/plugins/backlog` passes; `npm run lint` and `npm run typecheck` pass. The page part does
           not exist yet, and that is fine: the only startup check on handlers is the keymap's
           (`CommandRegistry.requireRegistered`, `src/shared/command-registry.ts`), and no key names a backlog command
           until task 09.
Commit:    one commit for the group

## Proof

Commit d4855da · proof: diff read; backlog tests 44 pass; typecheck clean · concerns: homes.ts copies docs' small metaString helper (backlog main may import only docs' contract); a symlinked clone could read as not uncommitted
