# 04 — Chat main: past sessions, archive, resume, commands

Status: not started
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/start.ts` · create `src/plugins/chat/main/archived-sessions.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/archived-sessions.test.ts`
Consumes:  `PastSession`, `AgentHarness.listSessions(projectDir, profileDir)`, `AgentHarness.history(sessionId,
           projectDir, profileDir)` in `src/contracts/agent.ts` ← 03 · `FAKE_PAST_SESSIONS`, `pastSessionCalls`,
           `failNextHistory(message)` in `src/shared/fake-agent-harness.ts` ← 03 · `createMemoryFiles(clock?)` ← 01 ·
           from plan A, in the tree once it landed (its task 07 Produces): `ChatChannel`, `ChatSessionState`,
           `StartRequest` (`src/plugins/chat/contract.ts`); `ChatSessionsDeps`, `ChatSessions`, `createChatSessions`,
           `CHAT_HARNESS_ID` (`chat-sessions.ts`); `chatMainPart` and its `ChatApi` wiring (`start.ts`);
           `expandHome(value, homeDir)` (`src/shared/expand-home.ts`, plan A task 05); `SessionsMainEvents.connected`,
           `.ended`, `AgentSession` (`src/plugins/sessions/contract.ts`, tree) · in the tree: `Files`, `errorText`
Produces:  in `src/plugins/chat/contract.ts`:
           ```ts
           // `hostSessionId` is the harness's id for the saved session.
           export interface PastSessionRow { hostSessionId: string; title: string; modified: number; archived: boolean }
           export interface ResumeRequest { projectDir: string; profile: string; hostSessionId: string }
           ```
           `ChatSessionState` gains `commands: string[];` (comment: `` The session's slash commands and skills, as
           typed after `/`; [] until the harness reports them. ``)
           `ChatChannel.invoke` gains `pastSessions(projectDir: string, profile: string): Promise<PastSessionRow[]>;`
           (comment: `` Newest first; a session open in the app is left out. ``),
           `setArchived(hostSessionId: string, archived: boolean): Promise<void>;`,
           `resume(request: ResumeRequest): Promise<string>;` (comment: `` Resolves to the new row's sessionId. ``)
           `ChatChannel.messages` gains `commands: { sessionId: string; names: string[] };`
           in `src/plugins/chat/main/archived-sessions.ts`:
           ```ts
           export const ARCHIVED_SESSIONS_FILE = 'archived-sessions.json';
           export interface ArchivedSessions {
             // Rejects when the file holds anything but a JSON array of strings, naming the file.
             ids(): Promise<ReadonlySet<string>>;
             // Writes run one after another, each reading the file the last one wrote.
             set(hostSessionId: string, archived: boolean): Promise<void>;
           }
           export function createArchivedSessions(data: Files): ArchivedSessions;
           ```
           `ChatSessionsDeps` gains `archived: ArchivedSessions;` · `ChatSessions` gains
           `pastSessions(projectDir: string, profile: string): Promise<PastSessionRow[]>;`,
           `setArchived(hostSessionId: string, archived: boolean): Promise<void>;`,
           `resume(request: ResumeRequest): Promise<string>;`,
           `sessionConnected(session: AgentSession): void;` (the sessions plugin's `connected` event) and
           `sessionEnded(sessionId: string): void;` (its `ended` event)
Decisions: resume is its own invoke, not a field on `StartRequest`: reading the transcript is async and plan A's
           `start` is synchronous by design (07), so `start` keeps its contract and its tests ·
           archived ids are the user's state, so an unreadable `archived-sessions.json` is never overwritten:
           `ids()` rejects `archived-sessions.json is not a JSON array of session ids`, `set` rejects the same before
           writing; a missing file reads as empty; the file is a JSON array of host session ids in archiving order,
           written `JSON.stringify(ids, null, 2)`; `set(id, true)` on an archived id and `set(id, false)` on one not
           archived write nothing; Claude's transcripts are never touched (plan.md Archive) ·
           **open host ids**: `sessionConnected(session)` records `session.id` → `session.info.sessionId` when the
           host id is non-null; `sessionEnded(id)` drops it. Owned sessions emit both too (plan A task 03), so this is
           the one record of what the app has open, terminal sessions through the relay included. `start.ts` hears
           `api.events.on('sessions.connected', …)` and `api.events.on('sessions.ended', …)` onto them ·
           **`pastSessions(projectDir, profile)`**: the profile and harness found as `start` finds them (same throws:
           `chat has no profile "<name>"`, `no agent harness "claude"`), `profileDir` expanded as `start` expands it;
           then `harness.listSessions(projectDir, profileDir)` and `archived.ids()` together; rows in the harness's
           order minus every open host id, each `{ hostSessionId: sessionId, title, modified, archived:
           ids.has(sessionId) }` · **`setArchived`** passes straight to `archived.set` ·
           **`resume(request)`**, in this order so nothing opens when an input is wrong:
           1. profile and harness as `start` (same throws);
           2. a `hostSessionId` among the open host ids throws `session <hostSessionId> is already open in the app`;
           3. `entries = await harness.history(hostSessionId, projectDir, profileDir)`; a rejection logs `history of
              <hostSessionId> not read: <errorText>` under `chat` and `entries` is the one entry `{ kind: 'notice',
              id: 'history:unread', text: 'Earlier conversation not read: <errorText>', tone: 'error', raw: [] }`;
           4. from here exactly as `start`'s steps 3–6 with `hostId = hostSessionId` (no `randomUuid` call), the
              stored state's `entries` = `entries` (in `sessionStarted` too), and `harness.start({ sessionId:
              hostSessionId, resume: true, projectDir, profileDir }, events)`. `sessions.open` throwing (the host id
              opened while history was read) rethrows with nothing stored. The shared steps are one private helper
              both `start` and `resume` call, so the two never drift ·
           **commands**: the `commands(names)` event stores a copy as the state's `commands` and sends
           `commands { sessionId, names }`; an unchanged list (same names, same order) sends nothing; a dropped
           session's sends nothing; a new state starts with `commands: []` ·
           `start.ts` registers `pastSessions`, `setArchived`, `resume` straight onto the chat module and builds
           `createArchivedSessions(api.data)` into the deps
GIVEN no `archived-sessions.json` WHEN `ids()` runs THEN an empty set
GIVEN `set('s1', true)` then `set('s2', true)` then `set('s1', false)` WHEN they settle THEN the file holds `["s2"]`
GIVEN `set('s1', true)` twice started together WHEN both settle THEN the file holds `["s1"]`
GIVEN the file holds `{oops` WHEN `ids()` or `set('s1', true)` runs THEN it rejects `archived-sessions.json is not a JSON
      array of session ids` and the file still holds `{oops`
GIVEN the fake harness, `homeDir` `/Users/u`, `FAKE_PAST_SESSIONS[0]` archived, and a `sessions.connected` session `row-9`
      with host id `FAKE_PAST_SESSIONS[1].sessionId` WHEN `pastSessions('/w/app', 'personal')` runs THEN it returns
      `[{ hostSessionId: FAKE_PAST_SESSIONS[0].sessionId, title: 'fake past session one', modified: 1767323045000,
      archived: true }]` and the fake recorded `listSessions` with `projectDir: '/w/app'`, `profileDir:
      '/Users/u/.claude-personal'`
GIVEN that, then `sessionEnded('row-9')` WHEN `pastSessions` runs again THEN both fake sessions are listed
GIVEN profile `home` WHEN `pastSessions` or `resume` runs THEN it rejects `chat has no profile "home"` and the fake recorded
      no call
GIVEN the fake, `open` returning row `row-1` WHEN `resume({ projectDir: '/w/app', profile: 'work', hostSessionId:
      FAKE_PAST_SESSIONS[0].sessionId })` runs THEN it resolves `row-1`; `open` got `{ sessionId: <that id>, projectDir:
      '/w/app', deadlineSeconds: null, harness: 'claude' }`; `sessionStarted` carried the fake's two history entries
      (`history:<id>-user` `fake earlier message`, `history:<id>-assistant` `fake earlier reply`) and `commands: []`;
      the fake's last process request is `{ sessionId: <that id>, resume: true, projectDir: '/w/app', profileDir:
      '/Users/u/.claude' }`; `randomUuid` was not called; `recent-folders.json` names `/w/app` with `work`
GIVEN `failNextHistory('cannot read')` WHEN `resume` runs THEN it resolves, `sessionStarted`'s entries are exactly
      `[{ kind: 'notice', id: 'history:unread', text: 'Earlier conversation not read: cannot read', tone: 'error', raw:
      [] }]`, the log holds `history of <id> not read: cannot read` under `chat`, and the process started with
      `resume: true`
GIVEN a session `row-9` connected with host id `X` WHEN `resume` with `hostSessionId` `X` runs THEN it rejects `session X is
      already open in the app` and `history` was not called
GIVEN a started session WHEN the harness reports `commands(['compact', 'model'])` twice THEN the `commands` messages
      are, in order, `{ sessionId: 'row-1', names: ['fake-command'] }` (the fake's own emission after start) and one
      `{ sessionId: 'row-1', names: ['compact', 'model'] }`, and `sessions()[0].commands` is `['compact', 'model']`
Tests:     `archived-sessions.test.ts` (memory files): `ids_MissingFile_Empty`, `set_ArchiveThenRestore_KeepsOrder`,
           `set_ConcurrentSameId_WritesItOnce`, `idsAndSet_UnreadableFile_RejectAndKeepIt`
           `chat-sessions.test.ts` (plan A's harness of fakes, plus `createArchivedSessions` over its memory files):
           `pastSessions_LeavesOutOpenAndMarksArchived`, `pastSessions_AfterEnded_ListsItAgain`,
           `pastSessionsAndResume_UnknownProfile_RejectWithoutCalls`, `resume_OpensWithHistoryAndResumesTheProcess`,
           `resume_HistoryFails_NoticeAndStillResumes`, `resume_AlreadyOpen_Rejects`, `commands_StoredAndSentOnChange`
           (expects, in order, `{ sessionId: 'row-1', names: ['fake-command'] }` then `{ sessionId: 'row-1', names:
           ['compact', 'model'] }`, and `sessions()[0].commands` equal to `['compact', 'model']`)
           — every value above; plan A's `start_opensTheSessionAndStartsTheHarness` gains `commands: []` in its
           expected `sessionStarted`
Done when: the typecheck and `npm run lint` pass; the test gate runs both test files
Commit:    one commit for the group

## Proof
