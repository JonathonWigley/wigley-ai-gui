# 02 — Git contract and adapter

Status: not started
Type: Task
Wave: 2 · Depends on: 01 (shares `scripts/check-layers.mts`), 04 (shares `src/plugins/docs/main/start.ts`)
Plan: [plan.md](plan.md)

Files:     create `src/contracts/git.ts` · create `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts` ·
           modify `src/contracts/plugin.ts` (`MainServices`) · modify `src/main/main.ts` (the only `MainServices` builder) ·
           modify `src/plugins/docs/main/plugin-status.ts` and `plugin-status.test.ts` · modify
           `src/plugins/docs/main/start.ts` (hand `services.git` to `readPluginStatus`) · modify `scripts/check-layers.mts`
           (a `src/main/git` entry: may import `src/contracts` and `node:`; the main composition root lists it) ·
           modify every test helper that builds a `MainServices` (find them: `grep -rln "agentHarnesses:" src`)
Consumes:  `ProcessRunner.run` (`src/contracts/processes.ts`), `Files` (`src/contracts/files.ts`), `Paths`
Produces:  in `src/contracts/git.ts`:
           ```ts
           // Paths in and out are relative to `root`, `/`-separated. Every method but `topLevel`, `hasUpstream`,
           // `fetch` and `lastFetch` rejects `git <name> exited <code>: <stderr>` on a failed run.
           export interface Git {
             // The clone's top folder holding `folder`; null when `folder` is in no clone.
             topLevel(folder: string): Promise<string | null>;
             hasUpstream(root: string): Promise<boolean>;
             // Files changed from HEAD or untracked, under `pathspec`.
             changedPaths(root: string, pathspec: string): Promise<string[]>;
             // Files that differ between the upstream and HEAD, under `pathspec`.
             unpushedPaths(root: string, pathspec: string): Promise<string[]>;
             // Path → blob id at the upstream, under `pathspec`.
             upstreamBlobs(root: string, pathspec: string): Promise<Map<string, string>>;
             // True when the fetch failed: a non-zero exit, `timeoutMs` passed, or git did not start. Never rejects.
             fetch(root: string, timeoutMs: number): Promise<boolean>;
             // The modified time of the clone's FETCH_HEAD (ISO); null when never fetched or on any failure,
             // as `readFetchedAt` in plugin-status.ts does today. Never rejects.
             lastFetch(root: string): Promise<string | null>;
             // The file's text at HEAD; null when HEAD does not hold it.
             fileAtHead(root: string, path: string): Promise<string | null>;
             // Stages `paths` and commits only them with `message`; anything else staged stays staged.
             commitPaths(root: string, paths: string[], message: string): Promise<void>;
           }
           ```
           `export function createProcessGit(deps: { processes: ProcessRunner; files: Files; paths: Paths }): Git` in
           `src/main/git/process-git.ts`
           `git: Git` on `MainServices` in `src/contracts/plugin.ts`
Decisions: git is a third-party tool: one contract, one adapter, the only place the app runs `git` (AGENTS.md § A
           third-party tool; design.md § Git) · Docs' plugin statuses move onto it, with no behaviour change: Backlog
           is the second consumer, and `gitOutput` in `plugin-status.ts` is the helper widened, never copied ·
           git's output formats (porcelain `-z`, `ls-tree -z`, `--name-only -z`) are parsed in the adapter only, so
           `plugin-status.ts` keeps no git parsing · the live adapter is named once in each composition root

Approach:  `commitPaths` runs `git -C <root> add -- <paths>` then `git -C <root> commit --only -m <message> -- <paths>`:
           `--only` alone refuses an untracked path, and the `add` keeps a new `followups.md` committable.
           `fetch` keeps plugin-status's shared-fetch dedup (`runningFetches`) in `plugin-status.ts`; the adapter
           runs one fetch per call.

GIVEN a clone with one staged unrelated file and a modified `followups.md` WHEN `commitPaths(root, ['docs/features/followups.md'], m)`
runs THEN the commit holds only `followups.md` and the unrelated file is still staged.

Tests:     `process-git.test.ts` over a fake `ProcessRunner`: each method's argument list, and its parse of recorded
           git output (porcelain with a rename and an untracked file, `ls-tree`, `--name-only`), `topLevel` null on a
           non-zero exit, `fileAtHead` null on a missing path, `fetch` true on timeout and on a run that cannot start,
           `lastFetch` null on a failed `rev-parse` and on a missing FETCH_HEAD,
           `commitPaths` runs `add` then `commit --only`.
           One test over a real temporary clone for `commitPaths` (the GIVEN above), skipped with a named reason when
           `git` is not on the PATH.
           `plugin-status.test.ts` keeps every existing case, now over a fake `Git`.
Done when: `npm test -- src/main/git src/plugins/docs/main/plugin-status` passes; `npm run lint` passes; `npm run
           typecheck` passes.
Commit:    one commit for the group

## Proof
