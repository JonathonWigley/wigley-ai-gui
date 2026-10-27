# 05 — Backlog note filing

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/backlog/contract.ts` · create `src/plugins/backlog/main/note-images.ts` + test
           `src/plugins/backlog/main/note-images.test.ts` · modify `src/plugins/backlog/main/start.ts` · test
           `src/plugins/backlog/main/start.test.ts` · modify `src/plugins/backlog/main/commit-message.ts` · test
           `src/plugins/backlog/main/commit-message.test.ts`
Consumes:  `DocsMainExports.writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>` and
           `DocsMainExports.trashDoc(path: string): Promise<TrashResult>` ← 03 ·
           from the Backlog run's task 08 (`docs/features/backlog/plan-backlog/08-backlog-main.md`), re-checked
           against the landed code at preflight: `BacklogRead`, `BacklogHome` (`repo`, `root`, `isCreateTarget`,
           `gitRoot`, `followupFiles`), `BacklogWriteResult`, `backlogMainPart`, the channel's `load`, `applyEdit`
           and `commit`, `writeFollowupEdit(deps, path, edit, newFileRepo)`,
           `commitMessage(changes: { before: FollowupItem[]; after: FollowupItem[] }[]): string | null` ·
           `parseFollowups`, `FollowupItem` (`title`, `oneLine`, `tags`, `body`), `FollowupEdit` in
           `src/shared/followups/followup-file.ts` (in the tree) · `Clock` in `src/contracts/ambient.ts`,
           `Files.list` in `src/contracts/files.ts`, `Git.changedPaths`, `Git.commitPaths` in `src/contracts/git.ts`,
           `Paths.segmentsBelow`, `Paths.join`, `Paths.parent`, `Paths.samePath`, `Paths.isInside` (all in the tree)
Produces:  in `src/plugins/backlog/contract.ts`, as plan.md § File Structure gives:
           ```ts
           export type NoteTarget =
             | { type: 'create'; title: string; oneLine: string; tags: string[] }
             | { type: 'append'; path: string; title: string };
           export interface BacklogMainExports {
             load(): Promise<BacklogRead>;
             // The tag list Backlog's tag picker offers: the backlog `tags` setting as the user config now sets it.
             tags(): string[];
             // 'create' adds an item to the home's create-target file with `text` as its body; 'append' adds `text` to the
             // end of that item's body. Each PNG in `images` is saved under the home's followups-images/ and linked after
             // `text`. A refused or failed follow-up write trashes the images it saved.
             fileNote(homeRoot: string, target: NoteTarget, text: string, images: readonly Uint8Array[]): Promise<BacklogWriteResult>;
           }
           ```
           `backlogMainPart`'s start returns `exports` typed `BacklogMainExports`
           in `src/plugins/backlog/main/note-images.ts`:
           `export const IMAGES_FOLDER = 'followups-images'`
           `export function imageFolderName(now: number, title: string): string`
           `export interface LinkedImage { folder: string; number: number }`
           `export function linkedImages(body: string): LinkedImage[]`
           `export function imageLinkPrefix(followupFile: string, homeRoot: string, paths: Paths): string`
           `export function imageLink(prefix: string, folder: string, number: number): string`
           `export function noteBody(text: string, links: readonly string[]): string`
           `export function appendedBody(body: string, addition: string): string`
           in `src/plugins/backlog/main/commit-message.ts` (changed signature):
           `export function commitMessage(changes: { before: FollowupItem[]; after: FollowupItem[] }[], imageFolders: readonly string[]): string | null`
Decisions: Backlog alone writes under `followups-images/`; notes never builds a follow-up path or link (plan.md
           § Boundary rules) · `fileNote` is one deep export: Backlog names the folder, writes the images, links them,
           writes the follow-up, and trashes the images when that write fails (plan.md Decisions) · the folder is
           `<UTC yyyyMMdd-HHmmss>-<title slug>`, fixed at the item's first image; an append to an item that already
           links a folder reuses it and numbers on (plan.md Decisions) · images are written through `writeBytes`
           before the text write · delete trashes each image folder the deleted item links, and Commit takes the
           changed images (`docs/features/backlog/design.md` § Follow-ups, § Git) · the clock is the injected
           `services.clock`

## The pure module: `note-images.ts`

- `imageFolderName(now, title)`: the UTC time of `now` as `yyyyMMdd-HHmmss`, then `-` and the title slug. The slug:
  the title in lower case; each run of characters outside `a-z` and `0-9` becomes one `-`; leading and trailing `-`
  go; the first 40 characters stay, then a trailing `-` goes. An empty slug gives the time alone, with no `-` after it.
- `linkedImages(body)`: every match of
  `!\[[^\]]*\]\((?:\.\.\/)*followups-images\/([^/)\s]+)\/(\d+)\.png\)` in body order, as `{ folder, number }`.
- `imageLinkPrefix(followupFile, homeRoot, paths)`: `'../'` once for each folder between the follow-ups file's
  folder and the home root (`paths.segmentsBelow(paths.parent(followupFile), homeRoot)`). `''` for
  `<home>/followups.md`, `'../'` for `<home>/followups/<area>.md`. A file outside the home throws
  `Error('<followupFile> is outside <homeRoot>')`.
- `imageLink(prefix, folder, number)`: `![<number>](<prefix>followups-images/<folder>/<number>.png)`. The link is
  the image's path relative to the follow-ups file's folder, `/`-separated on every OS.
- `noteBody(text, links)`: `text` alone when `links` is empty; else `text`, one blank line, and the links one per
  line.
- `appendedBody(body, addition)`: `addition` when `body` is empty or only white space; else `body` with its trailing
  white space removed, one blank line, and `addition`.

## `fileNote` (in `start.ts`, beside `applyEdit`)

`BacklogDeps` gains `clock: Clock` and `files: Pick<Files, 'list'>`; `backlogMainPart` passes `services.clock` and
`services.files`. The folder listing is a read; every write and trash goes through docs' exports.

1. **Home.** The home is `homeAt(homeRoot)` from the last load. When no load has run yet, `fileNote` runs `load()`
   first.
2. **Checks before any image is written.** Each returns its result and writes nothing:
   - `create` on a home that is not its repo's create target: `{ type: 'refused', reason: '<root> is not <repo>'s
     create target' }`, the text `applyEdit` gives.
   - `append` with a `path` that is not one of the home's `followupFiles` (`paths.samePath`): `{ type: 'refused',
     reason: '<path> is not a follow-up file of <root>' }`.
   - `append` whose item is not in the file (read with `readDoc`, parsed with `parseFollowups`, matched by exact
     title): `{ type: 'missing', title }`.
3. **Folder and numbers.** With no images, skip to step 5 with no links.
   - `create`, or `append` to an item whose body links no image: a new folder, `imageFolderName(clock.now(),
     target.title)`. When `<home>/followups-images/<name>` already lists entries (`files.list`), add `-2`, then
     `-3`, until the name lists none. Numbers start at 1.
   - `append` to an item whose body links an image: the folder of its first `linkedImages` entry. Numbers start one
     above the highest of that folder's linked numbers and of the `<n>.png` files `files.list` finds in it, so no
     image on disk is overwritten.
4. **Images.** Write each image in order with `docs.writeBytes(<home>/followups-images/<folder>/<n>.png, bytes)`.
   When a write rejects, trash what this call wrote (step 6) and return
   `{ type: 'refused', reason: <the rejection's errorText> }`.
5. **Text.** The links are `imageLink(imageLinkPrefix(file, home.root, paths), folder, n)` for each written image,
   `file` being the follow-ups file the text goes to.
   - `create`: `applyEdit(home.root, null, { type: 'create', draft: { title, oneLine, tags, body: noteBody(text,
     links) } })`, so the text lands in `<root>/followups.md` (created when missing) as any create does.
   - `append`: `writeFollowupEdit` on `target.path` with `{ type: 'edit', title, draft: { title: item.title,
     oneLine: item.oneLine, tags: item.tags, body: appendedBody(item.body, noteBody(text, links)) } }` and
     `newFileRepo` null. The body comes from the step 2 read; a `changedOnDisk` retry re-applies that same draft, so
     a hand edit to that one item's body in the same instant is lost. The draft keeps the user's note, which is the
     side that matters here.
6. **Trash on failure.** When the text write throws or returns any result but `applied`, trash what step 4 wrote:
   a new folder with one `docs.trashDoc(<home>/followups-images/<folder>)`; a reused folder with one `trashDoc` per
   written file. A trash that rejects logs `[backlog] <path>: <reason>` and the result stays as it was. A throw then
   returns `{ type: 'refused', reason: <its errorText> }`; any other result passes through.
7. **Redraw.** On `applied`, send `changed` with `{ homeRoot: home.root }`, so Backlog mode shows the note.

## Delete trashes the item's images

`applyEdit` with `edit.type === 'delete'` (Backlog task 09's `d` sends `{ type: 'delete', title }` with the item's
file path):

- Before the write, read the file and take the deleted item's `linkedImages`. Resolve each folder against the file's
  folder and keep it only when it is inside `<home>/followups-images/`. A hand-written link elsewhere stays.
- Drop each folder that another item in the same file still links.
- After `writeFollowupEdit` returns `applied`, `docs.trashDoc` each kept folder once. A trash that rejects logs
  `[backlog] <path>: <reason>`; the result stays `applied`. Any other result trashes nothing.

## Commit takes the changed images

- The images pathspec is the home's path relative to `gitRoot`, then `/followups-images`; `followups-images` when
  the home is the clone's top folder.
- `isUncommitted` is also true when `git.changedPaths(gitRoot, <home scope>)` lists a path under the images
  pathspec.
- `commit` calls `git.changedPaths(gitRoot, <images pathspec>)` once. Every path it lists joins the
  `commitPaths` paths, after the changed follow-up files. A trashed image lists as changed (git status names a
  deleted tracked file), so `git add -- <path>` stages its removal.
- The image folder names are the unique second-to-last segments of those paths, sorted. `commitMessage` takes them
  as `imageFolders` and adds the part `images <folder>, <folder>` last. It returns null only when no item changed and
  `imageFolders` is empty. Every existing `commitMessage` call and test passes `[]`.

## Exports

`exports: BacklogMainExports = { load, tags, fileNote }`, `tags` returning `api.settings().tags`. `load` is the same function the channel's `load` handler runs
(the machine index read, the homes, the watches).

## Examples (exact values for the tests)

Shared values: clock `1793109789000` (2026-10-27T14:03:09Z) · home root `/Users/u/dev/r/docs/features`, `gitRoot`
`/Users/u/dev/r`, repo `r`, the create target · title `Fix the chip's colour!` · folder
`20261027-140309-fix-the-chip-s-colour`, written `F` below.

GIVEN clock `1793109789000` and title `Fix the chip's colour!` WHEN `imageFolderName` runs THEN it returns
`20261027-140309-fix-the-chip-s-colour`.
GIVEN title `!!!` WHEN `imageFolderName` runs THEN it returns `20261027-140309`.
GIVEN a title of 60 `a` characters WHEN `imageFolderName` runs THEN the slug is 40 `a` characters.
GIVEN body `See ![1](followups-images/F/1.png) and ![2](../followups-images/F/2.png).` WHEN `linkedImages` runs THEN
it returns `[{ folder: 'F', number: 1 }, { folder: 'F', number: 2 }]`.
GIVEN `/Users/u/dev/r/docs/features/followups/ui.md` and the home root WHEN `imageLinkPrefix` runs THEN it returns
`'../'`; for `/Users/u/dev/r/docs/features/followups.md` it returns `''`.
GIVEN `imageLink('', 'F', 2)` THEN it returns `![2](followups-images/F/2.png)`.
GIVEN a `create` target with oneLine `The chip is grey`, tags `['agent-ready']`, text `The chip is grey.` and two
images WHEN `fileNote` runs THEN `writeBytes` is called for `/Users/u/dev/r/docs/features/followups-images/F/1.png`
then `…/F/2.png`, both before `writeDoc`; the created item's body is
`The chip is grey.\n\n![1](followups-images/F/1.png)\n![2](followups-images/F/2.png)`; the result is `applied`; and
`changed` is sent with that home root.
GIVEN an item whose body is `Old.\n\n![1](followups-images/20261020-090000-old/1.png)` and a folder listing of
`1.png`, `2.png` WHEN `fileNote` appends text `More.` with one image THEN the image goes to
`…/followups-images/20261020-090000-old/3.png` and the body becomes
`Old.\n\n![1](followups-images/20261020-090000-old/1.png)\n\nMore.\n\n![3](followups-images/20261020-090000-old/3.png)`.
GIVEN a `create` with one image and a `writeDoc` that rejects `Refused: x` WHEN `fileNote` runs THEN `trashDoc` is
called once with `/Users/u/dev/r/docs/features/followups-images/F` and the result is `{ type: 'refused', reason:
'Refused: x' }`.
GIVEN an append to the reused folder above whose text write returns `refused` WHEN `fileNote` runs THEN `trashDoc` is
called with `…/20261020-090000-old/3.png` only.
GIVEN a second `writeBytes` that rejects `Refused: y` WHEN `fileNote` runs with two images THEN `writeDoc` is never
called, `trashDoc` is called with the new folder, and the result is `{ type: 'refused', reason: 'Refused: y' }`.
GIVEN an `append` whose title is not in the file WHEN `fileNote` runs THEN it returns `{ type: 'missing', title }` and
`writeBytes` is never called.
GIVEN a `create` on a home that is not the create target WHEN `fileNote` runs THEN it returns `refused` and
`writeBytes` is never called.
GIVEN a file with item A linking `followups-images/F/1.png` and item B linking nothing WHEN `applyEdit` deletes A THEN
`trashDoc` is called once with `/Users/u/dev/r/docs/features/followups-images/F` after the write.
GIVEN items A and B both linking folder `F` WHEN `applyEdit` deletes A THEN `trashDoc` is never called.
GIVEN a delete whose write returns `refused` WHEN `applyEdit` runs THEN `trashDoc` is never called.
GIVEN HEAD without item `Fix the chip's colour!`, the disk with it, and `changedPaths(gitRoot,
'docs/features/followups-images')` returning `['docs/features/followups-images/F/1.png']` WHEN `commit` runs THEN
`commitPaths` gets `['docs/features/followups.md', 'docs/features/followups-images/F/1.png']` and the message
`Follow-ups edited in Backlog: added Fix the chip's colour!; images 20261027-140309-fix-the-chip-s-colour`.
GIVEN no item change and one image folder `F` WHEN `commitMessage([], ['F'])` runs THEN it returns
`Follow-ups edited in Backlog: images F`; `commitMessage([], [])` returns null.

Tests:     `note-images.test.ts`: `imageFolderName_Title_UtcStampAndSlug` · `imageFolderName_NoSlug_StampOnly` ·
           `imageFolderName_LongTitle_SlugCutTo40` · `linkedImages_BothPrefixes_InBodyOrder` ·
           `imageLinkPrefix_AreaFile_OneLevelUp` · `imageLink_Number_RelativeLink` · `noteBody_NoLinks_TextOnly` ·
           `appendedBody_EmptyBody_AdditionOnly` · `start.test.ts` over a fake docs export (recording `readDoc`,
           `writeDoc`, `writeBytes`, `trashDoc` calls in one ordered list), a fake `Git`, memory files for `list`
           and a fixed clock: `fileNote_Create_WritesImagesThenLinkedBody` · `fileNote_Append_ReusesFolderNumbersOn` ·
           `fileNote_TextRefused_TrashesNewFolder` · `fileNote_TextRefusedOnReuse_TrashesWrittenFilesOnly` ·
           `fileNote_ImageWriteRejects_TrashesAndSkipsText` · `fileNote_AppendMissingItem_WritesNothing` ·
           `fileNote_CreateOnNonTargetHome_WritesNothing` · `delete_ItemWithImages_TrashesFolderAfterWrite` ·
           `delete_FolderStillLinked_KeepsFolder` · `delete_WriteRefused_TrashesNothing` ·
           `commit_ChangedImages_CommitsThemWithFollowups` · `commit-message.test.ts`:
           `commitMessage_ImagesOnly_ImagesPart` · `commitMessage_NothingChanged_Null`. Every file text, entry and
           image byte array is built in the test.
Done when: compiles; `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the
           existing `commit-message.test.ts`.
Commit:    one commit for the group

## Proof

