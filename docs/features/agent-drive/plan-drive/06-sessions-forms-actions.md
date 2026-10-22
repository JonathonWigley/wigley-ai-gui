# 06 — Sessions and forms drive actions

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/main/relay/endpoint.ts` · test `src/plugins/sessions/main/relay/endpoint.test.ts` · create `src/plugins/forms/main/fixtures.ts` · modify `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/forms/main/start.ts`
Consumes:  `MainApi.drive: DriveHost | null`, `DriveAction` ← 01 · `SessionsMainExports.connect`, `activate` (exist) · `PREVIEW_ROUND_ARGS` in `src/plugins/forms/main/preview/preview-round.ts` (exists)
Produces:  drive actions `sessions.connect`, `sessions.end`, `sessions.activate`, `forms.openRound`, `forms.answers`
           `export function connectFixtureSession(sessions: Pick<SessionsMainExports, 'connect'>, spec: { sessionId: string; projectDir: string | null; harness: Harness; deadlineSeconds: number | null }): ConnectedSession` and `export function askFixtureRound(session: ConnectedSession, round: unknown): Promise<ToolResult>` in `src/plugins/forms/main/fixtures.ts`
Decisions: first drive actions (design review) · fixture builders shared by the self-test script and the actions (design review) · Windows relay pipe named per home (design review)

## What changes

- **Actions** — each plugin adds its actions in one `addDriveActions(host, …)` function its `start` calls inside `if (api.drive !== null)`; each `args` string is a one-line JSON shape. Default session ids are `drive-session-<n>` (sessions) and `drive-forms-<n>` (forms), each counting from 1, so the two never share a host id.
  - `sessions.connect` `{ sessionId?, projectDir?: string | null, harness?: 'claude' | 'codex', deadlineSeconds?: number | null }` → connects a session with no round (defaults: project `drive`, harness `claude`, deadline null), keeps its `ConnectedSession` by `sessionId`, returns `{ sessionId, rowId }` (`rowId` is `connected.session.id`).
  - `sessions.end` `{ sessionId }` → ends a session `sessions.connect` made; unknown id rejects naming it.
  - `sessions.activate` `{ rowId }` → `activate(rowId)`.
  - `forms.openRound` `{ sessionId?, projectDir?, harness?, round? }` → asks `round` (default `PREVIEW_ROUND_ARGS`, the sample with every card kind) in the session forms itself opened earlier under `sessionId`, or connects a new one with the same defaults as `sessions.connect`; a `sessionId` forms never opened connects a new session under that id. Returns `{ sessionId, rowId }` without waiting for the answers. (Sessions from `sessions.connect` stay round-less; a check that needs two sessions with rounds opens both through `forms.openRound`.)
  - `forms.answers` `{ sessionId }` → the latest round asked in that session: its `ToolResult` once submit or cancel resolved it, else `{ pending: true }`; an id forms never opened rejects naming it.
- **fixtures.ts** — `connectFixtureSession` and `askFixtureRound` take over the `connect` and `ask` closures inside `formsSelfTestScript`; the self-test script calls them and keeps its behaviour and lines.
- **endpoint.ts** — on Windows `channelPath` names the pipe `wigley-ai-gui-<username>-<first 8 hex of sha256(home)>`, so a drive run's relay never takes the user's app's pipe. On macOS and Linux the socket stays `<home>/.agents/wigley-ai-gui/app.sock` while that path is at most 103 bytes (macOS's `sun_path` limit less the NUL; a drive run's home under `<repo>/.drive/<id>/home` measures 113 at plan time), and falls back to `/tmp/wigley-ai-gui-<username>-<first 8 hex of sha256(home)>.sock` past it. The relay reads the channel from `endpoint.json`, so the live name changing is harmless.

GIVEN macOS and a home whose socket path would be 113 bytes WHEN `channelPath` runs THEN it returns `/tmp/wigley-ai-gui-<username>-<8 hex>.sock`
GIVEN macOS and home `/Users/u` WHEN `channelPath` runs THEN it returns `/Users/u/.agents/wigley-ai-gui/app.sock`, as today
GIVEN Windows, home `C:\Users\u` and username `u` WHEN `channelPath` runs THEN the pipe is `\\.\pipe\wigley-ai-gui-u-` followed by the first 8 hex of sha256 of the home
GIVEN two different homes on Windows WHEN `channelPath` runs for each THEN the pipes differ

Tests:     `endpoint.test.ts`: the four cases above, updating the existing Windows expectation; the actions are proved live in task 12, and the null-host half (`addDriveActions` called only inside `if (api.drive !== null)`) is a review check
Done when: typecheck, lint and the tests pass; `npm run selftest` passes with the forms lines unchanged
Commit:    one commit for the group

## Proof
`5a1efc6` · proved: diff read against the spec, both fixture functions present with the planned signatures, `addDriveActions` gated on `api.drive !== null` in both plugins; typecheck clean; sessions and forms tests 678 passed; the relay reads the channel from `endpoint.json` (relay.py), so the Windows rename is safe; self-test lines ride to the test gate · concerns: sessions a drive action connected are not ended when the part disposes
