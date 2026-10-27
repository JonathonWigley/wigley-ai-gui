# 03 — Docs binary write and trash exports

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/contract.ts` · modify `src/plugins/docs/main/doc-files.ts` · modify
           `src/plugins/docs/main/start.ts` · test `src/plugins/docs/main/doc-files.test.ts` · test
           `src/plugins/docs/path-guard.test.ts`
Consumes:  `Files.writeBytes(path: string, bytes: Uint8Array): Promise<void>` in `src/contracts/files.ts` (in the
           tree: atomic through the same temp file as `write`, parent folders made first) ·
           `DocFiles.write`, `DocFiles.trash` and the private `writeTarget` in `src/plugins/docs/main/doc-files.ts`
           (in the tree) · `changeRefusal` in `src/plugins/docs/path-guard.ts` (in the tree) · `WriteResult`,
           `TrashResult` in `src/plugins/docs/contract.ts` (in the tree)
Produces:  in `src/plugins/docs/contract.ts`, `DocsMainExports`:
           `writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>; // the write guard writeDoc uses; no changed-on-disk check`
           `trashDoc(path: string): Promise<TrashResult>;                      // the channel's guarded trashDoc`
           in `src/plugins/docs/main/doc-files.ts`, `DocFiles`:
           `writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>;`
Decisions: images pass the same write guard as text (design.md § Seams, Docs) · `writeBytes` and `trashDoc` are
           main exports only: no channel method, since the page never writes bytes · no change to `Files`: it already
           holds an atomic `writeBytes`

## What each change does

- `DocFiles.writeBytes(path, bytes)` takes the same route as `DocFiles.write` with `expectedText` null:
  `absolute(path)`, then `writeTarget` (the dangling-link refusal, the real target, `changeRefusal`), then
  `files.writeBytes(target, bytes)`. It resolves to `{ type: 'written' }`. A refusal rejects with the refusal text,
  as `write` does. Its doc comment in the `DocFiles` interface says it is `write` for bytes, with no changed-on-disk
  check.
- `start.ts`: add `const writeBytes = async (path, bytes) => (await docs).docFiles.writeBytes(path, bytes)` and
  `const trashDoc = async (path) => (await docs).docFiles.trash(path)` beside `readDoc` and `writeDoc`. The
  `trashDoc` channel handler uses the same `trashDoc` const. `exports` gains `writeBytes` and `trashDoc`.
- `contract.ts`: the comment above `DocsMainExports` already says each export runs the same code as the channel
  method of its name. Write `writeBytes`'s comment as "Guarded as `writeDoc`, with no changed-on-disk check" and
  `trashDoc`'s as "The channel's `trashDoc`".

## The guard for an image file

Measured in this run: `changeRefusal` allows a target that is inside a `features` entry's `root`
(`isEntryOrInsideRoot`), and a `features` entry's `root` is the features home folder (`IndexEntry.root`: "The clone,
feature home or plugin install folder"). So `<home>/followups-images/<folder>/<n>.png` is allowed whenever a loaded
index source holds a `features` entry whose `root` is `<home>`, as the home's own follow-ups file is. No guard change
is needed. `realTarget` resolves the nearest existing ancestor and joins the missing segments, so a write into a
`followups-images/<folder>/` that does not exist yet passes the guard, and `Files.writeBytes` makes the folders.

A `trashDoc` of `<home>/followups-images/<folder>` (a folder, no link) has one trash target, the folder itself. It
is inside the home's root, so the guard allows it, and `Files.trash` moves the whole folder.

GIVEN entries holding a `features` entry with root `/Users/u/wigley-features/r` WHEN `changeRefusal` judges
`/Users/u/wigley-features/r/followups-images/20261027-140309-fix-chip/1.png` THEN it returns null.
GIVEN that entry and an empty memory file system WHEN `writeBytes` writes bytes `[1, 2, 3]` to
`/Users/u/wigley-features/r/followups-images/20261027-140309-fix-chip/1.png` THEN it resolves to
`{ type: 'written' }` and the memory files hold bytes `[1, 2, 3]` at that path.
GIVEN the default test entries WHEN `writeBytes` writes to `/Users/u/elsewhere/1.png` THEN it rejects with
`Refused: /Users/u/elsewhere/1.png is outside the indexed folders` and writes nothing.
GIVEN that `features` entry and a file at `…/followups-images/20261027-140309-fix-chip/1.png` WHEN `trash` runs on
`/Users/u/wigley-features/r/followups-images/20261027-140309-fix-chip` THEN it resolves to
`{ trashed: ['/Users/u/wigley-features/r/followups-images/20261027-140309-fix-chip'], error: null }` and the file
is gone.

Tests:     `path-guard.test.ts`: `changeRefusal_ImageInsideFeaturesRoot_Allowed` · `doc-files.test.ts`:
           `writeBytes_InsideFeaturesRoot_WritesBytesAndFolders` · `writeBytes_Outside_RejectsNamingPath` ·
           `trash_ImageFolderInsideFeaturesRoot_TrashesFolder`. Each builds its `features` entry with the file's
           `entry(...)` helper (`source: 'features'`, `root` the home). The export wiring in `start.ts` is two
           one-line consts the compiler checks against `DocsMainExports`; it earns no test.
Done when: compiles; `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit c39ba2b · proof: diff read: writeBytes and trashDoc in DocsMainExports and start.ts exports, DocFiles.writeBytes takes the write guard; typecheck clean except the backlog start.test.ts fake, fixed by the Backlog lead stub commit · concerns: task 03 Files missed src/plugins/backlog/main/start.test.ts, whose DocsMainExports fake needed the two members; the Backlog lead added the stubs by agreement
