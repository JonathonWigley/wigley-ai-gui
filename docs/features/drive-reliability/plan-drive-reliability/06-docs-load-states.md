# 06 — `docs.seed` and `docs.connectSession` can seed a doc in every index load state

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/selftest-fixture.ts` · modify `src/plugins/docs/main/start.ts` ·
           modify `src/plugins/docs/main/selftest-script.ts` (`connectDocsFixtureSession` only) ·
           modify `src/shared/drive-args.ts` · test `src/shared/drive-args.test.ts` ·
           test `src/plugins/docs/main/selftest-fixture.test.ts` (create)
Consumes:  `writeDocsFixture`, `indexDocument`, `entry`, `state` in `src/plugins/docs/main/selftest-fixture.ts`;
           `connectDocsFixtureSession` in `src/plugins/docs/main/selftest-script.ts`; `addDriveActions` in `src/plugins/docs/main/start.ts`;
           `argsObject` and the drive-args readers in `src/shared/drive-args.ts` (tree)
Produces:  `export interface DocsFixtureOptions { loadStates: boolean }` in `src/plugins/docs/main/selftest-fixture.ts`
           `writeDocsFixture(files: Files, homeDir: string, paths: Paths, options: DocsFixtureOptions = { loadStates: false }): Promise<void>`
           a trailing `options: DocsFixtureOptions = { loadStates: false }` parameter on `connectDocsFixtureSession` in
           `src/plugins/docs/main/selftest-script.ts`
           `export function optionalBoolean(args: JsonObject, name: string): boolean | undefined` in `src/shared/drive-args.ts`,
           shaped as `optionalNumber` is (undefined when left out, throwing on a non-boolean, through a
           `requiredBoolean` beside `requiredNumber` if the file has none)
           `docs.seed` args `{ loadStates?: boolean }` and `docs.connectSession` args
           `{ sessionId?: string, loadStates?: boolean }` in `src/plugins/docs/main/start.ts`
Decisions: one flag adds one doc per index load state, and the self-test's fixture stays unchanged, so its j/k steps
           keep their counts (round 2) · `pending` is not an index state: the page shows it for a doc changed since
           the last build (`chips`, `src/plugins/docs/page/docs-state.ts`), so a drive run reaches it by editing a
           seeded doc on disk, which task 12 does

## Behaviour

- With `loadStates: true` the fixture also writes four docs under `<home>/.claude/load-states/`, one per index load
  state other than `launch` (which the fixture already shows), and adds each as an index entry and a state in the
  home folder's context (`contexts[0]`, `folder: fixture.home`). Pinned values:

  | File | Title | Claude state | Reason |
  |---|---|---|---|
  | `on-demand.md` | `Load state on-demand` | `on-demand` | `loads when invoked` |
  | `listed.md` | `Load state listed` | `listed` | `listed by name only` |
  | `shadowed.md` | `Load state shadowed` | `shadowed` | `a nearer file wins` |
  | `not-loaded.md` | `Load state not-loaded` | `not-loaded` | `not read at launch` |

  Each entry: `kind: 'instructions'`, `source: 'global'`, its file's text `# <Title>\n`. Codex gets no state, so its
  chip reads `Codex —`.
- With `loadStates: false` (the default, and every self-test call) the written index and files are exactly today's.
  A seed with the flag off after one with it on removes the `load-states` folder, as the fixture already trashes
  what earlier steps added in the rules folder.
- `connectDocsFixtureSession` passes the options to `writeDocsFixture`; the session index (`sessionDocument`) is left
  as it is.
- The two drive actions read `loadStates` with `optionalBoolean(…) ?? false` and their
  descriptions say what it adds.

GIVEN `writeDocsFixture` with `loadStates: true` over memory files WHEN the index fixture file is read back THEN it
holds the four entries above, and the home context holds each one's Claude state and reason
GIVEN `writeDocsFixture` with `loadStates: true` then again with `loadStates: false` WHEN the files are listed THEN no
file under `.claude/load-states/` remains and the index holds none of the four entries

Tests:     `optionalBoolean` left out, true, and a string rejected, in `drive-args.test.ts`; the two cases in a new `src/plugins/docs/main/selftest-fixture.test.ts`, over `createMemoryFiles`
           (`src/shared/memory-files.ts`) and the POSIX paths adapter, in the GIVEN/WHEN/THEN sentence style
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the docs self-test.
           The tag tones on screen are task 12's check.
Commit:    one commit for the group

## Proof

