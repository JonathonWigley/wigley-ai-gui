# 03 — Claude Code adapter on Paths

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/claude-launch.ts` · modify `src/main/claude-code/past-sessions.ts` · modify `src/main/main.ts` · delete `src/shared/expand-home.ts` · delete `src/shared/expand-home.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts` · test `src/main/claude-code/past-sessions.test.ts` · test `src/main/claude-code/claude-launch.test.ts`
Consumes:  `Paths` ← 01 · `posixPaths`, `windowsPaths` ← 01 · the `paths` constant in `src/main/main.ts` ← 02
Produces:  `paths: Paths` in `ClaudeCodeHarnessDeps` (`src/main/claude-code/claude-code-harness.ts`)
           `claudeLaunch(request: AgentStart, permissionTool: string, env: NodeJS.ProcessEnv, homeDir: string, paths: Paths): ClaudeLaunch` in `src/main/claude-code/claude-launch.ts`
           `claudeConfigFolder(profileDir: string | null, env: NodeJS.ProcessEnv, homeDir: string, paths: Paths): string` in `src/main/claude-code/claude-launch.ts`
           `listPastSessions(deps: PastSessionsDeps, projectsFolder: string, projectDir: string)` with `paths: Paths` added to `PastSessionsDeps`, and `readHistory(files: Files, paths: Paths, projectsFolder: string, sessionId: string)` in `src/main/claude-code/past-sessions.ts`
Decisions: the adapter takes `paths` in its deps, not `node:path`, so its lookups run against the in-memory files fake on any OS (design review, seam) · a transcript's `cwd` matches the chosen folder by `samePath`, so `c:\_root\dev` and `C:\_root\dev\` match on Windows (round 1, case-folded compares) · `projectFolderName` (`transcripts.ts`) is unchanged: Claude's own encoding already gives `C---root-dev-wigley-ai-gui`, matching `~/.claude/projects` on this machine (measured at plan time)

## Changes

- `claude-code-harness.ts`: drops `import path from 'node:path'`; `projectsFolder` uses `deps.paths.join`; the
  harness passes `deps.paths` to `claudeLaunch`, `claudeConfigFolder`, `listPastSessions` and `readHistory`.
- `claude-launch.ts`: drops `node:path` and `expandHome`; `request.profileDir` and the profile folder expand with
  `paths.expandTilde` (a bare `~` profile now names the home folder itself, task 01), and the default folder is `paths.join(homeDir, '.claude')`.
- `past-sessions.ts`: drops `node:path`; `transcriptPath` joins with `paths.join`; `pastSession` keeps a session
  when `paths.samePath(cwd, projectDir)` (a null `cwd` still drops it).
- `main.ts` `claudeHarness(...)` (line ~169) passes the `paths` constant task 02 added.
- Delete `src/shared/expand-home.ts` and its test: `claude-launch.ts` was its last importer, and its cases live in
  `paths.test.ts` (task 01).

GIVEN `windowsPaths`, a transcript whose first line has `"cwd":"c:\\_root\\dev\\app"` WHEN `listPastSessions` runs for project folder `C:\_root\dev\app` THEN the session is listed
GIVEN `windowsPaths` and profile folder `~/.claude-work` with home `C:\Users\jo` WHEN `claudeLaunch` runs THEN `env.CLAUDE_CONFIG_DIR` is `C:\Users\jo\.claude-work`
GIVEN no profile and no inherited `CLAUDE_CONFIG_DIR` WHEN `claudeConfigFolder` runs with `windowsPaths` and home `C:\Users\jo` THEN it returns `C:\Users\jo\.claude`

Tests:     existing tests in the three test files pass `posixPaths` and keep their assertions; this clears the 5 Windows failures in `past-sessions.test.ts` and `claude-code-harness.test.ts` (Preconditions)
           `listPastSessions_WindowsCwdCaseDiffers_Listed` (first GIVEN, with the in-memory files fake keyed by the Windows paths it joins)
           `claudeLaunch_WindowsProfile_ExpandsUnderHome` (second GIVEN)
           `claudeConfigFolder_WindowsDefault_IsHomeClaude` (third GIVEN)
Approach:  the in-memory files fake (`src/shared/memory-files.ts`) stores `/`-led keys; a Windows-path test needs a
           fake that accepts `C:\…` keys. Use a small `Files` stub inside the test that maps the exact joined paths
           to content, rather than widening `memory-files.ts`.
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit ff56bba. Proof: diff read — ClaudeCodeHarnessDeps.paths, claudeLaunch/claudeConfigFolder/listPastSessions/readHistory take paths as Produces gives; cwd matched by samePath; expand-home.ts and its test deleted; no typecheck error in src/main, src/shared, src/contracts or src/renderer; src/main/claude-code and src/shared/paths 163 passed. Concerns: an inherited CLAUDE_CONFIG_DIR is returned unnormalized.
