# Agent chat B — resume and completion — plan

Feature: agent chat · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui · Written: 2026-10-20

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

After the folder and profile, the start prompt (`Space k n`) offers "New session" first, then every session Claude
saved for that folder in that profile — terminal and app sessions alike, newest first, each labelled by its first
user message and time, one the app has open now left out. Picking one resumes it, and its Chat tab shows the earlier
conversation read from Claude's transcript. In that list `x` archives the entry under the cursor and `.` shows the
archived entries, where `x` restores one; Claude's transcript files are never changed. In the message box, `/` typed
at its start offers the session's slash commands and skills through CodeMirror's completion, accepted with Tab.

## Architecture

Systems touched:

- **files service** (`src/contracts/files.ts`, `src/main/files/node-files.ts`, `src/shared/memory-files.ts`,
  `src/shared/scoped-files.ts`): `modified` and `readStart`, so the Claude adapter lists megabyte transcripts without
  reading them whole.
- **editor seam** (`src/contracts/editor.ts`, `src/renderer/codemirror-vim/`, `package.json`, `package-lock.json`,
  `scripts/check-layers.mts`): an `EditorOptions.completions` option, served by `@codemirror/autocomplete` inside the
  adapter alone.
- **agent harness seam** (`src/contracts/agent.ts`, `src/main/claude-code/`, `src/shared/fake-agent-harness.ts`,
  `src/main/main.ts`): `PastSession`, `AgentHarness.listSessions` and `AgentHarness.history`; Claude's transcript
  format stays inside the Claude adapter.
- **chat plugin** (`src/plugins/chat/`): archived sessions in its data, the resume list in the start prompt, resume
  with history, the session's commands reaching the Chat tab's box, its self-test steps.

## Preconditions

Each re-run by `wigley:make` before the first dispatch (paths from the repo root):

- Docs-ahead commit present: `git log --oneline | grep -c 376f1cc` → 1.
- Plan A landed — its plan folder closed or every box ticked:
  `if test -e docs/features/agent-chat/plan-a-loop/plan.md; then grep -c "^- \[ \]" docs/features/agent-chat/plan-a-loop/plan.md; else echo closed; fi`
  → `closed` or `0`.
- Plan A's Produces this plan builds on exist:
  - `test -d src/main/claude-code && test -e src/shared/fake-agent-harness.ts && test -e src/plugins/chat/contract.ts && test -e src/plugins/chat/main/selftest-script.ts && echo ok` → `ok`.
  - `grep -c "interface AgentHarness" src/contracts/agent.ts` → 1; `grep -c "commands(names: string\[\]): void" src/contracts/agent.ts` → 1;
    `grep -c "resume: boolean" src/contracts/agent.ts` → 1.
  - The adapter resumes: `grep -rn -- "--resume" src/main/claude-code` → at least one line outside tests.
  - `grep -c "interface StartRequest" src/plugins/chat/contract.ts` → 1; `grep -c "recentFolders()" src/plugins/chat/contract.ts` → 1.
  - `grep -c "export function toolSummary" src/main/claude-code/tool-summary.ts` → 1; `grep -c "export function openStartPrompt" src/plugins/chat/page/start-prompt.ts`
    → 1; `grep -c "cursorIndex" src/plugins/chat/page/picker.ts` → 0; `grep -c "createEditor\|editor.create(" src/plugins/chat/page/chat-view.ts` → ≥ 1
    (the Chat tab's box, plan A task 09).
- Plan A landed with changes these tasks were written without; its plan folder is deleted, so where a task cites
  plan A's plan.md, File Structure or a task's Produces, read the code instead. Changes that bear on this plan:
  `EditorBind` gains `mode?: 'normal' | 'insert'` (an insert bind is one key the host types unbound, today only
  `<CR>`; chat's picker filter binds it); the core `jk` insert remap is gone (Esc leaves insert mode, and self-test
  text may hold `j`); chat keys act only on the visible Chat tab's session, and showing another session's Chat tab
  closes the control pickers (`PickerRequest.sessionBound`), the reason box and the confirm; `PERMISSION_TOOL_NAME`
  and `CLAUDE_PERMISSION_TOOL` live in `src/contracts/agent.ts`; `isMissingFile` is in `src/contracts/files.ts`;
  `AgentProcess.end()` resolves after `ended` fires; chat main's `setControl` throws for a session it no longer
  holds; the stream decoder folds related events into their entries and gathers the rest into one
  `turn-events-<n>` entry per turn (opened at the turn's init; between-turn events join the ended turn's); the
  harness counts outstanding turns (`claude-stream.md` § Queued messages); the launch strips the nested-session
  environment (`claude-stream.md` § Launch); `mountChatView` returns `ChatTabs` (`session(id)`,
  `sessionOfEditor(editor)`).
- Not yet built: `grep -c "listSessions\|PastSession" src/contracts/agent.ts` → 0; `grep -c "modified\|readStart" src/contracts/files.ts`
  → 0; `grep -c "completions\|EditorOptions" src/contracts/editor.ts` → 0; `test -e src/plugins/chat/main/archived-sessions.ts || echo absent` → `absent`.
- The editor host's `create` as at plan time: `grep -c "create(parent: HTMLElement, doc: string, events: EditorEvents): TextEditor;" src/contracts/editor.ts` → 1.
  Call sites, measured at plan time, re-verify: `grep -rn "host.create(" src --include='*.ts'` → 1 (`src/plugins/forms/page/editor-boxes.ts`); plan A's Chat tab adds one.
- `Files` implementers, measured at plan time, re-verify: `grep -rln "watch: \|watch(folder" src --include='*.ts'` →
  `src/main/files/node-files.ts`, `src/main/files/node-files.test.ts` (calls only), `src/shared/memory-files.ts`,
  `src/shared/scoped-files.ts`, and the layout registry test with its two `data: { read, write, list, watch }`
  wrappers (`src/plugins/forms/main/layouts/layout-registry.test.ts` at plan time; plan A task 02 moves it to
  `src/shared/layouts/layout-registry.test.ts`). Plan A may add more; task 01 updates every one the compiler flags.
- `@codemirror/autocomplete` 6.20.3 on disk and not yet direct: `source ~/.nvm/nvm.sh && nvm use >/dev/null && npm ls @codemirror/autocomplete`
  → `└─┬ codemirror@6.0.2` / `└── @codemirror/autocomplete@6.20.3`; `grep -c '"@codemirror/autocomplete"' package.json` → 0;
  `grep -A1 '"node_modules/@codemirror/autocomplete"' package-lock.json` → `"version": "6.20.3"`.
- No clashing editor-mode chords: `grep -rn "'<C-n>'\|'<C-p>'\|'<Tab>'" src/plugins src/config` → empty.
- Claude's project folder naming, observed at plan time, re-verify: `ls ~/.claude-personal/projects/` lists
  `-Users-jonathonwigley-Documents-dev-wigley-ai-gui` (for `/Users/jonathonwigley/Documents/dev/wigley-ai-gui`);
  `ls ~/.claude/projects/ | grep -c -- "-Users-jonathonwigley--claude"` → 1 (for `/Users/jonathonwigley/.claude`).
- Tree clean in the touched areas: `git status --porcelain -- src scripts package.json package-lock.json` → empty. On any
  output, stop and ask the user whose the changes are.

## Docs written ahead

- `docs/features/agent-chat/design.md` (Agent harness seam's **Locality**, Chat plugin's **Slash completion** and
  **Resume and archive**, Plans) and wigley-ai-gui `AGENTS.md` (the layout tree's `claude-code/`, `codemirror-vim/`
  and `chat/` lines, **An agent harness**) — commit `376f1cc`.

## Mandatory Reads

- `AGENTS.md` (repo root) — the only `AGENTS*.md` / `CLAUDE*.md` in the repo; there is no `.claude/rules/`.
- `docs/features/agent-chat/design.md` — the settled design and its vocabulary.
- `docs/features/agent-chat/claude-stream.md` — written by plan A task 01; task 03 reads it before touching the adapter.

## Design Overview

```
 Space k n ─► start prompt: folder ─► profile ─► session step (picker `Session`, scope `chat.resume`)
                 │ channel pastSessions(projectDir, profile)
                 ▼
 chat main ─► agentHarnesses['claude'].listSessions(projectDir, profileDir)
                 │ Claude adapter: <profileDir>/projects/<encoded projectDir>/<uuid>.jsonl
                 │   files.modified + files.readStart(64 KiB) ─► title, cwd check ─► newest first
          ◄── minus host ids open in the app, each row marked archived from archived-sessions.json
 page list: "New session", then rows (archived hidden until `.`) ── x ─► setArchived(id, !archived)
                 │ Enter on "New session": start(...) as plan A · Enter on a row: resume({ projectDir, profile, hostSessionId })
                 ▼
 chat main ─► harness.history(id, projectDir, profileDir) ─► entries (unreadable line ─► raw entry)
          ├─► sessions.open(info with the old host id) ─► row + Chat tab showing the history
          └─► harness.start({ sessionId: id, resume: true, ... }) ─► claude --resume <id>
 events.commands(names) ─► chat main state ─► channel `commands` ─► Chat tab box
 box: `/mo` in insert mode ─► EditorOptions.completions ─► autocomplete popup ─► Tab ─► `/model `
```

Decisions (plan B's interview answers, recorded here; design in `design.md`):

- **Resume list** (interview): after folder and profile the prompt offers "New session" first, then the folder's
  saved sessions in that profile, every transcript Claude saved for the folder — terminal and app sessions alike —
  newest first, each labelled by its first user message (at most 80 characters, a longer one cut to 79 and `…`) and
  its time; a session the app has open now is left out. Picking one resumes it (`AgentStart.resume: true`, its id)
  and the Chat tab shows the earlier conversation in the same chat entries; a transcript line the reader cannot read
  becomes a `raw` entry instead of failing.
- **Locality** (interview): listing and reading live in the Claude adapter as `AgentHarness.listSessions` and
  `AgentHarness.history`; the fake harness implements both. The adapter reads through the `Files` service, which
  gains `modified` and `readStart` (agent decision: the adapter is core main code and `Files` is the app's one file
  seam, so the adapter is tested over memory files with transcripts the tests build).
- **Archive** (interview): `x` archives the entry under the cursor; `.` toggles showing archived entries, where `x`
  restores. Archived host session ids live in chat's data at `archived-sessions.json`; transcripts are never changed
  or deleted.
- **Slash completion** (interview): `/` at the start of the message box offers the session's commands and skills
  (`AgentProcessEvents.commands`) through `@codemirror/autocomplete` 6.20.3, a direct dependency pinned exactly
  (user approved; already on disk, no download), used only in `src/renderer/codemirror-vim/`, behind
  `EditorOptions.completions` on the editor contract; Tab accepts in insert mode.
- Agent decisions (each reported to the user as Decided):
  - Titles and transcript facts: the title is the first `user` line that is not `isMeta`, not `isSidechain`, whose
    text does not open with `<local-command-caveat>`, read from the transcript's first 64 KiB; a slash-command line
    titles as its `<command-name>` and `<command-args>` text. A transcript whose first 64 KiB holds no such line
    titles `Untitled session`; one whose first 64 KiB holds no line carrying `cwd` is left out (its folder cannot be
    confirmed).
  - Project folder: `<config>/projects/<projectDir with every character outside [A-Za-z0-9] replaced by ->`, the
    config folder being `profileDir`, else the inherited `CLAUDE_CONFIG_DIR`, else `~/.claude` (where the CLI writes),
    keeping only transcripts whose first line carrying `cwd` names `projectDir` exactly, since the encoding can
    collide (`/a/b-c`, `/a/b/c`).
  - Open sessions left out: every `sessions.connected` session's host id until its `sessions.ended` (owned sessions
    emit both, plan A task 03), so a terminal session connected through the relay is left out too.
  - Resume is its own async invoke (`resume`), since reading history is async and plan A's `start` is synchronous;
    a folder with no saved sessions skips the session step, as one profile skips the profile step.
  - The session step is plan A's picker opened in a scope of its own (`chat.resume`), so `x` and `.` bind only there.
  - Time label: the transcript file's modified time, local `YYYY-MM-DD HH:mm`.
  - Completion keys: Tab accepts, Ctrl+n / Down and Ctrl+p / Up move, Enter keeps plan A's meaning (adds a line in
    insert mode), and leaving insert mode closes the popup; accepting writes `/<name> `.
  - History that cannot be read does not block the resume: the chat shows one error notice and the session resumes.

Out of scope (follow-ups in `docs/features/followups.md`): Codex and wigley-harness adapters, a read-only view of
terminal sessions, attachments, "Always allow". Not planned: deleting transcripts, titles from Claude's `ai-title`
lines, completion anywhere but the start of the box.

## File Structure

### Shared names and signatures

Every name below is used by more than one task; each task's Produces matches it word for word.

`src/contracts/files.ts` `Files` (task 01) gains:

```ts
  // Epoch milliseconds of the file's last change. Rejects when the file is missing, naming the path.
  modified(path: string): Promise<number>;
  // The file's first `maxBytes` bytes as UTF-8, a character the cut splits left out; the whole file when shorter.
  // Rejects when the file is missing, naming the path.
  readStart(path: string, maxBytes: number): Promise<string>;
```

`src/shared/memory-files.ts` (task 01): `export function createMemoryFiles(clock?: Clock): MemoryFiles` — each `write`
stamps the file's `modified` with `clock.now()`, `0` with no clock.

`src/contracts/editor.ts` (task 02):

```ts
// While the editor is in insert mode and the text from the document's start to the cursor is `prefix` followed by
// no whitespace, offers the `words()` that start with the text typed after `prefix`, ignoring case, in the order
// `words()` gives them. Accepting one replaces that text with `prefix`, the word and one space. `offered` hears the
// offered words each time the list changes while it is open; `accepted` hears the word accepted.
export interface EditorCompletions {
  prefix: string;
  words(): readonly string[];
  offered(words: readonly string[]): void;
  accepted(word: string): void;
}
export interface EditorOptions { completions?: EditorCompletions }
EditorHost.create(parent: HTMLElement, doc: string, events: EditorEvents, options?: EditorOptions): TextEditor
```

`src/contracts/agent.ts` (task 03):

```ts
// A session the harness saved for a folder. `title` is its first user message, whitespace collapsed to single
// spaces, at most 80 characters (a longer one is its first 79 and `…`), or `Untitled session`; `modified` is the
// transcript's last change, epoch milliseconds.
export interface PastSession { sessionId: string; title: string; modified: number }
AgentHarness.listSessions(projectDir: string, profileDir: string | null): Promise<PastSession[]>   // newest first
AgentHarness.history(sessionId: string, projectDir: string, profileDir: string | null): Promise<ChatEntry[]>
                                                       // oldest first; rejects naming the path when it is missing
```

`src/plugins/chat/contract.ts` (task 04; tasks 05, 06, 07 consume it):

```ts
// `hostSessionId` is the harness's id for the saved session.
export interface PastSessionRow { hostSessionId: string; title: string; modified: number; archived: boolean }
export interface ResumeRequest { projectDir: string; profile: string; hostSessionId: string }
ChatSessionState gains `commands: string[]`            // the latest `AgentProcessEvents.commands`, [] before it
ChatChannel.invoke.pastSessions(projectDir: string, profile: string): Promise<PastSessionRow[]>  // newest first, open ones left out
ChatChannel.invoke.setArchived(hostSessionId: string, archived: boolean): Promise<void>
ChatChannel.invoke.resume(request: ResumeRequest): Promise<string>   // the new row's sessionId
ChatChannel.messages.commands: { sessionId: string; names: string[] }
```

Plan A's `StartRequest` and synchronous `start` stay as they are: resume reads the transcript first, so it is its own
async invoke.

`src/plugins/chat/main/archived-sessions.ts` (task 04): `ARCHIVED_SESSIONS_FILE = 'archived-sessions.json'`,
`ArchivedSessions { ids(): Promise<ReadonlySet<string>>; set(hostSessionId: string, archived: boolean): Promise<void> }`,
`createArchivedSessions(data: Files): ArchivedSessions`.

`src/plugins/chat/manifest.ts` (task 05): scope `resume: 'In the session list'`; page commands `toggleArchive`
(label `archive or restore the session`, group `picker`) and `showArchived` (label `show or hide archived sessions`,
group `picker`). Scope `resume` binds `j` pickerDown, `k` pickerUp, `Enter` pickerPick, `Escape` pickerClose, `/`
pickerFilter, `x` toggleArchive, `.` showArchived (page) and `<CR>` pickerPick, `<Esc>` pickerList (editor).

`src/plugins/chat/page/picker.ts` (task 05, plan A task 09's picker): `PickerRequest<T>` gains `scope?: 'picker' |
'resume'` (the scope pushed while it is open; `picker` when left out), `Picker` gains `cursorIndex(): number | null`,
`PickerDeps.pushScope` becomes `pushScope(scope: ChatScopeName): PushedScope`.

`src/plugins/chat/page/start-prompt.ts` (task 05): plan A's `openStartPrompt(deps)` becomes
`createStartPrompt(deps: StartPromptDeps): StartPrompt` with `StartPrompt { open(): void; toggleArchive(): void;
showArchived(): void }`.

Pinned values: `archived-sessions.json` in chat's data folder is a JSON array of host session ids in archiving order,
without duplicates; titles are at most 80 characters; the transcript head read is 65536 bytes; the untitled title is
`Untitled session`; the new-session entry is `New session`; history entry ids start `history:`; the session step's
picker title is `Session`; the box's completion prefix is `/`.

### Existing files modified

- `src/contracts/files.ts`, `src/main/files/node-files.ts` (+test), `src/shared/memory-files.ts`,
  `src/shared/scoped-files.ts` (+test), `src/shared/layouts/layout-registry.test.ts` (its two `Files` wrappers) — task 01.
- `src/contracts/editor.ts`, `src/renderer/codemirror-vim/codemirror-vim-host.ts`, `editor-theme.ts`, `package.json`,
  `package-lock.json` (its root `packages[""].dependencies` only), `scripts/check-layers.mts` — task 02.
- `src/contracts/agent.ts`, `src/main/claude-code/claude-code-harness.ts` (+test), `src/main/claude-code/stream-decoder.ts`,
  `src/shared/fake-agent-harness.ts` (+test), `src/main/main.ts` — task 03.
- `src/plugins/chat/contract.ts`, `main/chat-sessions.ts` (+test), `main/start.ts` — task 04.
- `src/plugins/chat/manifest.ts`, `page/start-prompt.ts`, `page/picker.ts`, `page/start.ts` — task 05.
- `src/plugins/chat/page/chat-view.ts` (and `page/start.ts` when plan A's message listeners live there) — task 06.
- `src/plugins/chat/main/selftest-script.ts`, `main/start.ts` (the script's deps) — task 07.
- `AGENTS.md`, `docs/features/agent-chat/design.md` (stale lines only) — task 08.

### New files

- `src/renderer/codemirror-vim/prefix-completion.ts` (+test) — task 02: the pure rule deciding what the popup offers,
  testable without a DOM (Vitest runs in `node`).
- `src/main/claude-code/transcripts.ts` (+test) — task 03: Claude's transcript format — folder naming, title, cwd
  check, lines into chat entries — as pure functions over text, so the format stays in one module.
- `src/plugins/chat/main/archived-sessions.ts` (+test) — task 04: the archived ids over chat's data.
- `src/plugins/chat/page/resume-items.ts` (+test) — task 05: the session step's items, labels, `YYYY-MM-DD HH:mm`
  times and cursor after a change, as pure functions.
- `src/main/claude-code/past-sessions.ts` (+test), `src/main/claude-code/tool-result-text.ts` — task 03: listing and
  reading over `Files`; the decoder's tool-result text rule moved so history and the stream read results alike.

### Boundary rules

- Only `src/main/claude-code/` reads a Claude transcript or names `~/.claude*/projects`; chat sees `PastSession` and
  `ChatEntry` only.
- Only `src/renderer/codemirror-vim/` imports `@codemirror/autocomplete`; a plugin reaches completion only through
  `EditorOptions`.
- The adapter reads transcripts only through `Files`; nothing writes, renames or deletes under a profile's
  `projects/` folder.
- Chat's archive state lives in chat's data (`api.data`) only.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Files: modified and readStart](01-files-modified-read-start.md)
- [ ] [Editor completion option](02-editor-completion.md)

### Wave 2
- [ ] [Harness: past sessions and history](03-harness-past-sessions.md) — after 01

### Wave 3
- [ ] [Chat main: past sessions, archive, resume, commands](04-chat-main-resume.md) — after 03

### Wave 4
- [ ] [Start prompt: the session step](05-start-prompt-resume.md) — after 04

### Wave 5
- [ ] [Chat tab: slash completion](06-chat-tab-completion.md) — after 02, 04, 05

### Wave 6
- [ ] [Chat self-test steps](07-selftest-steps.md) — after 05, 06

### Wave 7
- [ ] [Doc re-read](08-doc-re-read.md) — after 07

### Wave 8
- [ ] [Final verification](09-final-verification.md) — after 08

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
