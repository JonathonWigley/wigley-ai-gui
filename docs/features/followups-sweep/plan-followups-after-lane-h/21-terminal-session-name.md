# 21 — Terminal session name from its own profile

Status: done
Type: Task
Rung: standard · one argument resolved in one function, with a table row
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: **A terminal session's saved name is read from the app's `CLAUDE_CONFIG_DIR`** (`followups.md` L898).

Files:     modify `src/plugins/sessions/main/start.ts` · test `src/plugins/sessions/main/start.test.ts`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "return harness.sessionName(sessionId, projectDir, info.profileDir ?? null);" src/plugins/sessions/main/start.ts`
  → one line, in `hostSessionName`.
- `grep -n "return harness?.configFolder(info.profileDir ?? null) ?? null;" src/plugins/sessions/main/start.ts` → one
  line, in `configFolder`: the profile tag already resolves an absent folder through `AgentHarness.configFolder`.
- `grep -n -A3 "if (profileDir !== null) {" src/plugins/claude-code/main/claude-launch.ts` → in `claudeConfigFolder`, a
  null `profileDir` falls back to the app's own `CLAUDE_CONFIG_DIR`; `projectsRoot` in `claude-code-harness.ts` uses it.
- `grep -n "deps.hostSessionName(entry.session.info)" src/plugins/sessions/main/session-list.ts` → one line, in
  `lookUpHostName`, which skips owned sessions: only relay-connected sessions ask.
- The scheduled-tasks plan's tasks 05, 09 and 23 edit this file (offline tools, `set_session_title`'s offline answer,
  list fixes), not `hostSessionName`. Write against the merged file.

Consumes: `AgentHarness.configFolder`, `AgentHarness.sessionName` (`src/contracts/agent.ts`) — in the tree.

Produces: no new name.

Decisions:
- **Sessions resolves the absent folder, not the harness.** In `hostSessionName`, `harness.sessionName(sessionId,
  projectDir, info.profileDir ?? harness.configFolder(null))`. A relay's hello carries no config folder only when the
  session's own environment set no `CLAUDE_CONFIG_DIR`, so the harness default is that session's folder;
  `configFolder(null)` returns the default and ignores the app's environment, per its contract. `configFolder` returns
  a full path, which `sessionName`'s `profileDir` takes (it expands `~` and leaves a full path as it is).
- **The harness stays as it is.** A null `profileDir` keeps meaning "the folder a session the app launches uses" for
  the app's own calls (`transcript`, `lastUsage`, `listProjects`), where the inherited `CLAUDE_CONFIG_DIR` is right.
- **The function's comment** gains: "A session whose relay named no config folder runs in the harness's default one."

GIVEN a connected claude session whose hello has no `profileDir` WHEN its name is looked up THEN `sessionName` is
asked with the harness's `configFolder(null)`; GIVEN one with `profileDir: '/home/.claude-work'` THEN with that folder.

Tests (in `start.test.ts`, the `'a marked connected session: $case'` table):
- Each row gains a `profileDir` column (`'/home/.claude-work'` on the existing rows, which keep their `asked`), passed
  to `connect` only when not undefined.
- New row `case: 'a session with no config folder asks the harness default'`, `harness: 'claude'`, `sessionId:
  'host-1'`, `projectDir: '/work/folder'`, `profileDir: undefined`, `asked: [['host-1', '/work/folder',
  '/resolved']]` (`'/resolved'` is the fake harness's `configFolder` answer in that test).

Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/sessions/main/start.test.ts` green; `npm run
lint` clean.

Commit: one commit for the group, e.g. "A terminal session's saved name is read from its own default config folder,
not the app's CLAUDE_CONFIG_DIR (follow-up: terminal session name)"

## Proof

Commit cd9e08828 · proof: diff read: hostSessionName passes profileDir ?? harness.configFolder(null); typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: none
