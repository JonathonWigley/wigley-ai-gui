# 15 — README and changelog checks, boundary lint, package metadata

Status: not started
Type: Task
Rung: hard · three checks read the repo's own structure (manifests, tool definitions, git diff), and each must fail on the break it names without failing on the tree as it stands
Wave: 7 · Depends on: 01 (both `auri` manifests), 12 (`agent-plugin/hooks/hooks.json` entries), and every task of waves 2–4 that adds, removes or renames a plugin, tool, setting or skill (02–11, 13), since the coverage test reads the tree they leave
Plan: [plan.md](plan.md)

Mandatory reads for this task: the app's `AGENTS.md` § README, changelog and boundary (written ahead) and § Layers,
`README.md` and `CHANGELOG.md` (written ahead), `scripts/check-styles.mts` with `scripts/style-rules.mts` and
`scripts/style-rules.test.mts` (the pattern the new checks follow: a rules module tested in Vitest, a thin walker
run by `node`), `src/plugins/manifests.ts`, `src/config/settings.ts`.

A = `wigley-ai-gui/agent-plugin`.

Files (ai):
- create `wigley-ai-gui/scripts/changelog-rules.mts` · `wigley-ai-gui/scripts/check-changelog.mts` · test `wigley-ai-gui/scripts/changelog-rules.test.mts`
- create `wigley-ai-gui/scripts/changelog-release.mts` · test `wigley-ai-gui/scripts/changelog-release.test.mts`
- create `wigley-ai-gui/scripts/boundary-rules.mts` · `wigley-ai-gui/scripts/check-boundary.mts` · test `wigley-ai-gui/scripts/boundary-rules.test.mts`
- create test `wigley-ai-gui/scripts/readme-coverage.test.mts`
- modify `wigley-ai-gui/package.json` — scripts, `description`, `author`
- modify `wigley-ai-gui/README.md` · `wigley-ai-gui/AGENTS.md` · `wigley-ai-gui/CHANGELOG.md` — drop the planned markers this task makes true, fix what the checks find
- modify `wigley-agents/WigleyRepos.md` § Landing — the version-heading step for `wigley-ai-gui`

Bookkeeping: none.

## Why

The app becomes shareable, so its README is the setup guide other agents follow and its changelog is how a user of
it sees what changed. Both rot unless a check fails on the gap (plan.md Design Overview round 1). The boundary rule
keeps one user's setup out of the code others run; a grep enforces it where a review would miss it.

## Consumes

- `builtInManifests` from `src/plugins/manifests.ts`: each manifest's `id`, `settings` and `settingInfo`.
- `settingInfo` and `coreDefaultSettings()` from `src/config/settings.ts`.
- `A/.claude-plugin/plugin.json` and `A/.codex-plugin/plugin.json`, each with `version` ← 01.
- `A/hooks/hooks.json`: `hooks.<Event>[].hooks[].command` naming `scripts/<folder>/…` ← 01, 12.
- `A/skills/<name>/SKILL.md` (written ahead, shipped by 01).
- The tool definitions under `src/plugins/**`: object literals typed `ToolDefinition` whose `name` is a
  snake_case string literal (31 names, measured at plan time, re-verify after waves 2–4).

## Produces

npm scripts in `wigley-ai-gui/package.json`, named in `AGENTS.md` and the README:

| Script | Command | Exit |
|---|---|---|
| `lint:changelog` | `node scripts/check-changelog.mts` | 1 with the reasons printed; 0 otherwise, also when `origin/main` is missing (prints `skipped: no origin/main`) |
| `lint:boundary` | `node scripts/check-boundary.mts` | 1 with `path:line: <name>` per hit; 0 otherwise |
| `changelog:release` | `node scripts/changelog-release.mts` | 0 after writing the heading and the three versions; 0 with `nothing to release` when Unreleased holds no entry; 1 on a malformed changelog |
| `lint` | `node scripts/check-layers.mts && node scripts/check-styles.mts && node scripts/check-changelog.mts && node scripts/check-boundary.mts && oxlint && oxfmt --check` | first failure |

Rules modules, pure and tested (shapes; names are the interface, bodies are the worker's):

- `changelog-rules.mts`:
  - `needsEntry(changedPaths: string[]): string[]` — the paths that call for an entry
  - `addedEntryLines(diffOfChangelog: string): string[]` — added `- ` lines under `## Unreleased`
  - `versionMismatch(versions: Record<string, string>): string | null` — a reason naming each file and its version
- `changelog-release.mts` exports `release(changelog: string, version: string, today: string): { changelog: string; version: string } | null`
  — `null` when Unreleased holds no entry; the bump is decided inside from which `###` headings hold entries.
- `boundary-rules.mts`:
  - `BOUNDARY_NAMES: readonly { name: string; pattern: RegExp }[]`
  - `isExempt(path: string): boolean`
  - `boundaryHits(path: string, source: string): { line: number; name: string }[]`

## Decisions

**Changelog lint** (`check-changelog.mts`):

- Changed paths: `git diff --name-only --relative $(git merge-base origin/main HEAD)` run in `wigley-ai-gui/`,
  which covers committed and working-tree changes, plus untracked files from
  `git ls-files --others --exclude-standard`. No `origin/main` ref: print `skipped: no origin/main` and exit 0, so a
  fresh clone and a CI checkout without history still lint.
- `needsEntry` keeps a path unless it is under `docs/`, `.claude/` or `.agents/`, or is a root-level `*.md` (README.md,
  AGENTS.md, DESIGN.md and CHANGELOG.md itself). Everything else,
  `agent-plugin/` included, needs an entry. This matches the app's `AGENTS.md` wording exactly; change both together.
- The entry check: `git diff <merge-base> -- CHANGELOG.md` holds at least one added line starting `- ` that sits
  under `## Unreleased`. A changed changelog with no added entry line (a reworded intro) does not count.
- The version check runs on every call, branch changes or not: `package.json`, `A/.claude-plugin/plugin.json` and
  `A/.codex-plugin/plugin.json` hold one `version` (coordinator ruling). It fails with each file and its version.
- Message on failure names the fix: `add a line under ## Unreleased in CHANGELOG.md (AGENTS.md § README, changelog
  and boundary)`.

**Version heading** (`changelog-release.mts`):

- Reads `CHANGELOG.md` and `package.json`'s version, and writes the changelog, `package.json` and both manifests.
- MINOR bump (patch to 0) when `### Added`, `### Changed` or `### Removed` under Unreleased hold an entry; PATCH when
  only `### Fixed` does. No MAJOR: a breaking change is the user's call and is bumped by hand.
- The new heading is `## <version> — <YYYY-MM-DD>` (em dash, the local date), placed under an emptied
  `## Unreleased`, the `###` subheadings carried with their entries and empty ones dropped.
- JSON files are rewritten with only the `version` value changed, the rest byte for byte (edit the one line, do not
  re-serialise), so `oxfmt --check` and review diffs stay clean.
- Who runs it: the landing session, as the last commit on the branch before `wigley-land`. Task 19 rules that
  `wigley-land` neither settles nor checks the app's version, so this task leaves the tool alone and adds the step to
  `WigleyRepos.md` § Landing (a step 1b for a branch that changes `wigley-ai-gui` and whose Unreleased holds entries:
  `npm run changelog:release` in the worktree, commit `CHANGELOG.md`, `package.json` and both manifests). Task 17
  moves that step into the new repo's own `AGENTS.md` with the app.
- Today's `package.json` version `1.0.0` stays the base: the first release under this rule produces `1.1.0`. 01 sets
  both manifests to `1.0.0` to match; if 01 chose another value, set all three to `package.json`'s and report it.

**Boundary lint** (`check-boundary.mts`):

- Scans tracked and untracked non-ignored files under `src/`, `agent-plugin/`, `scripts/`, plus root `README.md` and
  `CHANGELOG.md` (`git ls-files --cached --others --exclude-standard` over those paths).
- `BOUNDARY_NAMES` (plan.md § Boundary rules):
  - `~/wigley-agents` and `/wigley-agents/`
  - `wigley-features`
  - `wigley-ai-marketplace`
  - a `wigley:` skill name, pattern `\bwigley:[a-z][a-z-]*` (so `wigley:small` hits; `wigley-ai-gui:` does not)
  - the `wigley` plugin key, pattern `\bwigley@` and `"wigley"` as a JSON key or array item naming a plugin
  - `WigleyCapture`
  - `capture.py`
  - `plan.py`
  - `unity-pool` paths, pattern `wigley-agents/tools/unity-pool` and `\.local/state/unity-pool`
- Not on the list, so not hits: `~/.agents/wigley-forms/` (data folders keep their paths), `wigley-primer`,
  `wigley-docs`, `WIGLEY_SESSION_ROW` and other `WIGLEY_` env names, `wigley-ai-gui` itself. `unity-pool` as a word
  is fine: the plugin exists, off by default, with `unity-pool.scriptPath` naming its script.
- `isExempt`: `*.test.ts`, `*.test.mts`, `*.test-support.ts`, any path segment `fixtures`, `src/**/demo-steps.ts`,
  `src/**/selftest-fixture.ts`, `docs/features/**`, `A/**/tests/**`, and `scripts/boundary-rules.mts` itself.
  `AGENTS.md`, `DESIGN.md`, `.claude/` and `.agents/` are outside the scan: they are agent instructions for working in
  this repo, and `AGENTS.md` names `wigley:` skills on purpose.
- Before wiring it into `lint`, run it once and fix every hit in the scanned tree: rename to the generic form, move
  the text to a contributed `auri.json` (13), or, for real sample data, move the file under an exempt path. A hit
  that cannot be fixed inside this task is an open question in the Proof, not an exemption added to the list.

**README coverage test** (`readme-coverage.test.mts`, Vitest, imports from `../src/…` as
`scripts/claude-idle-rule-copies.test.mts` does):

- Reads `README.md` once. One table-driven test per category; each row asserts the README text holds the name in
  backticks:
  - every `builtInManifests` id
  - every setting path: `<plugin id>.<key>` for each key of each manifest's `settings`, and each core `settingInfo`
    key
  - every contributed tool name, found by a text scan of non-test `src/plugins/**/*.ts` files holding
    `ToolDefinition`, for `name: '<snake_case>'`; a pin row asserts the scan finds 31 names (measured at plan time,
    re-verify after waves 2–4, and update the pin with the README), so a scan that silently finds none fails
  - every folder under `A/skills/`, as `auri:<folder>`
  - every `hooks.json` entry: its event name and its `scripts/<folder>/`
- The failure message names the missing name and the README section it belongs in.
- A text scan over the tool files is used rather than importing the tool constants, because `LIVE_TOOLS` is not
  exported and several tool modules import Electron.

**package.json:**

- `"author": { "name": "Jonathon Wigley" }` — the work email is removed (plan.md round 1).
- `"description": "A desktop app for running and answering coding-agent sessions."`, matching the README's
  What Auri is opening sentence; when the README's opening changes, change both.
- `"license": "MIT"` stays.

**Docs:** remove the "planned in shareable-app, not built yet" banner from `AGENTS.md` § README, changelog and
boundary, and the checks from the README's Status banner, once each script runs. Add this task's entry under
`## Unreleased` `### Added` in `CHANGELOG.md` if the written-ahead entry does not already cover it (it does at plan
time: the last Added line).

## Behaviour

- GIVEN a branch that changes `src/main/app.ts` and leaves `CHANGELOG.md` alone, WHEN `npm run lint:changelog`
  runs, THEN it exits 1 and names `src/main/app.ts` and the fix.
- GIVEN a branch that changes only `docs/features/x/design.md` and `README.md`, WHEN it runs, THEN it exits 0.
- GIVEN `package.json` at `1.1.0` and `A/.codex-plugin/plugin.json` at `1.0.0`, WHEN it runs, THEN it exits 1 naming
  both files and versions.
- GIVEN Unreleased with `### Fixed` entries only and version `1.1.0`, WHEN `npm run changelog:release` runs on
  2026-12-01, THEN the changelog gains `## 1.1.1 — 2026-12-01` with those entries, Unreleased is empty, and all three
  files say `1.1.1`.
- GIVEN `src/x.ts` holding `'wigley:small'`, WHEN `npm run lint:boundary` runs, THEN it prints `src/x.ts:<line>:
  wigley: skill` and exits 1; the same text in `src/x.test.ts` passes.
- GIVEN a new built-in plugin `foo` in `builtInManifests` and no `` `foo` `` in the README, WHEN `npm test` runs,
  THEN the coverage test fails naming `foo`.

## Tests

- `changelog-rules.test.mts`, one table per function:
  - `needsEntry`: `src/…`, `agent-plugin/…`, `scripts/…`, `package.json` kept; `docs/…`, `.claude/…`, `.agents/…`,
    `README.md`, `CHANGELOG.md` dropped; `docs-site/x.ts` kept — catches a prefix match without the trailing slash
  - `addedEntryLines`: an added `- ` line under Unreleased counts; one under an older version heading does not; an
    added intro sentence does not — catches a check any changelog edit satisfies
  - `versionMismatch`: equal versions give `null`; one differing names that file — catches a check that compares
    only two of the three
- `changelog-release.test.mts`: Fixed-only bumps PATCH; any Added/Changed/Removed entry bumps MINOR and zeroes the
  patch; empty Unreleased returns `null`; empty `###` subheadings are dropped from the new section; the content of
  older version sections is unchanged — catches a release that rewrites history.
- `boundary-rules.test.mts`: a hit table (each `BOUNDARY_NAMES` entry once) and a pass table (`~/.agents/wigley-forms/`,
  `wigley-primer`, `WIGLEY_SESSION_ROW`, `wigley-ai-gui:`, `unity-pool.scriptPath`) — catches an over-broad pattern
  that fails the tree; an `isExempt` table for each exempt form and for `src/plugins/x.ts` (not exempt).
- `readme-coverage.test.mts` is itself the test of the README; its pin row is the guard on the scan.

## Verification

```
cd ~/Documents/.worktrees/ai-shareable-app/wigley-ai-gui
npm run typecheck
npm run lint
npm test -- scripts/changelog-rules.test.mts scripts/changelog-release.test.mts scripts/boundary-rules.test.mts scripts/readme-coverage.test.mts
npm test
command grep -n 'peoplefun\|My Electron' package.json
```

Done when:

- `npm run typecheck`, `npm run lint` and `npm test` pass in the worktree
- the `package.json` grep prints nothing
- a scratch change to a `src/` file without a changelog line makes `npm run lint:changelog` exit 1, and reverting it
  makes it pass (run, then revert; record both outputs in the Proof)
- `npm run changelog:release` run on a scratch copy of the tree (a throwaway worktree, removed after) gives the
  heading and three matching versions; the real changelog stays on `## Unreleased` until landing

Commit: one commit in `ai`.

## Proof

<written by wigley:make>
