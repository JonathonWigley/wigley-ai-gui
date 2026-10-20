# 03 — Harness: past sessions and history

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · create `src/main/claude-code/transcripts.ts` ·
           create `src/main/claude-code/past-sessions.ts` · create `src/main/claude-code/tool-result-text.ts` ·
           modify `src/main/claude-code/stream-decoder.ts` · modify `src/main/claude-code/claude-code-harness.ts` ·
           modify `src/shared/fake-agent-harness.ts` · modify `src/main/main.ts` ·
           test `src/main/claude-code/transcripts.test.ts` · test `src/main/claude-code/past-sessions.test.ts` ·
           test `src/main/claude-code/claude-code-harness.test.ts` (its deps gain the two fields) ·
           test `src/shared/fake-agent-harness.test.ts`
Consumes:  `Files.modified(path)`, `Files.readStart(path, maxBytes)`, `createMemoryFiles(clock?: Clock)` ← 01 ·
           from plan A, in the tree once it landed (plan A plan.md File Structure; its task 06 and 05 Produces):
           `AgentHarness`, `ChatEntry`, `AgentStart` (`src/contracts/agent.ts`);
           `ClaudeCodeHarnessDeps`, `createClaudeCodeHarness(deps)` (`claude-code-harness.ts`);
           `createStreamDecoder()` and its `tool_result` text rule (`stream-decoder.ts`);
           `toolSummary(name: string, input: unknown): string` (`tool-summary.ts`);
           `createFakeAgentHarness(): FakeAgentHarness`, `FakeAgentHarness` (`src/shared/fake-agent-harness.ts`);
           main.ts's `agentHarnesses` list holding `createClaudeCodeHarness({ command, permissionTool, env, log, spawn })` ·
           in the tree: `Files`, `Log`, `errorText` (`src/shared/error-text.ts`), main.ts's `files` and `inputs.homeDir`
Produces:  in `src/contracts/agent.ts`:
           ```ts
           // A session the harness saved for a folder. `title` is its first user message, whitespace collapsed to
           // single spaces, at most 80 characters (a longer one is its first 79 and `…`), or `Untitled session`;
           // `modified` is the transcript's last change, epoch milliseconds.
           export interface PastSession { sessionId: string; title: string; modified: number }
           ```
           on `AgentHarness`, with these comments:
           ```ts
           // Every session the harness saved for `projectDir` under `profileDir`, newest first; [] when none.
           listSessions(projectDir: string, profileDir: string | null): Promise<PastSession[]>;
           // The saved session's conversation as chat entries, oldest first. Rejects naming the path when the
           // transcript is missing.
           history(sessionId: string, projectDir: string, profileDir: string | null): Promise<ChatEntry[]>;
           ```
           in `src/main/claude-code/transcripts.ts`:
           `export const TRANSCRIPT_HEAD_BYTES = 65536;` · `export const TITLE_LENGTH = 80;` ·
           `export const UNTITLED_SESSION = 'Untitled session';` · `export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;`
           `export function projectFolderName(projectDir: string): string`
           `export interface TranscriptHead { cwd: string | null; firstMessage: string | null }`
           `export function readTranscriptHead(head: string): TranscriptHead`
           `export function sessionTitle(message: string | null): string`
           `export function transcriptEntries(text: string): ChatEntry[]`
           in `src/main/claude-code/past-sessions.ts`:
           `export interface PastSessionsDeps { files: Files; log: Log }`
           `export function listPastSessions(deps: PastSessionsDeps, projectsFolder: string, projectDir: string): Promise<PastSession[]>`
           `export function readHistory(files: Files, projectsFolder: string, sessionId: string): Promise<ChatEntry[]>`
           in `src/main/claude-code/tool-result-text.ts`: `export function toolResultText(content: unknown): string`
           `ClaudeCodeHarnessDeps` gains `files: Files; homeDir: string`
           in `src/shared/fake-agent-harness.ts`:
           `export const FAKE_PAST_SESSIONS: readonly PastSession[]` (values below) ·
           `FakeAgentHarness` gains `readonly pastSessionCalls: readonly FakePastSessionCall[]` and
           `failNextHistory(message: string): void`, with
           `export interface FakePastSessionCall { method: 'listSessions' | 'history'; sessionId: string | null; projectDir: string; profileDir: string | null }`
Decisions: Claude's transcript format is undocumented, so it is read in `transcripts.ts` alone, as pure functions over
           text (plan.md Locality) · read `docs/features/agent-chat/claude-stream.md` first; a transcript fact below
           it contradicts is applied as recorded there and logged under Rulings ·
           every `AgentHarness` literal the compiler flags (plan A's `isFakeAgentHarness` negative case in
           `src/shared/fake-agent-harness.test.ts` included) gains `listSessions: async () => []` and `history: async
           () => []` ·
           **Observed at plan time, re-verify** (Claude Code 2.1.304, `~/.claude-personal/projects/`): a transcript is
           `<config>/projects/<folder>/<session id>.jsonl`, one JSON object per line, with a folder `<session id>/`
           beside it (`subagents/`, `tool-results/`) that is not a transcript; the folder is the project path with
           `/` and `.` turned to `-` (`/Users/jonathonwigley/.claude` → `-Users-jonathonwigley--claude`); line
           `type`s seen: `user`, `assistant`, `attachment`, `system` (subtypes `local_command`, `turn_duration`,
           `stop_hook_summary`, `compact_boundary`), `mode`, `permission-mode`, `atis-latch`, `isolation-latch`,
           `file-history-snapshot`, `file-history-delta`, `last-prompt`, `queue-operation`, `api-request`,
           `api-request-blob`, `api-request-shape`, `ai-title`, `custom-title`, `agent-name`, `cost-state`;
           conversation lines carry `uuid`, `cwd`, `sessionId`, `timestamp`, `isSidechain`, `message` (`role`,
           `content`), and `user` lines may carry `isMeta: true` (skill bodies, command caveats); each `assistant`
           line holds exactly one content block (`text` with `text`; `thinking` with `thinking` and `signature`, the
           `thinking` text empty in 77 of 92 blocks measured; `tool_use` with `id`, `name`, `input`); `user` content
           is a string or blocks (`text`, `tool_result` with `tool_use_id`, `content` string or blocks, optional
           `is_error`); a slash command's `user` line is a string holding `<command-name>/x</command-name>`,
           `<command-message>`, `<command-args>`; a `system` `local_command` line holds `content`
           `<local-command-stdout>…</local-command-stdout>`; the first user line began within the first 2300 bytes of
           every transcript measured (6 files) ·
           `projectFolderName`: every character outside `[A-Za-z0-9]` becomes `-` · the profile's config folder is
           `profileDir`, else `deps.env.CLAUDE_CONFIG_DIR` when set, else `<homeDir>/.claude` — the same folder
           `claudeLaunch` points the CLI at; `projectsFolder` = `<config>/projects/<projectFolderName(projectDir)>` ·
           **user text** (one private helper both readers use): a `user` line with `isMeta: true` or `isSidechain:
           true` has none; string content opening (after leading whitespace) with `<local-command-caveat>` or
           `<local-command-stdout>` has none; string content holding `<command-name>` is that tag's text, then one
           space and the `<command-args>` tag's text when it is non-empty after trimming; other string content is
           itself; block content is its `text` blocks' texts joined with `\n`, `[image]` for an `image` block, none
           when it holds no `text` block (a tool-result line) ·
           `readTranscriptHead(head)`: splits on `\n` and parses each piece, skipping pieces that do not parse (the cut
           last line); `cwd` = the `cwd` of the first parsed line carrying a string `cwd`; `firstMessage` = the first user text ·
           `sessionTitle(message)`: null → `UNTITLED_SESSION`; else whitespace runs → one space, trimmed; longer than
           `TITLE_LENGTH` → the first 79 characters and `…`; empty after trimming → `UNTITLED_SESSION` ·
           `listPastSessions`: `files.list(projectsFolder)` (not recursive; a missing folder lists `[]`); keeps
           entries of kind `file` whose path is `<id>.jsonl` with `SESSION_ID` matching `id`; for each, in parallel,
           `readStart(path, TRANSCRIPT_HEAD_BYTES)` and `modified(path)`; one whose reads reject is left out and logs
           `transcript <path> unreadable: <errorText>` under source `claude`; one whose head `cwd` is not exactly
           `projectDir` (null included) is left out, silently; the rest become `{ sessionId: id, title:
           sessionTitle(firstMessage), modified }`, sorted by `modified` descending, then `sessionId` ascending ·
           `readHistory`: an id `SESSION_ID` does not match rejects `not a Claude session id: <id>` before any read (the id
           becomes a path); then `transcriptEntries(await files.read(<projectsFolder>/<id>.jsonl))` ·
           **`transcriptEntries(text)`**, line `n` counting from 1, blank lines skipped, every id starting `history:`:
           - not JSON → `{ kind: 'raw', id: 'history:line-<n>', raw: [line text] }`
           - `isSidechain: true` → nothing
           - `type` in `SKIPPED_LINE_TYPES` (a module constant: `attachment`, `mode`, `permission-mode`, `atis-latch`,
             `isolation-latch`, `file-history-snapshot`, `file-history-delta`, `last-prompt`, `queue-operation`,
             `api-request`, `api-request-blob`, `api-request-shape`, `ai-title`, `custom-title`, `agent-name`,
             `cost-state`) → nothing
           - `system` with subtype `local_command` and string `content` holding `<local-command-stdout>` → `{ kind:
             'notice', id: 'history:<uuid>', text: <the content with both stdout tags removed, trimmed>, tone: 'info',
             raw: [line] }`, nothing when that text is empty; every other `system` line → nothing
           - `user` with user text → `{ kind: 'user', id: 'history:<uuid>', text, raw: [line] }`; each `tool_result`
             block → the tool entry with that `toolUseId` gets `result: { text: toolResultText(block.content),
             isError: block.is_error === true }` and the line appended to its `raw`; a `tool_use_id` with no tool
             entry → `{ kind: 'raw', id: 'history:<uuid>-<block index>', raw: [line] }`; a `user` line with neither
             (an `isMeta` line, a caveat) → nothing
           - `assistant`, for content block `i`: `text` → `{ kind: 'assistant', id: 'history:<uuid>-<i>', text,
             streaming: false, raw: [line] }`; `thinking` with non-empty `thinking` → `{ kind: 'thinking', id:
             'history:<uuid>-<i>', text: thinking, streaming: false, raw: [line] }`, empty → nothing; `tool_use` →
             `{ kind: 'tool', id: 'history:<uuid>-<i>', toolUseId: block.id, name: block.name, input: block.input,
             summary: toolSummary(block.name, block.input), result: null, raw: [line] }`; any other block type →
             `{ kind: 'raw', id: 'history:<uuid>-<i>', raw: [line] }`
           - a `user` or `assistant` line whose `message.content` is neither a string nor an array, or with no string
             `uuid`, and any line whose `type` none of the rules name → `{ kind: 'raw', id: 'history:line-<n>', raw:
             [line] }`
           (`line` in `raw` is the parsed object) ·
           `toolResultText(content)`: plan A's decoder rule moved, not rewritten — the string itself, or the `text`
           blocks' texts joined by `\n` with any other block written `[<type>]`; `stream-decoder.ts` calls it, and
           its tests stay as they are ·
           the harness's `listSessions` and `history` call `listPastSessions({ files: deps.files, log: deps.log }, …)`
           and `readHistory(deps.files, …)`; main.ts passes `files` and `inputs.homeDir` to `createClaudeCodeHarness` ·
           **fake**: `FAKE_PAST_SESSIONS` = `[{ sessionId: '00000000-0000-4000-8000-000000000001', title: 'fake past
           session one', modified: 1767323045000 }, { sessionId: '00000000-0000-4000-8000-000000000002', title: 'fake
           past session two', modified: 1767236645000 }]`; `listSessions` returns a copy of it for every folder and
           profile; `history(id, …)` for one of those ids returns `[{ kind: 'user', id: 'history:<id>-user', text:
           'fake earlier message', raw: [{ fake: 'history-user' }] }, { kind: 'assistant', id: 'history:<id>-assistant',
           text: 'fake earlier reply', streaming: false, raw: [{ fake: 'history-assistant' }] }]`, and for any other id
           rejects `fake agent has no saved session <id>`; `failNextHistory(message)` makes the next `history`
           reject `new Error(message)`; each call pushes its `FakePastSessionCall` first (`sessionId` null for
           `listSessions`)
GIVEN `projectFolderName('/Users/jonathonwigley/.claude')` THEN `-Users-jonathonwigley--claude`; `'/a/b_c d'` THEN `-a-b-c-d`
GIVEN a head whose lines are `{"type":"mode"}`, a `user` line with `cwd: '/w/app'` and `isMeta: true`, a `user` line with
      content `<command-message>wigley:feature</command-message>\n<command-name>/wigley:feature</command-name>\n<command-args>add a hello command</command-args>`,
      and a cut last line `{"type":"user","mess` WHEN `readTranscriptHead` runs THEN `{ cwd: '/w/app', firstMessage:
      '/wigley:feature add a hello command' }`
GIVEN a head with a `<local-command-caveat>` user line then a user line `fix   the\n bug` THEN `firstMessage` is `fix the\n bug`
      and `sessionTitle` of it is `fix the bug`
GIVEN a head with no `user` line THEN `firstMessage` null, and `sessionTitle(null)` is `Untitled session`
GIVEN `sessionTitle` of 100 `a`s THEN 79 `a`s followed by `…`; of 80 `a`s THEN the 80 `a`s
GIVEN a transcript of: a user line `u1` `hi`, an assistant `a1` thinking `''`, an assistant `a2` text `hello`, an assistant
      `a3` tool_use `t1` `Bash` `{ command: 'ls' }`, a user `u2` tool_result `t1` content `out`, a user `u3` tool_result
      `t9` content `x`, the text `not json` on line 7, a `{"type":"mode"}` line, a `{"type":"brand-new"}` line on line 9,
      and a user line with `isSidechain: true` WHEN `transcriptEntries` runs THEN entries are, in order: user
      `history:u1` `hi`; assistant `history:a2-0` `hello` streaming false; tool `history:a3-0` toolUseId `t1` summary
      `ls` result `{ text: 'out', isError: false }` with `raw` the `a3` and `u2` lines; raw `history:u3-0`; raw
      `history:line-7` with raw `['not json']`; raw `history:line-9`
GIVEN a `system` `local_command` line `s1` with content `<local-command-stdout>Set model to opus</local-command-stdout>`
      THEN one notice `history:s1` `Set model to opus` tone `info`
GIVEN memory files at clock 1000 with `<folder>/aaaaaaaa-0000-4000-8000-000000000001.jsonl` (cwd `/w/app`, first message
      `old`), at clock 2000 `…0002.jsonl` (cwd `/w/app`, first message `new`), `…0003.jsonl` (cwd `/w/other`),
      `notes.txt`, and `…0001/subagents/agent-x.jsonl` WHEN `listPastSessions(deps, folder, '/w/app')` runs THEN it
      returns `[{ sessionId: '…0002', title: 'new', modified: 2000 }, { sessionId: '…0001', title: 'old', modified: 1000 }]`
GIVEN no folder WHEN `listPastSessions` runs THEN `[]`
GIVEN `files` whose `readStart` rejects `boom` for one transcript WHEN `listPastSessions` runs THEN that one is left out,
      the others are listed, and the log holds `transcript <path> unreadable: boom` under `claude`
GIVEN `readHistory(files, folder, '../x')` THEN it rejects `not a Claude session id: ../x` and `files.read` saw no call
GIVEN no transcript for a valid id WHEN `readHistory` runs THEN it rejects with a message naming `<folder>/<id>.jsonl`
GIVEN the Claude harness with `homeDir` `/Users/u`, `env` `{}` and a transcript under
      `/Users/u/.claude/projects/-w-app/` WHEN `listSessions('/w/app', null)` runs THEN it lists that session; with
      `env.CLAUDE_CONFIG_DIR` `/c` it reads `/c/projects/-w-app/`; with `profileDir` `/p` it reads `/p/projects/-w-app/`
GIVEN the fake WHEN `listSessions('/a', '/p')` runs THEN it returns `FAKE_PAST_SESSIONS` and `pastSessionCalls` holds
      `{ method: 'listSessions', sessionId: null, projectDir: '/a', profileDir: '/p' }`
GIVEN the fake WHEN `history('00000000-0000-4000-8000-000000000001', '/a', null)` runs THEN it returns the two pinned
      entries; for `nope` it rejects `fake agent has no saved session nope`; after `failNextHistory('cannot read')`
      the next call rejects `cannot read` and the one after succeeds
Tests:     `transcripts.test.ts` (every line built in the test as a JSON object then `JSON.stringify`, no copied
           transcript): `projectFolderName_ReplacesEveryNonAlphanumeric`, `readTranscriptHead_SlashCommand_TitlesNameAndArgs`,
           `readTranscriptHead_SkipsCaveatAndMeta`, `readTranscriptHead_NoUserLine_NullMessage`,
           `sessionTitle_LongMessage_CutTo80WithEllipsis` (both lengths), `sessionTitle_Null_Untitled`,
           `transcriptEntries_Conversation_BuildsEntriesInOrder` (every entry and field above),
           `transcriptEntries_LocalCommand_AddsNotice`
           `past-sessions.test.ts` (memory files with a clock the test moves; a `Files` wrapper the test writes for the
           rejecting `readStart`): `listPastSessions_NewestFirstForTheFolderOnly`, `listPastSessions_MissingFolder_Empty`,
           `listPastSessions_UnreadableTranscript_LeftOutAndLogged`, `readHistory_BadId_RejectsBeforeReading`,
           `readHistory_Missing_RejectsNamingThePath`
           `claude-code-harness.test.ts`: `listSessions_ProfileOrEnvOrHomeConfigFolder` (the three folders above)
           `fake-agent-harness.test.ts`: `listSessions_ReturnsTheFakeSessionsAndRecords`,
           `history_KnownUnknownAndFailNext` — the values above
Done when: the typecheck and `npm run lint` pass; `grep -rn "projects/" src --include='*.ts' | grep -v "\.test\.ts"` lists
           only `src/main/claude-code/`; the test gate runs the tests above with plan A's adapter and fake tests
Commit:    one commit for the group

## Proof
