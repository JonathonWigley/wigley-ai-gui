# 02 — Relay channel and endpoint folder per app instance

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/main/relay/endpoint.ts` · modify `src/plugins/sessions/main/start.ts`
           · modify `src/plugins/sessions/contract.ts` (the `~/.agents/wigley-ai-gui/endpoint.json` comment)
           · test `src/plugins/sessions/main/relay/endpoint.test.ts` (create it if absent)
Consumes:  `MainServices.appInstance: AppInstance` ← 01
Produces:  `export function channelPath(platform: NodeJS.Platform, home: string, username: string, instanceId: string, tempDir?: string): string`
           in `src/plugins/sessions/main/relay/endpoint.ts`
Decisions: rounds go to stable by default, dev only through its own sessions or `WIGLEY_AI_GUI_ENDPOINT_DIR` (Q1) ·
           each instance its own relay (Q1)

**Changes**

- `channelPath` takes `instanceId` before the optional `tempDir`, and uses it everywhere it writes
  `wigley-ai-gui` today:
  - Windows pipe: `\\.\pipe\<instanceId>-<username>-<homeHash>`
  - Unix socket: `<home>/.agents/<instanceId>/app.sock`
  - temp socket: `<tempDir>/<instanceId>-<username>-<homeHash>.sock`
  - private folder: `/tmp/<instanceId>-<username>/<homeHash>.sock`
- `openRelay` passes `api.services.appInstance.id`.
- The endpoint folder in `sessionsMainPart.start` is `path.join(homeDir, '.agents', api.services.appInstance.id)`.
- `launchCommand` and `endedDriveRunLaunch` are unchanged: a stable app records its own exe, a dev app `npm start`.
- The `contract.ts` comment names `~/.agents/<instance id>/endpoint.json`.

GIVEN instance id `wigley-ai-gui-dev` on win32 WHEN `channelPath` runs THEN the pipe is `\\.\pipe\wigley-ai-gui-dev-<user>-<hash>`
GIVEN instance id `wigley-ai-gui` on darwin with a short home WHEN `channelPath` runs THEN the socket is `<home>/.agents/wigley-ai-gui/app.sock`
GIVEN the two instance ids on one platform and home WHEN `channelPath` runs for each THEN the two paths differ

Tests:     `channelPath_windows_namesPipeByInstance` — `channelPath('win32', 'C:\\Users\\u', 'u', 'wigley-ai-gui-dev')`
           starts with `\\.\pipe\wigley-ai-gui-dev-u-`;
           `channelPath_mac_putsSocketInInstanceFolder` — `channelPath('darwin', '/Users/u', 'u', 'wigley-ai-gui')`
           equals `/Users/u/.agents/wigley-ai-gui/app.sock`;
           `channelPath_instancesNeverShareAChannel` — stable and dev paths differ on win32 and on darwin.
           Existing callers' tests updated to pass an instance id.
Done when: `npm run typecheck` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

