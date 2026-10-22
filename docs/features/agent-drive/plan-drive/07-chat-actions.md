# 07 — Chat drive actions

Status: done
Type: Task
Wave: 2 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/fixtures.ts` · modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/chat/main/start.ts`
Consumes:  `MainApi.drive: DriveHost | null` ← 01 · the profile folder passed as written ← 03 · chat's `start`, `permissionToolSession` and `sessions.activate` (exist)
Produces:  drive actions `chat.start`, `chat.askPermission`
           `export function askFixturePermission(chat: ChatSessions, sessionId: string, projectDir: string, request: { toolName: string; input: unknown; toolUseId: string }): Promise<unknown>` in `src/plugins/chat/main/fixtures.ts`
Decisions: first drive actions (design review) · fixture builders shared with the self-test (design review)

## What changes

- `chat.start` `{ projectDir?, profile? }` → `chat.start({ projectDir, profile })`, activates its row, returns `{ sessionId }`. Default `projectDir`: `<homeDir>/dev/drive-project`, created if missing (`files.mkdir` or a `.keep` write, whichever `Files` offers); default `profile`: the first profile chat's settings list. Under the fake harness, the composer's text drives the turn (`fake: tool`, `fake: hold`, else an echo — `src/shared/fake-agent-harness.ts`); under `--harness claude` it is a real session in that folder.
- `chat.askPermission` `{ sessionId, toolName?, input? }` → raises a permission card through `askFixturePermission` (default `toolName` `Bash`, `input` `{ "command": "ls" }`, a fresh `toolUseId`); returns `{ toolUseId }` at once, the reply resolving when the user answers.
- `askFixturePermission` takes over the permission call inside `chatSelfTestScript`, which calls it and keeps its lines.

GIVEN a drive host WHEN chat starts THEN `chat.start` and `chat.askPermission` are added

Tests:     none (the actions are proved live in task 12, the shared fixture by the self-test; chat adds its actions in one `addDriveActions` called only inside `if (api.drive !== null)`, a review check)
Done when: typecheck and lint pass; `npm run selftest` passes with the chat lines unchanged
Commit:    one commit for the group

## Proof
`461984e` · proved: diff read against the spec, `askFixturePermission` present (narrowed, see the Run log's contract change), `addDriveActions` called only inside `if (api.drive !== null)`; typecheck clean; chat tests 145 passed; self-test lines ride to the test gate · concerns: arg readers `optionalString`/`requiredString` live in chat's `start.ts` (a shared drive-args reader may be wanted); `chat.askPermission` reads `(args as { input?: unknown }).input` without a null guard on `args`
