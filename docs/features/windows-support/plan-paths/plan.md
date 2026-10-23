# Windows paths — plan

Feature: Windows support · Implements: none · Ticket: none
Target: main · Written: 2026-10-22

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Docs, chat and every other path user work on Windows as well as macOS. A Windows audit found the docs plugin
rejects every `C:\` path (`A path starts with / or ~`, so every docs self-test step fails), chat shows a Windows
folder as its whole path, and 30 unit tests fail on Windows. Every full path the app joins, splits, compares or
shows goes through one `Paths` service with a POSIX and a Windows adapter, picked in each composition root, so no
feature carries a `process.platform` check. The suite and the self-test pass on Windows.

## Architecture

```
src/contracts/paths.ts          Paths            ← the seam; imports nothing
src/shared/paths/               posixPaths, windowsPaths   ← the two adapters, pure TS, both processes
src/main/main.ts                picks by the OS main runs on → MainServices.paths
src/renderer/renderer.ts        picks by the served `platform` → PageServices.paths
         │
         ├─ docs (main + page + shared pure modules)   ← every path call
         ├─ chat (folder names, recent folders)
         ├─ forms (round ownership)
         ├─ claude-code adapter (transcript folder, cwd compare, `~/` expansion)
         └─ scoped-files, main-api (plugin data folders), drive-run
```

Systems touched: contracts, shared, main composition root, page composition root, claude-code adapter, the docs,
chat, forms and sessions plugins, their tests, the self-test exit path.

## Preconditions

`wigley:make` re-runs each before the first dispatch.

| Claim | Command | Measured at plan time |
|---|---|---|
| Target tip holds the lint/self-test fixes and the docs written ahead | `git log --oneline -2` | `eeaf4bb` docs ahead, `a818855` lint and self-test |
| Lint passes on Windows | `npm run lint` | passes |
| Typecheck passes | `npm run typecheck` | passes |
| The suite's Windows failures, the ones task 06 and the path work fix | `npx vitest run` | 30 failed in 5 files: `relay-server.test.ts` 15, `node-files.test.ts` 7, `past-sessions.test.ts` 4, `claude-code-harness.test.ts` 1, `login-shell-path.test.ts` 3 (measured at plan time, re-verify) |
| The docs index emits native Windows paths | `PYTHONIOENCODING=utf-8 python3 docs_index.py context 'C:\_root\dev\wigley-ai-gui'` in wigley-ai-marketplace `plugins/wigley/scripts/docs-index/` | `"path": "C:\\Users\\jonat\\.claude\\CLAUDE.md"` |
| The docs index crashes on a cp1252 stdout without UTF-8 mode | the same command without `PYTHONIOENCODING` | `UnicodeEncodeError: 'charmap' codec can't encode character '\u2192'` |
| The self-test hangs on Windows after its last step | `npm run selftest` | prints `[selftest] 60 failed`, then never exits |

## Docs written ahead

Commit `eeaf4bb`, and the **A path** bullet's main-side `node:path` wording in the commit that adds this plan:

- `AGENTS.md` — § Architecture: the `paths/` line in the layer tree, and the **A path** bullet after **An ambient
  service**.
- `docs/keymap.md` — the **Cmd** bullet: `D-` is the Win key on Windows.
- `docs/features/followups.md` — § Platform: the path-module and primary-modifier entries removed, the `Platform`
  record entry trimmed; the `npm run selftest` on Windows entry removed.

## Mandatory Reads

- `C:\_root\dev\AGENTS.md` (workspace rules: no downloads, no browsers)
- `AGENTS.md` (repo root), in full: § Architecture, § Running and testing
- `DESIGN.md` § Tokens and themes only if a task touches CSS (none plans to)
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in the repo (`git ls-files '*CLAUDE*' '.claude/rules/*'` is empty).

## Design Overview

```
            ┌──────────────────────────┐
            │ src/contracts/paths.ts   │  Paths
            └────────────▲─────────────┘
          ┌──────────────┴──────────────┐
  ┌───────┴────────┐           ┌────────┴────────┐
  │ posixPaths     │           │ windowsPaths    │   src/shared/paths/
  └───────▲────────┘           └────────▲────────┘
          └──────────────┬──────────────┘
     main.ts (OS it runs on)   renderer.ts (served platform)     ← the only places that pick
                         │
          api.services.paths in every plugin, both processes;
          shared pure modules (docs' tree, links, kinds, path guard, path completion)
          take `paths: Paths` as a parameter
```

Decisions (round numbers are the interview's):

- Scope: the 3 audit problems, every module that assumes POSIX paths, and the Windows test failures. The rest of
  followups § Platform stays there (round 1).
- Seam: a `Paths` contract, POSIX and Windows adapters in `src/shared/paths/`, each composition root picks one,
  plugins reach it as `services.paths` (round 1).
- Windows display: native backslashes, home as `~` (`~\.claude\CLAUDE.md`, `C:\_root\dev`) (round 1).
- Windows rules: either separator accepted on input, `\` in output, case-folded compares, drive (`C:\`) and UNC
  (`\\server\share\`) roots; `C:foo` and `\foo` are not absolute (Decided, round 1).
- Keys: no primary modifier. `D-` stays Cmd on macOS and Win on Windows; Win+W and Ctrl+Alt+Win+W stay the Windows
  defaults (rounds 1, 2). No key code changes; the Win chords are hand checks.
- The docs index runs as `python3 -X utf8 <script> …` on every OS (Decided, round 1).
- `homeDir` stays a parameter of `tilde` and `expandTilde`, not bound into the adapter: the page learns the home
  over docs' channel after it starts, and the self-test and drive runs use a temp home (design review).
- One `Paths` for scoped plugin-data paths too: a path relative to a scoped `Files` stays `/`-separated on every OS,
  and only the join onto the root goes through `paths.join` (design review, locality).
- The claude-code adapter takes `paths` in its deps rather than importing `node:path`, so its transcript lookups are
  testable against the in-memory files fake on any OS, and its `cwd` compare is `samePath` (design review, seam).
- Tests: one shared case table runs against both adapters, plus Windows-only cases; existing docs and chat tests
  pass `posixPaths` and gain Windows cases where a path is shown or compared (design review, leverage).
- Self-test exit: `app.exit` runs even when cleanup throws, and the temp home removal retries Windows' busy handles
  (Decided).
- Main-side `node:path` joins and base names stay (forms' service and round store, chat's and sessions' main parts):
  `node:path` already follows the OS main runs on. The page code, the shared modules both processes use, and every
  path compare move to `Paths`; the `AGENTS.md` **A path** bullet says so (cold read, Decided).
- A bare `~` now expands to the home folder wherever a setting or profile takes `~/` (cold read, Decided).

Out of scope (stays in `docs/features/followups.md` § Platform): the `Platform` record and the other
`process.platform` reads, program lookup and `.cmd` spawning, async round store, chord matching per layout, the
relay contract test, packaging. `src/plugins/sessions/main/relay/endpoint.ts` keeps `path.posix` for Unix socket
paths, which exist only on POSIX.

## File Structure

New:

- `src/contracts/paths.ts` — the `Paths` interface below.
- `src/shared/paths/posix-paths.ts` — `export const posixPaths: Paths`.
- `src/shared/paths/windows-paths.ts` — `export const windowsPaths: Paths`.
- `src/shared/paths/paths.test.ts` — the shared case table against both adapters, plus each adapter's own cases.

Removed: `src/plugins/docs/doc-paths.ts` and its test, `src/shared/expand-home.ts` and its test (their cases move
into `paths.test.ts`).

Boundary rules: `scripts/check-layers.mts` gets a `src/shared/paths` entry (`layers: ['src/contracts']`, no
packages), and task 01 alone lists it in every layer whose code or tests import an adapter (task 01 names them), so
no later task edits the file. Only `main.ts`, `renderer.ts` and tests import an adapter; everything else imports
`src/contracts/paths.ts` and receives the adapter.

The contract, verbatim in intent (comment wording is the implementer's, to `wigley:writing-code`):

```ts
// Full paths by the rules of the OS the app runs on. A path the caller passes
// may use either separator on Windows; every path returned is normalized:
// '.' and repeated or trailing separators folded, '..' folded and never
// climbing above the root, the OS's separator written.
export interface Paths {
  // '/' or '\'.
  readonly separator: string;
  // POSIX: starts with '/'. Windows: a drive root ('C:\', 'c:/') or a UNC
  // root ('\\server\share'); 'C:foo' and '\foo' are not absolute.
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
  // `folder` with each segment appended; a segment may itself hold
  // separators, so a link's relative path joins as one segment.
  join(folder: string, ...segments: string[]): string;
  // The folder holding `path`; a root is its own parent.
  parent(path: string): string;
  // The last segment; '' for a root.
  base(path: string): string;
  // The same path once normalized; case-insensitive on Windows.
  samePath(a: string, b: string): boolean;
  // True when `path` is `folder` or lies below it, compared as samePath does.
  isInside(path: string, folder: string): boolean;
  // The segments of `path` below `folder` ([] for `folder` itself), or null
  // when `path` is not inside it.
  segmentsBelow(path: string, folder: string): string[] | null;
  // The deepest folder holding every path's parent, compared by whole
  // segments; null when they share no root (two Windows drives). Throws on an
  // empty list.
  commonFolder(paths: readonly string[]): string | null;
  // `homeDir` → '~'; below it → '~' + separator + the rest; any other path
  // normalized.
  tilde(path: string, homeDir: string): string;
  // '~' → `homeDir`; '~/x' (and '~\x' on Windows) → `homeDir` joined with
  // 'x'; any other text unchanged, '~user/x' included.
  expandTilde(text: string, homeDir: string): string;
}
```

Shared signatures parts use:

- `MainServices.paths: Paths` and `PageServices.paths: Paths` in `src/contracts/plugin.ts`.
- `scopedFiles(files: Files, root: string, paths: Paths): Files` and
  `relativeSegments(path: string): string[] | null` (in place of `resolveInside`) in `src/shared/scoped-files.ts`.
- `dataFilePath(url: string, dataRoot: string, paths: Paths): string | null` in `src/shared/data-url.ts`.
- `ClaudeCodeHarnessDeps.paths: Paths` in `src/main/claude-code/claude-code-harness.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Paths contract and adapters](01-paths-contract.md)
- [ ] [Windows-only test and self-test fixes](06-windows-test-fixes.md)

### Wave 2
- [ ] [Paths as a service in both processes](02-paths-service.md) — after 01, 06

### Wave 3
- [ ] [Claude Code adapter paths](03-claude-code-paths.md) — after 02
- [ ] [Docs plugin on Paths](04-docs-paths.md) — after 02
- [ ] [Chat and forms on Paths](05-chat-forms-sessions-paths.md) — after 02

### Wave 4
- [ ] [Doc re-read](07-doc-re-read.md) — after 03, 04, 05
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
