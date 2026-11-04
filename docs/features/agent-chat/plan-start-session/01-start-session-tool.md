# 01 — The start_session tool

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/start-session-tool.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start-session-tool.test.ts` · test `src/plugins/chat/main/start.test.ts`

Consumes:  `sessions.contributeTools(tools, start)` · `ChatSessions.launch(request: LaunchRequest): string` · `ChatMainExports.profileOf` and `profileNames` · `services.files.stat` · `services.paths.isAbsolute` (all in the tree)

Produces:  in `src/plugins/chat/main/start-session-tool.ts`:
           `export const START_SESSION_TOOL: ToolDefinition`
           `export interface StartSessionToolDeps { launch(request: LaunchRequest): string; profileOf(sessionId: string): string | null; profileNames(): string[]; isAbsolute(path: string): boolean; stat(path: string): Promise<FileStat | null>; }`
           `export function startSessionToolSession(deps: StartSessionToolDeps): (session: AgentSession) => ToolSession`

Decisions:

- Name `start_session`. Schema properties: `prompt` (string, required), `folder` (string), `profile` (string). `additionalProperties: false`, as `set_session_title` has.
- The description states that the session opens in the background as a new row, that it spends plan usage, that `folder` must be absolute and exist, and that `folder` and `profile` default to the calling session's.
- Checks run in this order, and each stops the call: prompt, then profile, then folder (absolute, then `stat`). `stat` is not called when an earlier check fails.
- Missing, null or non-object `args` reads as no prompt, so the prompt error fires.
- A prompt that is not a string, or is empty after trimming, is an error result. The launch gets the prompt untrimmed, as `{ text: prompt, images: [] }`.
- `folder` or `profile` present but not a string, or blank after trimming, is an error result. Only an absent or null value takes the default, so a mistyped value never starts a session somewhere unintended.
- Profile: `args.profile`, else `deps.profileOf(session.id)`, else `deps.profileNames().at(0)`. Notes picks the same way in `src/plugins/notes/main/note-sender.ts`. A named profile absent from `profileNames()` is an error result listing the names. No profiles at all is an error result. The caller's own profile is trusted without a membership check: if settings have since removed it, `launch` throws and that message comes back as the launch error.
- Folder: `args.folder`, else `session.info.projectDir`. A session with neither is an error result asking for `folder`.
- The folder checks run on either source: not absolute is an error result, and `stat` null or `isFolder` false is an error result naming the path.
- `launch` runs inside a try/catch, since it throws synchronously. A throw is an error result carrying its message, logged by nothing here because chat logs its launches. A rejected `stat` is an error result carrying its message too.
- The success result is text only, exactly `Started session <id> in <folder> under profile <profile>.`, where `<id>` is the value `launch` returns.
- `call` rejects for any other tool name, and `end` does nothing, as `title-tool.ts` does.
- In `start.ts`, hoist the `exports` object's `profileOf` lambda into a const above both uses, and have `exports` reuse it. Pass deps as closures, so nothing reads a service at start time: `launch: (request) => chat.launch(request)`, the hoisted `profileOf`, the existing `profileNames`, `isAbsolute: (path) => services.paths.isAbsolute(path)` and `stat: (path) => services.files.stat(path)`. The contribution sits beside the `PERMISSION_TOOLS` one and must not move any existing start order.

GIVEN a call with only a prompt from a session chat owns WHEN it runs THEN a session starts in the caller's folder under the caller's profile, and the result names both
GIVEN a call from a session chat does not own WHEN it names no profile THEN the session starts under chat's first profile
GIVEN any bad argument or a failed launch WHEN the call runs THEN the result has `isError: true`, no session starts for a bad argument, and nothing throws

Tests:

- `start-session-tool.test.ts`, one table over the handler, with fakes for the deps. Each row has exactly one bad argument, and holds the args, the caller's folder and owned profile, the stat answer, and either the expected launch request and success text or an expected error fragment. Rows:
  - prompt only, owned caller: launches with the caller's folder and profile, and the result is `Started session <id> in <folder> under profile <profile>.` with those values
  - prompt only, unowned caller: launches under the first profile
  - folder and profile named, different from the caller's: launches with the named ones
  - unknown profile: error naming the known profiles, no launch
  - blank profile, non-string profile: error, no launch
  - no folder given and caller has none: error, no launch
  - blank folder, non-string folder: error, no launch
  - relative folder: error, no launch, `stat` not called
  - missing folder: error naming the path, no launch
  - path that is a file: error naming the path, no launch
  - `stat` rejects: error carrying its message, no launch
  - missing prompt, non-string prompt, blank prompt, null args: error, no launch, `stat` not called
  - launch throws: error carrying its message
  - no profiles and none named: error, no launch
- `start-session-tool.test.ts`, a second case: a name other than `start_session` rejects.
- `start.test.ts`, one row added: chat's start contributes a tool named `start_session`, and calling it through the recorded `start` from an unowned session with an absolute `projectDir` starts a session with the prompt as its first message. The break it catches is the contribution being dropped from `start.ts`. Fake changes: widen the `sessions` fake's `contributeTools` to record its arguments, and add `files.stat` (answering `{ isFolder: true, isLink: false }`) and `paths.isAbsolute` (answering true) to the `api.services` fake.

Done when: compiles; lint passes; the test gate runs the tests above

Commit:    one commit for the group

## Proof

