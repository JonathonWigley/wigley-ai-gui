# 01 — Files: modified and readStart

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/files.ts` · modify `src/main/files/node-files.ts` · modify `src/shared/memory-files.ts` ·
           modify `src/shared/scoped-files.ts` · modify `src/shared/layouts/layout-registry.test.ts` (its two `Files`
           wrappers; `src/plugins/forms/main/layouts/layout-registry.test.ts` if plan A task 02 left it there) ·
           test `src/main/files/node-files.test.ts` · test `src/shared/scoped-files.test.ts` ·
           create test `src/shared/memory-files.test.ts`
Consumes:  in the tree: `Files`, `FileEntry` (`src/contracts/files.ts`), `Clock` (`src/contracts/ambient.ts`),
           `createNodeFiles()` (`src/main/files/node-files.ts`), `createMemoryFiles()` / `MemoryFiles`
           (`src/shared/memory-files.ts`), `scopedFiles(files, root)` (`src/shared/scoped-files.ts`)
Produces:  in `src/contracts/files.ts`, on `Files`, with these comments:
           ```ts
           // Epoch milliseconds of the file's last change. Rejects when the file is missing, naming the path.
           modified(path: string): Promise<number>;
           // The file's first `maxBytes` bytes as UTF-8, a character the cut splits left out; the whole file when
           // shorter. Rejects when the file is missing, naming the path.
           readStart(path: string, maxBytes: number): Promise<string>;
           ```
           `export function createMemoryFiles(clock?: Clock): MemoryFiles` in `src/shared/memory-files.ts`
           `modified` and `readStart` on the objects `createNodeFiles()` and `scopedFiles(files, root)` return
Decisions: the Claude adapter lists transcripts of megabytes (2.5–3.5 MB each, measured at plan time, re-verify) by
           their first lines and modified time, so `Files` gains a bounded read and a modified time rather than the
           adapter reading whole files or importing `node:fs` (plan.md, Locality decision) ·
           `modified` is a member of its own, not a `FileEntry` field, so `list` callers (layouts) pay no stat ·
           node: `modified` is `Math.trunc((await stat(path)).mtimeMs)`; `readStart` opens the file, reads at most
           `maxBytes` bytes from position 0 into one buffer, closes the handle in a `finally`, and decodes the bytes
           read with `new TextDecoder('utf-8').decode(bytes, { stream: true })`, which holds back a cut multi-byte
           character instead of emitting U+FFFD · Node's own `ENOENT` error names the path (as `read` relies on today),
           so neither adds a guard ·
           memory: each `write` stamps the path's modified time with `clock.now()`, `0` with no clock; `remove`
           drops the stamp; `modified` and `readStart` on a missing path reject `no file at <path>` as `read` does;
           `readStart` encodes the text with `TextEncoder`, slices `maxBytes` bytes and decodes as node does ·
           scoped: both members resolve the path through the same `inside` check as `read`, rejecting
           `<path> is outside <root>` before any I/O · the two test wrappers in the layout registry test pass both
           members through to `inner` unchanged
GIVEN a file holding `hello` WHEN `readStart(path, 3)` runs THEN it resolves `hel`
GIVEN a file holding `hello` WHEN `readStart(path, 100)` runs THEN it resolves `hello`
GIVEN a file holding `aé` (bytes `61 c3 a9`) WHEN `readStart(path, 2)` runs THEN it resolves `a`
GIVEN no file at `<dir>/missing.txt` WHEN `readStart` or `modified` runs THEN it rejects with a message containing that path
GIVEN a file whose mtime the test set to `2026-01-02T03:04:05.000Z` with `utimes` WHEN `modified(path)` runs THEN it
      resolves `1767323045000`
GIVEN memory files with a clock at `5000` WHEN a file is written and `modified(path)` runs THEN it resolves `5000`; the
      clock moved to `7000` and the file written again THEN `7000`
GIVEN memory files with no clock WHEN a file is written THEN `modified` resolves `0`
GIVEN memory files WHEN `modified('/nope')` runs THEN it rejects `no file at /nope`
GIVEN `scopedFiles(inner, ROOT)` (the test file's `ROOT`, `/data/plugins/forms`) WHEN `readStart('../x', 4)` or
      `modified('../x')` runs THEN it rejects `../x is outside /data/plugins/forms` before reaching `inner`
GIVEN `scopedFiles(inner, ROOT)` and `<ROOT>/a.txt` holding `abcdef` WHEN `readStart('a.txt', 2)` runs THEN it
      resolves `ab`
Tests:     `src/main/files/node-files.test.ts` (real temp folder, as the file's other tests):
           `readStart_ShorterLimit_ReturnsTheFirstBytes` (`hel`), `readStart_LongerLimit_ReturnsTheWholeFile` (`hello`),
           `readStart_CutInsideACharacter_LeavesItOut` (`a`), `readStart_MissingFile_RejectsNamingThePath`,
           `modified_ReturnsTheMtimeInMilliseconds` (`1767323045000`), `modified_MissingFile_RejectsNamingThePath`
           `src/shared/memory-files.test.ts`: `modified_StampsTheClockAtEachWrite` (`5000` then `7000`),
           `modified_NoClock_IsZero`, `modified_MissingFile_Rejects` (`no file at /nope`),
           `readStart_CutInsideACharacter_LeavesItOut` (`a`)
           `src/shared/scoped-files.test.ts`: `readStart_ParentEscape_RejectsBeforeReading` (message
           `../x is outside /data/plugins/forms`; an inner `Files` wrapper the test writes records no call), `modified_ParentEscape_RejectsBeforeReading`,
           `readStart_PathInsideRoot_ReadsUnderRoot` (`ab`)
Done when: the typecheck and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof
