# 05 — Chat and forms on Paths

Status: done
Type: Batch
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-state.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start-prompt-items.ts` · modify `src/plugins/chat/page/start-prompt.ts` · modify `src/plugins/chat/page/start.ts` (only to hand `services.paths` on, if the view and prompt don't already receive the services) · modify `src/plugins/chat/main/recent-folders.ts` · modify `src/plugins/chat/main/start.ts` · modify `src/plugins/forms/main/round-store.ts` · modify `src/plugins/forms/main/start.ts` · test `src/plugins/chat/page/chat-state.test.ts` · test `src/plugins/chat/page/start-prompt-items.test.ts` · test `src/plugins/chat/main/recent-folders.test.ts` · test `src/plugins/forms/main/round-store.test.ts`
Consumes:  `Paths` ← 01 · `posixPaths`, `windowsPaths` ← 01 (tests) · `PageServices.paths`, `MainServices.paths` ← 02
Produces:  `folderName(projectDir: string, paths: Paths): string` in `src/plugins/chat/page/chat-state.ts`
           `displayPath(projectDir: string, homeDir: string, paths: Paths): string` and `folderItems(recent, homeDir, paths)` (the new last parameter `paths: Paths`) in `src/plugins/chat/page/start-prompt-items.ts`
           `addRecentFolder(folders: readonly RecentFolder[], folder: RecentFolder, paths: Paths): RecentFolder[]` in `src/plugins/chat/main/recent-folders.ts`, and `paths: Paths` in `createRecentFolders`' deps
           `paths: Paths` in `createRoundStore`'s deps (`src/plugins/forms/main/round-store.ts`)
           `preselectedProfile(profiles: readonly ChatProfile[], recent: readonly RecentFolder[], projectDir: string, paths: Paths): number` in `src/plugins/chat/page/start-prompt-items.ts`
Decisions: Windows folders show natively with home as `~` (`C:\_root\dev`, `~\dev\app`) (round 1) · every `projectDir` string compare becomes `samePath` (round 1 scope) · main-side `node:path` on full paths stays, since it follows the OS main runs on; the page code and every string compare move (cold read)

## Items

1. **Chat folder name** — `folderName` returns `paths.base(projectDir)`, or `projectDir` itself when the base is
   `''` (a root such as `C:\` or `/`), as the trailing-slash case does today. `chat-view.ts:331` passes the page's
   `services.paths`.
2. **Chat start prompt** — `displayPath` returns `paths.tilde(projectDir, homeDir)`; the trailing-`/` trim on
   `homeDir` goes, since `tilde` normalizes. `folderItems` and the two log lines in `start-prompt.ts` (lines ~283
   and ~308) pass `paths`. `preselectedProfile` (`start-prompt-items.ts:43`) finds the recent folder
   with `paths.samePath` in place of `folder.projectDir === projectDir`, and `start-prompt.ts` passes `paths`.
3. **Chat recent folders** — `addRecentFolder` drops an earlier entry when `paths.samePath(earlier.projectDir,
   folder.projectDir)`, keeping the new entry's spelling. `createRecentFolders` takes `paths` from chat's main start.
4. **Forms round ownership** — `isOwnedBy` compares `record.project_dir` and `owner.projectDir` with
   `paths.samePath` (both non-null), from the store's deps; forms' main start passes `api.services.paths`.
Main-side `node:path` joins and base names on full paths stay as they are (`chat-sessions.ts`, `forms-service.ts`,
`round-store.ts`'s joins, sessions' `session-list.ts` and `start.ts`, chat's `main/start.ts`): `node:path` already
follows the OS main runs on. This task moves only the page code and the string compares above.

GIVEN `windowsPaths` WHEN `folderName('C:\_root\dev\wigley-ai-gui', windowsPaths)` runs THEN it returns `wigley-ai-gui`
GIVEN `windowsPaths` WHEN `displayPath('C:\Users\jo\dev\app', 'C:\Users\jo', windowsPaths)` runs THEN it returns `~\dev\app`, and `displayPath('C:\_root\dev', 'C:\Users\jo', windowsPaths)` returns `C:\_root\dev`
GIVEN recent folders holding `C:\Dev\App` WHEN `addRecentFolder` adds `c:\dev\app\` with `windowsPaths` THEN one entry remains, `c:\dev\app\`, first
GIVEN a saved round with `project_dir` `C:\Dev\App` and no session id WHEN an owner with no session id and project folder `c:\dev\app` asks with `windowsPaths` THEN the round is the owner's

Tests:     existing tests in the four test files pass `posixPaths` and keep their assertions
           `folderName_WindowsFolder_LastSegment`, `displayPath_WindowsBelowHome_Tilde`, `displayPath_WindowsOutsideHome_Native`, `addRecentFolder_WindowsCaseDiffers_OneEntry`, `isOwnedBy_WindowsCaseDiffers_Owned` (through the store's public read, not the private function): one per GIVEN above, asserting the values it names
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 9c2315f. Proof: diff read — folderName, displayPath, folderItems, preselectedProfile, addRecentFolder, createRecentFolders and createRoundStore take paths as Produces gives; every projectDir compare is samePath; no typecheck error in chat or forms; chat and forms suites 742 passed. Concerns: six test or preview files outside the Files list took only the new argument.
