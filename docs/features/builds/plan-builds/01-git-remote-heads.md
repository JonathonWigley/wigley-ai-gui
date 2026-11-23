# 01 — Git remote heads and commit subjects, and Files' readEnd

Status: not started
Type: Batch
Rung: hard · adds two `Git` members, `GitRemoteHead` and `Files.readEnd`, which tasks 03 and 05 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files (Files' `readEnd`, added by the lead's ruling):
- modify `wigley-ai-gui/src/contracts/files.ts`
- modify `wigley-ai-gui/src/main/files/node-files.ts`
- modify `wigley-ai-gui/src/shared/memory-files.ts`
- modify `wigley-ai-gui/src/shared/scoped-files.ts`
- modify `wigley-ai-gui/src/shared/plugin-part-harness.test-support.ts` (`countingWatches` lists
  every member)
- modify `wigley-ai-gui/src/shared/files-contract.test-support.ts`
- modify `wigley-ai-gui/src/shared/scoped-files.test.ts` (its recording fake lists every member,
  and its per-method table holds a `readStart` row)

Files (Git):
- modify `wigley-ai-gui/src/contracts/git.ts`
- modify `wigley-ai-gui/src/main/git/process-git.ts`
- test `wigley-ai-gui/src/main/git/process-git.test.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/start.test.ts` (its `fakeGit()` is `satisfies Git`)
- modify `wigley-ai-gui/src/plugins/docs/main/plugin-status.test.ts` (its fake git is `satisfies Git`)

Consumes: `ProcessRunner.run(command, args, { timeoutMs })` and `ProcessResult.timedOut`, which
the tree holds (`src/contracts/processes.ts`).

Produces:
- `export interface GitRemoteHead { name: string; sha: string }` in `src/contracts/git.ts`
- `remoteHeads(root: string, pattern: string): Promise<GitRemoteHead[] | null>;` on `interface Git`
  in `src/contracts/git.ts`
- `commitSubject(root: string, sha: string): Promise<string | null>;` on `interface Git` in
  `src/contracts/git.ts`
- both members in `createProcessGit` in `src/main/git/process-git.ts`
- `readEnd(path: string, maxBytes: number): Promise<string>;` on `interface Files` in
  `src/contracts/files.ts`, right after `readStart`, with the comment: "The file's last
  `maxBytes` bytes as UTF-8, a character the cut splits at the start left out; the whole file
  when shorter. Rejects when the file is missing, naming the path." Implemented in
  `createNodeFiles` (`src/main/files/node-files.ts`), `createMemoryFiles`
  (`src/shared/memory-files.ts`), `scopedFiles` (`src/shared/scoped-files.ts`) and
  `countingWatches` (`src/shared/plugin-part-harness.test-support.ts`). Task 05 reads a run
  log's last line with it.

Decisions:
- **`readEnd`** mirrors `readStart` (lead's ruling). Node: `stat` the open handle for its size,
  read from `max(0, size - maxBytes)` to the end in a loop as `readFirstBytes` does, and close the
  handle in `finally`; name it `readLastBytes` beside `readFirstBytes`. When the read
  starts inside the file (start offset above 0), both adapters drop the leading bytes of the form
  `10xxxxxx` (UTF-8 continuation bytes) before decoding, so a cut character is left out and never
  shows as U+FFFD. A read from offset 0 drops nothing, so a whole-file read decodes as `read` does. Memory: encode the text, take
  `bytes.slice(Math.max(0, bytes.length - maxBytes))`, drop the same leading bytes under the same
  condition, decode.
  `scopedFiles` forwards through `inside(path)`, and `countingWatches` forwards as its
  `readStart` does. Add `readEnd` to `scopedFiles`' header comment's list of methods that reject
  outside the root. Every other `Files` object in the tree spreads a full `Files`
  (`trackedFiles` in `src/shared/plugin-service-views.ts`, the test wrappers in
  `doc-files.test.ts`, `layout-registry.test.ts`, `form-store.test.ts`, `past-sessions.test.ts`),
  so it needs no edit.
- Every git read goes through `services.git` (plan.md § Boundary rules). These two reads are the
  only new git runs of the feature.
- Other implementers. A grep for `satisfies Git`, `): Git {`, `as Git` and `: Git` over `src/`
  finds two full fakes: `fakeGit()` in `src/plugins/backlog/main/start.test.ts` and the fake in
  `src/plugins/docs/main/plugin-status.test.ts`. Add both members to each, as
  `vi.fn<Git['remoteHeads']>(async () => null)` and `vi.fn<Git['commitSubject']>(async () => null)`,
  in the order of the contract. Leave every other fake as it is: each one is a `Pick<Git, …>`, a
  `Partial<Git>` cast, an `as never` or `as unknown as Git` cast, or `notFaked<Git>` in
  `src/shared/plugin-part-harness.test-support.ts`, and none of these names every member.
- `remoteHeads` runs `git -C <root> ls-remote --heads origin refs/heads/<pattern>` with
  `timeoutMs: 15000` (the value `src/plugins/docs/main/plugin-status.ts` gives its fetch). Keep the
  value in a module constant `REMOTE_HEADS_TIMEOUT_MS`. The `refs/heads/` prefix anchors the
  pattern at the start of the ref: `git ls-remote` matches a pattern against a ref's tail from a
  `/`, so a bare `main` also matches `refs/heads/feature/main`. With the prefix, `*` lists every
  head, and `releases/physics-fun/*` lists the release branches (design.md § Configuration: "a git
  ref pattern under `refs/heads/`").
- `remoteHeads` never rejects. It returns null on a non-zero exit, on `timedOut`, and when git
  cannot start (`processes.run` rejects). It reads each output line `<sha>\t<ref>`, drops
  `refs/heads/` from the ref, and keeps the lines in git's order. An empty output is `[]`.
- `commitSubject` runs `git -C <root> show -s --no-show-signature --format=%s <sha>` and returns
  the stdout with its trailing newline removed. It returns null without a run when `sha` is not 4
  to 40 hex characters (`/^[0-9a-f]{4,40}$/i`), so a sha can never be read as an option or a ref
  name. It returns null on any non-zero exit: a sha the clone lacks exits 128. It rejects when git
  cannot start, as every other `Git` method but `fetch` and `lastFetch` does.
- Update the contract's header comment. `remoteHeads` and `commitSubject` join the list of methods
  that do not reject `git <name> exited …`, and `remoteHeads` joins `fetch` and `lastFetch` as the
  methods that never reject. Write each member's comment from plan.md § Shared names and
  signatures, and add to `commitSubject`'s comment: "also null for a `sha` that is not 4 to 40 hex
  characters (nothing runs) and on any other non-zero exit".
- Test names in `process-git.test.ts` follow that file's own `Method_Condition_Result` form, and
  its tables follow its `it.each` rows with a `case` field.

GIVEN origin holds `main`, `feature/main` and `releases/x/1` WHEN `remoteHeads(root, 'main')` runs
THEN it returns only `main` with its sha
GIVEN `ls-remote` times out WHEN `remoteHeads` runs THEN it returns null
GIVEN a sha the clone lacks WHEN `commitSubject` runs THEN it returns null
GIVEN the sha `--output=x` WHEN `commitSubject` runs THEN it returns null and runs nothing

GIVEN a file `hello` WHEN `readEnd(file, 3)` runs THEN it returns `llo`
GIVEN a file `éa` WHEN `readEnd(file, 2)` runs THEN it returns `a`

Tests (in `src/shared/files-contract.test-support.ts`, which `memory-files.test.ts` and
`node-files.test.ts` both run through `describeFilesContract`):
- Add a `readEnd` row to the "$method of a missing file rejects as a missing file naming it"
  table: `call: (files, file) => files.readEnd(file, 10)`.
- `readEnd with limit $limit returns $expected`, beside the `readStart` table: over `hello`,
  `{ limit: 3, expected: 'llo' }` and `{ limit: 100, expected: 'hello' }`.
- `readEnd_CutInsideACharacter_LeavesItOut`: over `éa`, `readEnd(file, 2)` is `'a'`.
- `readEnd_WholeFile_KeepsALeadingContinuationByte`: over the bytes `0x80 0x61` (`writeBytes`),
  `readEnd(file, 10)` is `'\uFFFDa'`.

Tests (in `src/shared/scoped-files.test.ts`): add a `readEnd` row beside the `readStart` row of
its per-method table, and `readEnd` to its recording fake.

Tests (in `src/main/git/process-git.test.ts`):
- `remoteHeads_Outcome_HeadsOrNull` — `it.each` over a fake `FakeProcesses` run scripted for
  `git('ls-remote', '--heads', 'origin', 'refs/heads/releases/physics-fun/*')`; every row asserts
  `test.processes.runs[0].timeoutMs` is `15000`:

  | case | result | expected |
  |---|---|---|
  | two heads | exit 0, stdout `${SHA_A}\trefs/heads/releases/physics-fun/0.12\n${SHA_B}\trefs/heads/releases/physics-fun/0.13\n` | `[{ name: 'releases/physics-fun/0.12', sha: SHA_A }, { name: 'releases/physics-fun/0.13', sha: SHA_B }]` |
  | no match | exit 0, stdout `''` | `[]` |
  | exits 128 | exit 128, stderr `fatal: 'origin' does not appear to be a git repository` | `null` |
  | times out | code -1, `timedOut: true` | `null` |
  | cannot start | the run scripted as `new Error('Could not run git: spawn git ENOENT')` | `null` |

- `commitSubject_Outcome_SubjectOrNull` — `it.each`:

  | case | sha | result | expected | runs |
  |---|---|---|---|---|
  | held | `SHA_A` | exit 0, stdout `Fix the level loader\n` | `'Fix the level loader'` | one run of `git('show', '-s', '--no-show-signature', '--format=%s', SHA_A)` |
  | missing | `SHA_B` | exit 128, stderr `fatal: bad object` | `null` | one run |
  | option text | `--output=x` | none | `null` | no run |
  | ref name | `HEAD` | none | `null` | no run |

- `commitSubject_CannotStart_Rejects` — with the run scripted as
  `new Error('Could not run git: spawn git ENOENT')`, `commitSubject(ROOT, SHA_A)` rejects with
  `Could not run git`.
- In `describe('createProcessGit over a real clone')`, under `it.skipIf(!gitOnPath)`:
  `remoteHeadsAndCommitSubject_BareOrigin_AnchoredHeadsAndSubject`. Call `isolateGitConfig()`.
  Make a bare repo `origin.git` and a clone of it in a `mkdtempSync` folder. Commit `first` with
  one file in the clone, then push `HEAD` to `main`, `feature/main` and `releases/x/1`. Assert:
  `remoteHeads(clone, 'main')` is `[{ name: 'main', sha }]`, `remoteHeads(clone, 'releases/x/*')` is
  `[{ name: 'releases/x/1', sha }]`, `remoteHeads(clone, 'nope')` is `[]`,
  `commitSubject(clone, sha)` is `'first'`, and `commitSubject(clone, '0'.repeat(40))` is `null`.
  `sha` is `git rev-parse HEAD` in the clone.

Done when: compiles (`npm run typecheck`); `npm run lint`; the test gate runs the tests above and
the backlog `start.test.ts`, docs `plugin-status.test.ts`, `memory-files.test.ts`,
`node-files.test.ts` and `scoped-files.test.ts` files. Live checks: none for this
task; task 10 "Final verification" checks 2 and 4 show both reads in the running app.

Commit: one commit for the group.

## Proof
