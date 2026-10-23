# 01 — Paths contract and its POSIX and Windows adapters

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/paths.ts` · create `src/shared/paths/posix-paths.ts` · create `src/shared/paths/windows-paths.ts` · test `src/shared/paths/paths.test.ts` · modify `scripts/check-layers.mts`
Consumes:  none
Produces:  `export interface Paths` in `src/contracts/paths.ts`, with the members plan.md § File Structure gives, word for word
           `export const posixPaths: Paths` in `src/shared/paths/posix-paths.ts`
           `export const windowsPaths: Paths` in `src/shared/paths/windows-paths.ts`
           a `'src/shared/paths'` entry in `LAYERS` in `scripts/check-layers.mts`, and `'src/shared/paths'` in the `layers` of each entry the Approach names
Decisions: the seam is a contract with two adapters picked in each composition root (round 1) · Windows shows `\`, accepts `/` and `\`, case-folds compares, takes drive and UNC roots, and does not count `C:foo` or `\foo` as absolute (round 1, Decided) · `homeDir` is a parameter, not bound into the adapter (design review) · both adapters are pure TS with no `node:` import, since the page uses them too

## Behaviour

- `posixPaths` keeps the behaviour of today's `src/plugins/docs/doc-paths.ts` and `src/shared/expand-home.ts`: read
  both, and both test files, before writing it. Every case in `doc-paths.test.ts` and `expand-home.test.ts` moves
  into the shared table or the POSIX cases of `paths.test.ts`, so deleting those files later (tasks 03 and 04)
  loses no case.
- `windowsPaths`:
  - Reads `/` and `\` as separators and writes `\`.
  - Roots: a drive root (`C:\`, written `C:\` whatever case the letter had in input is kept as given) and a UNC
    root (`\\server\share`, normalized to `\\server\share\` when it is the whole path, and keeping `server\share`
    as the root that `..` never climbs above).
  - `samePath` and `isInside` fold case (ASCII and Unicode, through `toLowerCase`) after normalizing.
  - `tilde` matches `homeDir` as `samePath` does, and keeps the case of the rest of `path` as given.
- `commonFolder` returns null only when the paths have different roots; on POSIX it always has `/` at least.
- `expandTilde('~', home)` returns `normalize(home)`, and `'~/x'` joins with `join`. A bare `~` now expands, where
  `expandHome` left it as `~`: the moved `expand-home.test.ts` case `expandHome_OtherValues_ReturnedAsTheyStand`
  drops `'~'` from its unchanged list and asserts `'~'` → home instead. Tasks 02 and 03 inherit this for the
  `claude.command` setting and the profile folder.
- A path that is not absolute (`a/b`, `../x`, and on Windows `\foo` or `/selftest/chat-selftest`) folds `.` and
  repeated separators, keeps its leading `..` segments and its leading separator, and `base` and `parent` work on
  its segments. `join` appends a segment that starts with a separator as a plain segment; it never resets to a
  root, as `path.win32.resolve` would.

Pinned cases (each is a row in the test; the table runs each shared row against both adapters with its own
expected value):

| Call | POSIX | Windows |
|---|---|---|
| `isAbsolute(p)` | `/a` true · `a/b` false · `~/a` false | `C:\a` true · `c:/a` true · `\\srv\share\a` true · `C:a` false · `\a` false · `a\b` false |
| `normalize(p)` | `/a//b/./c/../d/` → `/a/b/d` · `/..` → `/` | `C:/a//b\.\c\..\d\` → `C:\a\b\d` · `C:\..` → `C:\` · `\\srv\share\a\..\..` → `\\srv\share\` |
| `join(f, …s)` | `('/a', 'b/c', '../d')` → `/a/b/d` | `('C:\a', 'b/c', '..\d')` → `C:\a\b\d` |
| `parent(p)` | `/a/b/c.md` → `/a/b` · `/a` → `/` · `/` → `/` | `C:\a\b\c.md` → `C:\a\b` · `C:\a` → `C:\` · `C:\` → `C:\` |
| `base(p)` | `/a/b/c.md` → `c.md` · `/a/b/` → `b` · `/` → `` | `C:\a\b\c.md` → `c.md` · `C:\` → `` |
| `samePath(a, b)` | `/a/b` `/a/b/` true · `/A` `/a` false | `C:\Users\Jo` `c:/users/jo/` true |
| `isInside(p, f)` | `/a/b` in `/a` true · `/ab` in `/a` false · `/x` in `/` true | `C:\A\b` in `c:\a` true · `C:\ab` in `C:\a` false · `D:\a` in `C:\` false |
| `segmentsBelow(p, f)` | `/a/b/c` below `/a` → `['b','c']` · `/a` below `/a` → `[]` · `/b` below `/a` → null | `C:\a\B\c` below `c:\a` → `['B','c']` |
| `commonFolder(ps)` | `['/a/b/x.md', '/a/c/y.md']` → `/a` · `['/x.md', '/a/y.md']` → `/` | `['C:\a\b\x.md', 'C:\a\c\y.md']` → `C:\a` · `['C:\a\x.md', 'D:\a\y.md']` → null |
| `tilde(p, home)` | `('/Users/jo/.claude/CLAUDE.md', '/Users/jo')` → `~/.claude/CLAUDE.md` · `('/Users/jo', '/Users/jo')` → `~` · `('/Users/joe/x', '/Users/jo')` → `/Users/joe/x` | `('c:\users\jo\.claude\CLAUDE.md', 'C:\Users\jo')` → `~\.claude\CLAUDE.md` · `('C:\_root\dev', 'C:\Users\jo')` → `C:\_root\dev` |
| `expandTilde(t, home)` | `('~/x', '/Users/jo')` → `/Users/jo/x` · `('~', …)` → `/Users/jo` · `('~jo/x', …)` → `~jo/x` · `('x', …)` → `x` | `('~/x', 'C:\Users\jo')` and `('~\x', …)` → `C:\Users\jo\x` |
| `base(p)`, not absolute | `/selftest/chat-selftest` → `chat-selftest` | `/selftest/chat-selftest` → `chat-selftest` |
| `normalize(p)`, not absolute | `a/./b//c/` → `a/b/c` · `../a/../b` → `../b` | `/selftest//x` → `\selftest\x` · `..\a` → `..\a` |
| `join(f, s)`, leading separator | `('/r/docs', '/a/b.md')` → `/r/docs/a/b.md` | `('C:\r\docs', '/a/b.md')` → `C:\r\docs\a\b.md` |
| `separator` | `/` | `\` |

GIVEN `commonFolder([])` WHEN it runs THEN it throws, on both adapters, as `doc-paths.ts` does today.

Tests:     `paths.test.ts` — one `describe.each([['posix', posixPaths, …], ['windows', windowsPaths, …]])` over the shared rows above, each row asserting the value in its adapter's column · POSIX-only and Windows-only `it` cases for the rows with no counterpart · every case moved from `doc-paths.test.ts` and `expand-home.test.ts`, asserting the values those tests assert today

Approach:  `scripts/check-layers.mts` gets `'src/shared/paths': { layers: ['src/contracts'], packages: [] }`, and
           this task alone adds `'src/shared/paths'` to the `layers` of every entry whose code or tests later tasks
           make import an adapter, so no wave-3 task edits the file: `src/main/main.ts`, the renderer's
           composition-root entry, `src/shared`, `src/main/claude-code`, `src/main/drive`, `src/main/plugins`, and
           the plugin entries for `docs` (its shared, `main` and `page` layers), `chat` (`main`, `page`), `forms`
           (`main`) and `sessions` (`main`). The layer check has no test-only allowance, so outside the two roots
           only test files import an adapter, which task review checks.
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs `paths.test.ts`
Commit:    one commit for the group

## Proof

Commit 2e62c84. Proof: diff read — contract member for member as plan.md § File Structure; both adapters built on rootedPaths; LAYERS entry plus 13 listings; typecheck clean; paths.test.ts 84 passed. Concerns: a worker's npx fetched prettier@3.9.10 into the npx cache (hard-gate breach, reported to the user); the shared test table casts its calls, so a mistyped row fails at run time.
