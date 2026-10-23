# 04 — Chat main: image messages, notices, sign-in, merged folders

Status: not started
Type: Batch
Wave: 2 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/start.ts` · create `src/plugins/chat/main/accounts.ts` ·
           create `src/plugins/chat/main/folder-choices.ts` · modify `src/plugins/chat/page/chat-commands.ts`
           (the `send` call only) · test `src/plugins/chat/main/accounts.test.ts` ·
           test `src/plugins/chat/main/folder-choices.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `UserMessage`, `AccountStatus`, `LogInEvents`, `LogInProcess`, `ProjectFolder`,
           `AgentHarness.accountStatus` / `logIn` / `logOut` / `listProjects` ← 01 ·
           `MainServices.tempFolders` ← 03 · `RecentFolders.list` (tree) · `Files.stat`, `Paths.isInside`,
           `Paths.samePath` (tree)
Produces:  in `src/plugins/chat/contract.ts`, on `ChatChannel['invoke']`:
           `send(sessionId: string, message: UserMessage): void` (replaces the text form)
           `notice(sessionId: string, text: string, tone: 'info' | 'error'): void`
           `accountStatus(profile: string): Promise<AccountStatus>`
           `logIn(profile: string): void`
           `logInCode(code: string): void`
           `cancelLogIn(): void`
           `logOut(profile: string): Promise<void>`
           on `ChatChannel['messages']`:
           `logInLink: { profile: string; url: string }`
           `logInEnded: { profile: string; status: AccountStatus | null; error: string | null }`
           `recentFolders()` keeps its signature and returns the merged list
           in `src/plugins/chat/main/accounts.ts`: `export interface Accounts { status(profile: string): Promise<AccountStatus>; logIn(profile: string): void; sendCode(code: string): void; cancel(): void; logOut(profile: string): Promise<void> }`,
           `export function createAccounts(deps: { harness: AgentHarness; profiles(): readonly ChatProfile[]; send: MainChannel<ChatChannel>['send']; log: Log }): Accounts`
           in `src/plugins/chat/main/folder-choices.ts`: `export function mergeFolderChoices(recent: readonly RecentFolder[], projects: readonly { profile: string; folder: ProjectFolder }[], paths: Paths): RecentFolder[]`,
           `export function createFolderChoices(deps: { recent: RecentFolders; harness: AgentHarness; profiles(): readonly ChatProfile[]; files: Pick<Files, 'stat'>; paths: Paths; tempFolders: readonly string[]; log: Log }): { list(): Promise<RecentFolder[]> }`
           on `ChatSessions` in `chat-sessions.ts`: `send(sessionId: string, message: UserMessage): void`,
           `notice(sessionId: string, text: string, tone: 'info' | 'error'): void`
Decisions: one sign-in at a time, owned by chat main (design review) · notices main-kept so a reload keeps them
           (design review) · merged list keeps each folder's newest use and that use's profile (round 1) ·
           the harness is the one `CHAT_HARNESS_ID` names, as `start` finds it today
Done when: compiles; the test gate runs the tests below
Commit:    one commit for the group

## Items

**Image messages.** `ChatSessions.send` and the channel's `send` take `UserMessage` and pass it to the process.
The page's `send` call in `chat-commands.ts` sends `{ text, images: [] }` until task 06 attaches images.

**Notices.** `ChatSessions.notice` adds `{ kind: 'notice', id: 'app-notice-<n>', text, tone, raw: [] }` (`n` a
counter per session) to the held session's entries and sends it on `entry`, the way harness entries travel, so
`sessions()` after a reload returns it. A session chat no longer holds is logged and ignored, as `send` does
(`heldFor`).

**Accounts** (`accounts.ts`). The profile name maps to its `configDir` through `profiles()`; an unknown name rejects
(or throws, for `logIn`) naming it. `logIn` throws `A sign-in is already running for <profile>` while one runs;
otherwise it starts `harness.logIn`, forwards `link` as `logInLink`, and on `ended` sends `logInEnded` and forgets the
running sign-in. `sendCode` and `cancel` with no sign-in running are logged and ignored. `status` and `logOut` call
the harness with the profile's folder. Log each start, end and refusal under `chat`.

**Merged folders** (`folder-choices.ts`). `list()` reads `recent.list()` and every profile's
`harness.listProjects(configDir)` at once; a profile whose listing rejects is logged and contributes none.
`mergeFolderChoices` is the pure part: one `RecentFolder` per folder (`paths.samePath`), keeping the entry with the
greatest `lastUsed` (a project's `modified` is its `lastUsed`, its profile the profile it was listed under), and its
spelling; sorted newest first; at most `MAX_RECENT_FOLDERS` × 2 entries (40; a constant in `folder-choices.ts`).
`list()` then drops each folder `paths.isInside` any of `tempFolders` (or equal to one), and each folder whose
`files.stat` is null; stat calls run at once. The `recentFolders` channel handler serves `list()`. Recording a
start in `recent-folders.json` is unchanged.

**Wiring** (`main/start.ts`): handlers for every new channel call; `createAccounts` and `createFolderChoices` built
beside `createRecentFolders` with `services.tempFolders`, `services.files`, the harness found by `CHAT_HARNESS_ID`.

## Tests

GIVEN recent `/a` (personal, lastUsed 5) and project `/a` listed under work with modified 9 WHEN merged THEN one `/a` entry, profile work, lastUsed 9
GIVEN a sign-in running WHEN `logIn` runs again THEN it throws and the harness starts no second sign-in

- `mergeFolderChoices_SameFolderTwice_KeepsNewestUse` — the GIVEN above
- `mergeFolderChoices_NewestFirst` — three folders the test builds, order by lastUsed
- `list_TempAndMissingFolders_LeftOut` — memory files holding `/p`; projects `/p`, `/gone`, `/tmp/x` with
  `tempFolders: ['/tmp']`; result holds `/p` alone
- `list_ProfileListingRejects_OthersStillListed`
- `logIn_WhileRunning_Throws`; `logIn_Ended_SendsLogInEndedAndAllowsAnother`; `logIn_Link_SendsLogInLink` — over the
  fake harness and a recording `send`
- `notice_AddsEntryKeptBySessions` — `sessions()` holds the notice after `notice`
- `send_PassesImagesToProcess` — the fake's `calls` hold `imageCount: 1`

## Proof
