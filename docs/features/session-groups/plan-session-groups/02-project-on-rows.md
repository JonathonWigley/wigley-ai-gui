# 02 — Project on session rows

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · create `src/plugins/sessions/main/project-names.ts` ·
           test `src/plugins/sessions/main/project-names.test.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           test `src/plugins/sessions/main/session-list.test.ts` · modify `src/plugins/sessions/main/start.ts` ·
           modify `src/plugins/sessions/page/preview.ts` · modify `src/plugins/sessions/page/sessions-view-fakes.ts` ·
           modify every other `SessionRow` literal `npm run typecheck` flags
Consumes:  `Git.originRepoName(folder)` ← 01
Produces:  `project: string` on `interface SessionRow` in `src/plugins/sessions/contract.ts`
           `export function createProjectNames(git: Pick<Git, 'originRepoName'>): (projectDir: string) => Promise<string | null>` in `src/plugins/sessions/main/project-names.ts`
           `projectName(projectDir: string): Promise<string | null>` on `interface SessionListDeps` in `src/plugins/sessions/main/session-list.ts`
Decisions: main resolves once per folder for the app's life (Decided) · the row carries the folder fallback until
           the lookup lands (Decided) · `label` and its numbering stay per folder (Decided)

- `SessionRow.project`'s comment: the session's project, the origin repo name of its folder, else the folder's
  name, else the no-folder label; set to the fallback at connect and changed once when the lookup lands.
- `createProjectNames` caches the promise per `projectDir`, so a folder runs one git call however many sessions
  open in it. A null from git resolves to null and stays cached; a rejected lookup leaves the cache, so the next
  session in that folder asks again.
- `SessionEntry` gains `project: string`, starting as `groupOf(info)`; `rowOf` copies it onto the row. `addEntry`
  calls `deps.projectName(info.projectDir)` when `projectDir` is not null; when it resolves to a non-null name
  that differs from the entry's, and the entry is still in `entries`, the entry's `project` changes; when the
  session has a row, the row's changes too and the state is sent, else nothing is sent and the row takes the
  project when it is added. A rejection logs `project of <projectDir> not read: <errorText>` under
  `sessions` and keeps the fallback.
- `main/start.ts` passes `projectName: createProjectNames(api.services.git)` into `createSessionList`.
- `preview.ts`'s sample rows get projects so task 06's preview shows both sections: `preview-1`, `preview-2` →
  `wigley-ai-gui`; `preview-3` → `new-games-prototypes`; `preview-4`, `preview-5` → `wigley-agents`.

GIVEN two sessions in different folders whose `projectName` resolves to `new-games-prototypes` WHEN both rows show
THEN both rows' `project` is `new-games-prototypes` and their labels stay their folders' (`new-games-prototypes-2`, `new-games-prototypes-3`)
GIVEN a `projectName` still pending WHEN the row is added THEN its `project` is the folder's name; WHEN it resolves THEN one more state carries the new project
GIVEN a `projectName` resolving to null, or to the fallback itself WHEN it lands THEN no state is sent
GIVEN a `projectName` that rejects WHEN it lands THEN the log line above is written and the row keeps the fallback
GIVEN a session with `projectDir` null WHEN it connects THEN `projectName` is not called and `project` is `session` (`Codex session` for codex)
GIVEN a session that ended before its lookup landed WHEN it lands THEN nothing is sent
GIVEN a connected session with no row WHEN its lookup lands THEN nothing is sent; WHEN `mark` then adds its row THEN the row carries the resolved project
Tests:     `project-names.test.ts` — `cachesOneLookupPerFolder`: two calls for one folder make one git call, two folders make two, and a rejected first call then a second call make two ·
           `session-list.test.ts` — one table test `rowProjectFollowsTheLookup` over the GIVENs above, a deferred fake
           `projectName` per row; the existing `createSessionList` helper gains a default `projectName` resolving null
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof
