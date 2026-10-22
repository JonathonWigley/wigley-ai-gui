# 03 — The Claude adapter resolves profile folders

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-launch.ts` · modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-launch.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · modify `src/plugins/chat/main/start.ts`
Consumes:  `expandHome(value, homeDir)` in `src/shared/expand-home.ts` (exists)
Produces:  `AgentStart.profileDir`, `listSessions`'s and `history`'s `profileDir` carry the folder as the profile writes it (`~/.claude-personal`) in `src/contracts/agent.ts`
Decisions: the adapter expands against the home it was built with; chat passes the folder as written (round 4)

## What changes

- `agent.ts`: the comment on `profileDir` says it is the harness's config folder as the profile writes it, which the adapter resolves (`~` against the home the adapter was built with), null for the harness default.
- `chat-sessions.ts`: `profileDirOf` returns `profile.configDir` unchanged. Nothing else reads `deps.homeDir`, so `homeDir` leaves `ChatSessionsDeps`, the call in `src/plugins/chat/main/start.ts` and the test's setup; chat's `homeDir` channel handler reads `services.homeDir` and stays.
- `claude-launch.ts`: `claudeLaunch` takes the adapter's `homeDir` and sets `CLAUDE_CONFIG_DIR` to `expandHome(request.profileDir, homeDir)`; `claudeConfigFolder` expands `profileDir` the same way.
- `claude-code-harness.ts` passes `deps.homeDir` to both. The fake harness ignores `profileDir` and needs no change.

GIVEN a profile whose `configDir` is `~/.claude-personal` WHEN chat starts a session THEN the harness receives `profileDir` `~/.claude-personal`
GIVEN `homeDir` `/Users/u` and `profileDir` `~/.claude-personal` WHEN `claudeLaunch` runs THEN `env.CLAUDE_CONFIG_DIR` is `/Users/u/.claude-personal`

Tests:     update the three chat-sessions assertions on the expanded folder (start, past sessions' `listSessions`, resume; measured at plan time at `chat-sessions.test.ts:235`, `:274`, `:363`, re-verify) to the folder as written; `claude-launch.test.ts`: `expands a profile folder against the adapter's home`; `claudeConfigFolder expands a profile folder against the adapter's home`
Done when: typecheck and the tests pass
Commit:    one commit for the group

## Proof
