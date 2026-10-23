# 05 — Files reads bytes; layout copy copies every file through bytes

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/files.ts` · modify `src/main/files/node-files.ts` · modify `src/shared/memory-files.ts` ·
           modify `src/shared/scoped-files.ts` · modify `src/shared/layouts/layout-registry.ts` ·
           test `src/shared/layouts/layout-registry.test.ts` · test `src/main/files/node-files.test.ts` ·
           test `src/shared/scoped-files.test.ts` · test `src/shared/memory-files.test.ts`
Consumes:  `Files.writeBytes(path: string, bytes: Uint8Array): Promise<void>` (in the tree)
Produces:  `readBytes(path: string): Promise<Uint8Array>;` on `interface Files` in `src/contracts/files.ts`
           `readBytes:` in the object `createNodeFiles` returns, in `src/main/files/node-files.ts`
           `bytesOf(path: string): Uint8Array;` on `interface MemoryFiles` in `src/shared/memory-files.ts`
           `readBytes:` in the object `scopedFiles` returns, in `src/shared/scoped-files.ts`
Decisions: the method is `readBytes` beside `writeBytes`; `MemoryFiles`' sync helper of that name becomes `bytesOf`;
           layout copy copies every file through bytes, with no extension check (plan.md, Decisions)

## The contract

- `Files.readBytes(path)` sits directly after `writeBytes` in `src/contracts/files.ts`, with the comment
  `// \`read\` for bytes: the file's bytes exactly as stored. Rejects when the file is missing, naming the path.`
- The interface's doc comment (`// UTF-8 text files, read whole or by their first bytes and written whole, // binary
  files written whole, and the folders that hold them.`) becomes: UTF-8 text files read whole or by their first bytes,
  any file read or written whole as bytes, and the folders that hold them.

## The adapters

- **Node** (`createNodeFiles`): `readBytes: (file) => readFile(file)` — `readFile` with no encoding resolves to a
  `Buffer`, which is a `Uint8Array`; it rejects with Node's `ENOENT` error naming the path, as `read` does.
- **Memory** (`createMemoryFiles`): the `MemoryFiles` member `readBytes(path): Uint8Array` is renamed `bytesOf`, its
  comment and body unchanged (the stored bytes as a copy, or the stored text encoded as UTF-8; throws as
  `isMissingFile` tells when missing). The new async `readBytes: async (path) => …` returns the same value the
  `bytesOf` body computes, so a missing file rejects instead of throwing; share the body (a local `bytesOf` const
  both members use, in the shape of `textOf`), not two copies. The returned bytes are a copy, so a caller may change
  them without changing the stored file.
- **Scoped** (`scopedFiles`): `readBytes: async (path) => files.readBytes(inside(path))`, placed after `readStart`.
  Its doc comment's list of methods that reject an outside path adds `readBytes` after `readStart`.
- Every caller of the old sync helper moves to `bytesOf`. At plan time the only one is
  `src/shared/memory-files.test.ts:31` (`writeBytes_BinaryBytes_HoldsTheSameBytes`); `git grep -n "readBytes"` after
  the change lists only the contract, the three adapters, `src/shared/layouts/layout-registry.ts` (its copy) and tests calling
  the async method.
- Test doubles that spread `createMemoryFiles()` inherit `readBytes`; `npm run typecheck` finds any object literal
  typed `Files` that does not.

## Layout copy

`startLayoutRegistry`'s `copy`, for a user layout, now copies each listed file with
`data.readBytes(\`${source}/${entry.path}\`)` and writes it through `writeOwn`. `writeOwn(relative, content)` takes
`content: string | Uint8Array` and writes with `data.write` for a string and `data.writeBytes` for bytes; its own-write
marking (marked before the write, the forget timer started once it settles) is unchanged, so every copied file is
still its own write. The default layout's copy still writes `deps.defaultLayout` as text.

GIVEN a user layout holding a file whose bytes are not valid UTF-8 WHEN `copy` runs THEN the copy holds the same bytes
GIVEN a scoped `Files` WHEN `readBytes` gets a path outside its root THEN it rejects `<path> is outside <root>` before
any read
GIVEN a file on disk WHEN node `readBytes` reads it THEN it resolves to the file's bytes

Tests (each file's existing `Name_Case_Result` style):

- `layout-registry.test.ts`, `describe('copy')`: `copy_UserLayoutWithBinaryFile_CopiesTheSameBytes` — seed
  `layouts/alpha/layout.js` (`'// js'`), `files.writeBytes('layouts/alpha/art.png', new Uint8Array([0x89, 0x50, 0xff,
  0xfe, 0x00]))` and `layouts/active` = `alpha`; after `registry.copy()`,
  `[...files.bytesOf('layouts/alpha-2/art.png')]` equals `[0x89, 0x50, 0xff, 0xfe, 0x00]`. A UTF-8 round trip turns
  `0xff` and `0xfe` into U+FFFD, so the old copy fails it. The existing copy tests
  (`copy_LateWatchReportsForCopiedFiles_SendNothing` and the two timing tests) keep passing unchanged, pinning that
  copied files stay own writes.
- `node-files.test.ts`: `readBytes_BinaryFile_ReturnsTheSameBytes` — write `[0, 255, 137]` with
  `writeFileSync` to a file under the test's temp `root`; `[...await files.readBytes(file)]` equals `[0, 255, 137]`.
  `readBytes_MissingFile_IsMissingFile` — `readBytes` of an absent path rejects with an error `isMissingFile` accepts,
  in the shape of `read_MissingFile_IsMissingFile`.
- `scoped-files.test.ts`: `readBytes_ParentEscape_RejectsBeforeReading` — through `recordingCalls`, as
  `readStart_ParentEscape_RejectsBeforeReading` does: `scopedFiles(recorded, ROOT, posixPaths).readBytes('../x.png')`
  rejects `../x.png is outside ${ROOT}` and `calls` stays `[]`. `recordingCalls` (bottom of the file) records
  `readStart` and `modified` only today; it gains a `readBytes` that pushes the path and forwards to `inner`, so the
  test can fail.
- `memory-files.test.ts`: `writeBytes_BinaryBytes_HoldsTheSameBytes` reads through `bytesOf`;
  add `readBytes_MissingFile_RejectsAsMissingFile` — `files.readBytes('/h/none.png')` rejects with an error
  `isMissingFile` accepts (the sync helper threw; the contract method must reject).

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

