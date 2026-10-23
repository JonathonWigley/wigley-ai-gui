# 01 — Harness seam: images, accounts, project folders

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-code-harness.ts` ·
           modify `src/main/claude-code/claude-controls.ts` · modify `src/main/claude-code/transcripts.ts` ·
           modify `src/main/claude-code/past-sessions.ts` · create `src/main/claude-code/claude-auth.ts` ·
           modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/chat-sessions.ts` (call site only) ·
           modify `src/plugins/chat/main/selftest-script.ts` (expectations only) ·
           test `src/main/claude-code/claude-auth.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts` ·
           test `src/main/claude-code/transcripts.test.ts` · test `src/main/claude-code/past-sessions.test.ts` ·
           test `src/shared/fake-agent-harness.test.ts`
Consumes:  `claudeLaunch`, `claudeConfigFolder` in `src/main/claude-code/claude-launch.ts` (tree);
           `Files.list`, `Files.readStart`, `Files.modified` (tree)
Produces:  in `src/contracts/agent.ts`:
           `export interface ChatImage { mediaType: string; data: string }`
           `export interface UserMessage { text: string; images: ChatImage[] }`
           the `user` member of `ChatEntry` becomes `{ kind: 'user'; id: string; text: string; images: ChatImage[]; raw: unknown[] }`
           `AgentProcess.send(message: UserMessage): void`
           `export interface AccountStatus { signedIn: boolean; account: string | null }`
           `export interface LogInEvents { link(url: string): void; ended(end: { status: AccountStatus | null; error: string | null }): void }`
           `export interface LogInProcess { sendCode(code: string): void; cancel(): void }`
           `export interface ProjectFolder { projectDir: string; modified: number }`
           on `AgentHarness`: `accountStatus(profileDir: string | null): Promise<AccountStatus>`,
           `logIn(profileDir: string | null, events: LogInEvents): LogInProcess`,
           `logOut(profileDir: string | null): Promise<void>`,
           `listProjects(profileDir: string | null): Promise<ProjectFolder[]>`
           in `src/main/claude-code/claude-auth.ts`: `export function readAccountStatus(stdout: string): AccountStatus`,
           `export function signInLink(output: string): string | null`
           in `src/shared/fake-agent-harness.ts`: `export const FAKE_SIGN_IN_URL = 'https://example.invalid/fake-sign-in'`,
           `export const FAKE_SIGN_IN_CODE = 'fake-code'`
Decisions: images ride `send` (round 2) · accounts and projects on `AgentHarness` (round 1, design review) ·
           confirm a sign-in with `accountStatus` (design review) · base64 without the `data:` prefix (round 2)
Done when: compiles (`npm run typecheck`); the test gate runs the tests below
Commit:    one commit for the group

## Items

**Contract.** Comments on each new type state its rules, in the file's style: `data` is base64 with no `data:`
prefix; `account` is the adapter's one-line label, null when signed out; `logIn` events arrive in a later
microtask, `ended` fires once, after `cancel` too; `sendCode` and `cancel` after `ended` do nothing;
`listProjects` is every folder with saved sessions under the profile, newest `modified` first, `[]` when none.

**Claude: messages with images.** `userMessage(text)` in `claude-controls.ts` becomes `userMessage(message: UserMessage)`:
content is the plain string when `images` is empty (the shape every existing probe used), otherwise an array of
`{ type: 'image', source: { type: 'base64', media_type, data } }` blocks in order, then one
`{ type: 'text', text }` block — omitted when `text` is empty. `send` emits the user entry with `images` and keeps the
`/effort`/`/model` match on `message.text`. `controlMessage` keeps sending plain text through the new shape.

**Claude: transcripts.** `addUserEntries` gives a user entry `images` from the line's `image` blocks whose source is
`base64` (`media_type` → `mediaType`); a line holding only images and no text still makes a user entry (text `''`).
Every other built user entry gets `images: []`. The `isMeta` `[Image: source: …]` companion line
(`claude-stream.md` § Images) makes no user entry; check what the reader does with `isMeta` lines today and keep the
line as a raw entry or skip it to match.

**Claude: accounts** (`claude-auth.ts` holds the parsing; the harness wires the processes through `deps.spawn` with
`claudeLaunch`'s environment rules — the nested-session strip and `CLAUDE_CONFIG_DIR` from `profileDir` — and
`cwd` the home folder):

- `accountStatus`: runs `claude auth status --json`; `readAccountStatus` reads `loggedIn` into `signedIn` and builds
  `account` as `<email> · Claude <subscriptionType>` when both are strings, `<email>` alone when only the email is,
  `null` when signed out. Unparseable output or a non-zero exit rejects naming the stderr.
- `logIn`: spawns `claude auth login`, stdin a pipe. `signInLink` takes the accumulated stdout and returns the URL
  after `visit: ` with the OSC 8 escape sequences stripped (the URL shows twice on the line; return it once), or
  null until that line is complete. `link` fires once. `sendCode(code)` writes `code` and a newline to stdin.
  On exit, run `accountStatus`: `ended({ status, error })` with `error` null when `status.signedIn`, else the last
  stderr line or `claude auth login exited with code <n>`; a failed status read gives `status: null` and its error.
  `cancel()` kills the process and fires `ended({ status: null, error: 'Sign-in cancelled' })` once.
- `logOut`: runs `claude auth logout`; resolves on exit 0, rejects naming the stderr otherwise.

**Claude: projects.** `listProjects` lists `<config>/projects/` (`claudeConfigFolder`), and for each project folder
reads the head (`TRANSCRIPT_HEAD_BYTES`) of its newest `<session-id>.jsonl` by modified time for the `cwd`
(`readTranscriptHead`); `modified` is that transcript's time. A folder with no readable transcript or no `cwd` is left
out and logged; a missing `projects/` lists none. Read folders `TRANSCRIPT_READ_BATCH` at a time, as
`listPastSessions` does.

**Fake.** `send(message)` records `{ method: 'send', text, imageCount }` in `calls` (update every expectation in
`selftest-script.ts` that reads `{ method: 'send', text }`) and emits the user entry with the message's images.
Accounts: every profile starts signed in as `fake@example.invalid`; `logOut` signs the profile out; `logIn` emits
`link(FAKE_SIGN_IN_URL)`, and `sendCode(FAKE_SIGN_IN_CODE)` signs in and ends with that status; any other code ends
with `error: 'Wrong code'` and `status` signed out; `cancel` as in the contract. `listProjects` returns the
`projectDir` of every session `start` ran under that profile, newest first, `modified` from a counter the fake
keeps (no clock read).

**Chat call site.** `chat-sessions.ts` `send(sessionId, text)` passes `{ text, images: [] }` to the process, so the
tree compiles; task 04 changes the channel.

## Tests

GIVEN a message with one PNG and text WHEN `userMessage` builds it THEN content is `[image block, text block]`
GIVEN a status JSON with `loggedIn: true`, email and `subscriptionType: "max"` WHEN read THEN `{ signedIn: true, account: '<email> · Claude max' }`

- `userMessage_WithImages_ImageBlocksThenText` — the array, media type and data as given
- `userMessage_TextOnly_PlainStringContent` — content is the string
- `readAccountStatus_SignedIn_LabelsEmailAndPlan` / `readAccountStatus_SignedOut_NullAccount` — built from JSON the
  test writes in the shape of `claude-stream.md` § Auth
- `signInLink_OscWrappedLine_ReturnsUrlOnce` — a line built with `\x1b]8;;<url>\x07<url>\x1b]8;;\x07` and with the
  `\x1b\\` terminator; `signInLink_NoVisitLine_Null`
- harness tests over a fake spawn: `logIn_ProcessExitsSignedIn_EndsWithStatus`, `logIn_Cancel_EndsOnceCancelled`,
  `logIn_SendCode_WritesCodeLine`
- `transcriptEntries_UserImageLine_EntryCarriesImages`, `transcriptEntries_ImageCompanionLine_NoUserEntry`
- `listProjects_NewestTranscriptCwd_PerFolder` over `memory-files` — two project folders, newest first
- fake: `logIn_RightCode_SignsIn`, `logOut_ThenStatus_SignedOut`, `listProjects_StartedFolders_NewestFirst`

## Proof
