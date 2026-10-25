# 02 — Relay channel and endpoint folder per app instance

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/main/relay/endpoint.ts` · modify `src/plugins/sessions/main/start.ts`
           · modify `src/plugins/sessions/contract.ts` (the `~/.agents/wigley-ai-gui/endpoint.json` comment)
           · test `src/plugins/sessions/main/relay/endpoint.test.ts` · test `src/plugins/sessions/main/relay/relay-server.test.ts`
Consumes:  `MainServices.appInstance: AppInstance` ← 01
Produces:  `export function channelPath(platform: NodeJS.Platform, home: string, username: string, instanceId: string, tempDir?: string): string`
           in `src/plugins/sessions/main/relay/endpoint.ts`
           `export function launchCommand(env: NodeJS.ProcessEnv, execPath: string, cwd: string, isDev: boolean): RelayEndpoint['launch']`
           in the same file
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
- `launchCommand` takes `isDev` and records `npm start` only when `isDev` and npm started the run; a stable app
  records its own exe however it was started. `install-app` starts the stable app from under `npm run`, so its
  environment carries `npm_execpath`; without this a relay would later start the dev app in the stable app's place
  (cold reader, Decided). `openRelay` passes `api.services.appInstance.isDev`. `endedDriveRunLaunch` is unchanged.
- **Silent call sites:** inserting `instanceId` before the optional `tempDir` keeps every 4-argument call compiling
  with the wrong meaning, so the type checker finds only the 3-argument ones. Insert an instance id before `tempDir`
  in each 4-argument call by hand: at plan time `relay-server.test.ts:71` and `endpoint.test.ts:70`, `:85`, `:102`
  (measured at plan time, re-verify with `grep -rn "channelPath(" src`).
- The `contract.ts` comment names `~/.agents/<instance id>/endpoint.json`.

GIVEN instance id `wigley-ai-gui-dev` on win32 WHEN `channelPath` runs THEN the pipe is `\\.\pipe\wigley-ai-gui-dev-<user>-<hash>`
GIVEN instance id `wigley-ai-gui` on darwin with a short home WHEN `channelPath` runs THEN the socket is `<home>/.agents/wigley-ai-gui/app.sock`
GIVEN the two instance ids on one platform and home WHEN `channelPath` runs for each THEN the two paths differ

Tests:     `channelPath_windows_namesPipeByInstance` — `channelPath('win32', 'C:\\Users\\u', 'u', 'wigley-ai-gui-dev')`
           starts with `\\.\pipe\wigley-ai-gui-dev-u-`;
           `channelPath_mac_putsSocketInInstanceFolder` — `channelPath('darwin', '/Users/u', 'u', 'wigley-ai-gui')`
           equals `/Users/u/.agents/wigley-ai-gui/app.sock`;
           `channelPath_instancesNeverShareAChannel` — stable and dev paths differ on win32 and on darwin;
           `launchCommand_stableUnderNpm_recordsExecPath` — npm vars set, `isDev` false → `{ command: [execPath], cwd }`;
           `launchCommand_devUnderNpm_recordsNpmStart` — npm vars set, `isDev` true → `[node, npm, 'start']`.
           Existing callers' tests updated to pass an instance id.
Done when: `npm run typecheck` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit ef896213 · proof: diff read: channelPath(…, instanceId, tempDir?) and launchCommand(…, isDev) as planned; every 4-arg call site carries an instance id (grep); worker: typecheck, oxfmt/oxlint, endpoint + relay-server tests pass · concerns: channelPath doc comment reflow leaves a short broken line (lead)
