# Agent chat A — the loop — plan

Feature: agent chat · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui · Written: 2026-10-20

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user presses `Space k n`, picks a folder and a Claude profile, and gets a new Claude Code session in the app: a
Chat tab where the user sends messages and reads Claude's replies as they stream, tool calls as compact expandable
lines, and permission prompts as Allow / Deny entries. The session's mode, effort and model show under the message
box and change from the keyboard. When the session's agent sends a forms round, the Form tab takes over the session;
submitting or cancelling gives it back to the Chat tab. A finished turn alerts the user when the window is not
focused or the session is not on screen. The chat's look is a user-editable layout, as forms' cards are.

## Architecture

Systems touched:

- **agent harness seam** (`src/contracts/agent.ts`, new `src/main/claude-code/`, new `src/shared/fake-agent-harness.ts`):
  `AgentHarness` replaces the one-shot `AgentClient`; the Claude adapter runs the installed CLI in stream-json mode.
  The ACP adapter, the mock agent and `@agentclientprotocol/sdk` are removed.
- **core services** (`src/contracts/plugin.ts`, `src/contracts/ambient.ts`, `src/contracts/settings.ts`,
  `src/config/settings.ts`, `src/main/main.ts`, `src/main/window.ts`, `src/main/selftest.ts`,
  `src/main/plugins/main-api.ts`): `agentHarnesses`, `randomUuid`, `window.isFocused` and `window.chooseFolder`, a
  core `claude` setting, and one self-test script per plugin.
- **shared layouts** (new `src/contracts/layouts.ts`, `src/shared/layouts/`, `src/shared/page/layout-loader.ts`;
  forms' `main/layouts/` and `page/layout/layout-loader.ts`): the forms registry and loader, generalized.
- **sessions** (`src/plugins/sessions/`): owned sessions, the relay joining them, `mark`, `selectedSessionId`, the
  `closed` event, and `takeOver` on a tab handle.
- **forms** (`main/channel-presenter.ts`, `page/forms-view.ts`, its layout wiring): `mark`, `takeOver`, the shared
  layout machinery.
- **chat plugin** (new `src/plugins/chat/`): owned sessions' agent processes and entries, the `permission_prompt`
  tool, recent folders, the Chat tab, the start prompt, the chat layouts, its self-test script.
- **layer check** (`scripts/check-layers.mts`): the new layers, the removed ones.

## Preconditions

Each re-run by `wigley:make` before the first dispatch:

- Docs-ahead commit present: `git log --oneline | grep -c 376f1cc` → 1.
- Forms layouts landed: `test -e src/plugins/forms/main/layouts/layout-registry.ts && test -e
  src/plugins/forms/page/layout/layout-loader.ts && echo ok` → `ok`.
- Docs-browser plan A landed (tabs and modes): `grep -c "addTab" src/plugins/sessions/contract.ts` → ≥ 1.
- Sessions as at plan time: `grep -c "markRound" src/plugins/sessions/contract.ts` → 1; `grep -c "open(info" src/plugins/sessions/contract.ts` → 0.
- `markRound` call sites, measured at plan time, re-verify: `grep -rn "markRound" src | wc -l` → 32 (8 outside tests; two are sample strings in `forms/main/preview/preview-round.ts`).
- The ACP code is where the plan removes it: `grep -rln "AgentClient\|acp-agent-client\|mock-agent" src scripts forge.config.mts`
  → `src/mock-agent/mock-agent.ts`, `src/contracts/agent.ts`, `src/main/acp/acp-agent-client.ts`,
  `scripts/check-layers.mts`, `forge.config.mts`; `grep -c agentclientprotocol package.json` → 1.
- No chat plugin and no clashing keys yet: `test -e src/plugins/chat || echo absent` → `absent`;
  `grep -rn "' ', 'c'\|' ', 'k', 'n'\|'z', 'c'" src/plugins src/config` → empty.
- Docs-browser plan B (the `docs` plugin) not landed at plan time: `test -e src/plugins/docs || echo absent` →
  `absent`. When it has landed first, tasks 05 and 06 re-read `src/main/main.ts`, `src/contracts/plugin.ts` and
  `scripts/check-layers.mts` as they stand, and the run log says so.
- Tree clean in the touched areas: `git status --porcelain -- src scripts forge.config.mts package.json index.html`
  → empty. On any output, stop and ask the user whose the changes are.
- Claude Code installed: `~/.local/bin/claude --version` → `2.1.304 (Claude Code)` or later.
- Both profiles have the wigley plugin, whose `wigley-forms` relay serves the app's tools:
  `ls ~/.claude/plugins/cache/wigley-ai-marketplace ~/.claude-personal/plugins/cache/wigley-ai-marketplace` → both list
  `wigley`; its server is named `wigley-forms`: `grep -c '"wigley-forms"' ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json` → 1.

## Docs written ahead

- `docs/features/agent-chat/design.md` (the settled design), wigley-ai-gui `AGENTS.md` (intro, layout tree, the
  owned-session sentence, **A session tab**, **Debug and testing keys**, **An agent harness**, **A session control**,
  **A layout**, the self-test scripts in **Running and testing**, **Dev quirks**), `docs/features/followups.md` —
  commit `376f1cc`.

## Mandatory Reads

- `AGENTS.md` (repo root) — the only `AGENTS*.md` / `CLAUDE*.md` in the repo; there is no `.claude/rules/`.
- `docs/features/agent-chat/design.md` — the settled design and its vocabulary.
- `docs/features/agent-chat/claude-stream.md` — written by task 01; every task touching the Claude adapter or the
  permission tool reads it.

## Design Overview

```
 Space k n ─► chat page: start prompt (overlay) ─► folder (recent, or the folder dialog) ─► profile
                 │ channel start({ projectDir, profile })
                 ▼
 chat main ── randomUuid() ─► sessions.open(info) ─► row (selected) ─► page: Chat tab added, box focused
          └── agentHarnesses['claude'].start({ sessionId, resume: false, projectDir, profileDir }, events)
                 │ claude -p … --verbose --session-id <id> --permission-mode auto --permission-prompt-tool <tool>
                 │ relay.py hello carries <id> ─► sessions connect() joins the owned row
                 ▼
 events.entry / controls / activity / ended ─► chat main store ─► channel messages ─► Chat tab
                                                                     │ chat layout builds each entry
 send / interrupt / setControl ◄── chat page keys (Enter, Cmd+Enter, Ctrl+C, Space c …)
 permission_prompt tool call ─► chat main: permission entry, waits ─► y / n ─► tool result
 forms round ─► Form tab takeOver() ─► submit/cancel ─► release() ─► Chat tab again
 activity working → idle, window unfocused or session not selected ─► alerts.announce + sessions.mark
 user closes the row ─► Chat tab confirm while working ─► sessions `closed` ─► process.end() ─► owned.end()
```

Decisions (interview rounds 1–4 and the design review; full record in `design.md`):

- Claude Code only, behind a seam Codex and wigley-harness adapters plug into later (round 1, round 3).
- The installed `claude` CLI in stream-json mode, one process per session, no new package (round 3).
- Auto mode; what it would still prompt reaches chat's `permission_prompt` MCP tool and shows as an Allow (`y`) /
  Deny (`n`) entry, Deny with an optional reason box (rounds 2, 3).
- Session controls are declared by the adapter (id, label, choices, value); Claude declares `mode`, `effort`,
  `model` (round 2 note); they show in a status line under the box, `Space c m` / `e` / `o` open a picker, `Space c c`
  lists all (round 3, design review).
- Chat entries carry the raw harness events, and a user-editable chat layout draws them (round 1 note, round 2).
- Tool calls are one compact line that expands (round 1). Replies stream (round 1).
- Enter in normal mode sends, Enter in insert mode adds a line, Cmd+Enter sends from any mode (round 1). Ctrl+C
  interrupts the turn (round 2). `i`/`a`, `j`/`k`, `Enter`, `G` (design review).
- New session: `Space k n`, folder (recent first, plus the folder dialog) then profile, the last profile used in that
  folder pre-selected (rounds 1, 4). Profiles are a chat setting, default `work` → `~/.claude`, `personal` →
  `~/.claude-personal` (round 4).
- A round takes over its session's tab and gives it back on submit or cancel; a round for a session not on screen
  takes over inside that session and marks its row (rounds 1, 2).
- A finished turn alerts when the window is unfocused or the session is not on screen (round 2).
- Owned sessions in `sessions`; `markRound` becomes `mark`; `takeOver` on a tab handle (design review).
- The layout registry and loader move to the shared layer (round 4). ACP adapter and mock agent removed (round 4).
- Agent decisions after round 4 (each reported to the user as Decided): the `claude` path is a core setting
  `claude.command`, default `~/.local/bin/claude`, since an app started from the Dock has no shell `PATH`; host
  session ids come from a new ambient `randomUuid`; pickers open on the list (`j` / `k`, Enter, Esc) and `/` focuses
  their filter box; `y` / `n` answer the oldest pending permission of the shown session; the self-test host runs one
  script per plugin; chat's layout debug keys are `Space z c n` / `p` / `c`.

Out of scope (plan B): resume with history, archive, slash completion. Out of scope (follow-ups): Codex and
wigley-harness adapters, a read-only view of terminal sessions, attachments, "Always allow".

## File Structure

### Shared names and signatures

Every name below is used by more than one task; each task's Produces matches it word for word.

`src/contracts/agent.ts` (task 05) — replaces `AgentClient` and `StopReason` whole:

```ts
export interface ControlChoice { value: string; label: string }
// A setting of a running session the harness declares; `value` is null until the harness reports it.
export interface SessionControl { id: string; label: string; choices: ControlChoice[]; value: string | null }

export type ProcessActivity = 'idle' | 'working' | 'waiting';

// `id` is unique within its session; an entry sent again with the same id replaces the earlier one.
// `raw` holds the harness events the entry was built from, oldest first.
export type ChatEntry =
  | { kind: 'user'; id: string; text: string; raw: unknown[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean; raw: unknown[] }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean; raw: unknown[] }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input: unknown; summary: string;
      result: { text: string; isError: boolean } | null; raw: unknown[] }
  | { kind: 'permission'; id: string; toolName: string; input: unknown;
      answer: { allowed: boolean; reason: string | null } | null; raw: unknown[] }
  | { kind: 'result'; id: string; stopReason: string; costUsd: number | null; durationMs: number | null; raw: unknown[] }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error'; raw: unknown[] }
  | { kind: 'raw'; id: string; raw: unknown[] };

export type ChatEntryKind = ChatEntry['kind'];

// `sessionId` is the host's session id: fresh for a new session, the old one when `resume` is true.
// `profileDir` is the harness's config folder (Claude's `CLAUDE_CONFIG_DIR`), null for the harness default.
export interface AgentStart { sessionId: string; resume: boolean; projectDir: string; profileDir: string | null }

export interface AgentProcessEvents {
  entry(entry: ChatEntry): void;
  controls(controls: SessionControl[]): void;
  activity(activity: ProcessActivity): void;
  // The slash commands and skills the session offers, as typed after `/`; plan B reads it.
  commands(names: string[]): void;
  ended(end: { code: number | null; error: string | null }): void;
}

export interface AgentProcess {
  send(text: string): void;
  interrupt(): void;
  setControl(id: string, value: string): void;
  // Resolves once the process has exited.
  end(): Promise<void>;
}

export interface AgentHarness {
  id: string;
  start(request: AgentStart, events: AgentProcessEvents): AgentProcess;
}
```

`src/contracts/ambient.ts` (task 05): `export type RandomUuid = () => string;` — an RFC 4122 v4 UUID, fresh per call.

`src/contracts/plugin.ts` `MainServices` (task 05) gains `randomUuid: RandomUuid`, `agentHarnesses: readonly
AgentHarness[]`, and `window: { show(): void; isFocused(): boolean; chooseFolder(): Promise<string | null> }`
(`chooseFolder` opens the native folder dialog over the window; null when the user cancels). `SelfTestHost.run`
takes one script per plugin; the driver runs the handed scripts in hand-over order on each run.

`src/contracts/settings.ts` / `src/config/settings.ts` (task 05): core setting `claude: { command: string }`,
default `'~/.local/bin/claude'`; a leading `~/` means the home folder. `src/shared/expand-home.ts` (task 05):
`export function expandHome(value: string, homeDir: string): string` — a value starting `~/` becomes the home folder
joined with the rest; any other value is returned as it stands. Tasks 06 and 07 use it.

Who emits what: the harness adapter emits the `user` entry for each `send` (chat main adds none); chat main builds
the `permission` entries itself (ids `permission-<n>`, from 1 per session), since permission calls reach it through
the relay, not the harness.

`src/contracts/layouts.ts` (task 02) — moved from forms' contract unchanged in shape:

```ts
export interface LayoutChoice { name: string; revision: number; hasCss: boolean; builtIn: boolean;
  reason: 'start' | 'cycled' | 'reloaded' | 'copied' }
```

(Task 02 copies the exact fields and comments from `src/plugins/forms/contract.ts` `LayoutChoice` as it stands;
forms' contract re-exports it so forms' callers keep their import.)

`src/shared/layouts/layout-registry.ts` (task 02): `export function startLayoutRegistry(deps: LayoutRegistryDeps):
Promise<LayoutRegistry>` with today's `LayoutRegistry` interface (`current`, `cycle`, `copy`, `dispose`), and
`LayoutRegistryDeps` = today's fields plus `logSource: string` (the log source name: `'forms'`, `'chat'`).

`src/shared/page/layout-loader.ts` (task 02): `export function createLayoutLoader<L>(deps: LayoutLoaderDeps<L>):
LayoutLoader<L>`, `LayoutLoaderDeps<L>` = today's fields with `defaultLayout: L` plus `read(module: unknown, name:
string): L` (the plugin's validator, throwing naming the first part missing); `LayoutLoader<L> { load(choice:
LayoutChoice): Promise<L> }`; `layoutUrls` moves with it. Forms keeps `readLayout` as its `read`.

`src/plugins/sessions/contract.ts` (task 03, task 04):

```ts
// task 03
export interface OwnedSession { session: AgentSession; end(): void }
SessionsMainExports.open(info: SessionInfo): OwnedSession   // info.sessionId non-null; throws on null or a host id already open
SessionsMainExports.mark(sessionId: string): void            // replaces markRound, same behaviour
SessionsMainExports.selectedSessionId(): string | null
SessionsMainEvents.closed: { sessionId: string }             // the user closed the row and every guard allowed it
// task 04
SessionTabHandle.takeOver(): { release(): void }
```

`src/plugins/chat/contract.ts` (task 07; the page tasks consume it):

```ts
export interface ChatProfile { name: string; configDir: string }
export interface RecentFolder { projectDir: string; profile: string; lastUsed: number }
export interface StartRequest { projectDir: string; profile: string }
// `sessionId` is the sessions plugin's id for the row; an ended session's state is dropped at once.
export interface ChatSessionState { sessionId: string; projectDir: string; profile: string;
  entries: ChatEntry[]; controls: SessionControl[]; activity: ProcessActivity }
export interface PermissionAnswer { allowed: boolean; reason: string | null }

export interface ChatChannel extends ChannelShape {
  invoke: {
    sessions(): ChatSessionState[];
    recentFolders(): Promise<RecentFolder[]>;
    homeDir(): string;                              // task 10 adds it: the start prompt shows the home folder as `~`
    chooseFolder(): Promise<string | null>;
    start(request: StartRequest): string;          // the new row's sessionId
    send(sessionId: string, text: string): void;
    interrupt(sessionId: string): void;
    setControl(sessionId: string, controlId: string, value: string): void;
    answerPermission(sessionId: string, entryId: string, answer: PermissionAnswer): void;
    layout(): Promise<LayoutChoice>;
    cycleLayout(step: 1 | -1): Promise<LayoutChoice>;
    copyLayout(): Promise<LayoutChoice>;
  };
  messages: {
    sessionStarted: ChatSessionState;
    entry: { sessionId: string; entry: ChatEntry };
    controls: { sessionId: string; controls: SessionControl[] };
    activity: { sessionId: string; activity: ProcessActivity };
    sessionEnded: { sessionId: string; error: string | null };
    layoutChanged: LayoutChoice;
  };
}
```

Chat manifest settings (task 07): `profiles: ChatProfile[]`, default
`[{ name: 'work', configDir: '~/.claude' }, { name: 'personal', configDir: '~/.claude-personal' }]`.

`src/plugins/chat/layouts/layout.d.ts` (task 08) imports nothing and declares the chat Layout contract:
`ChatLayout { entries: { [K in EntryKind]: (input: EntryInput<K>, kit: ChatKit) => EntryView } }`, `EntryView {
element: HTMLElement; update?(input): void }`, each `EntryInput<K>` the matching `ChatEntry` variant's fields, and
the kit:

```ts
interface ChatKit {
  markdown(text: string): HTMLElement;                  // rendered through the app's markdown renderer
  json(value: unknown): HTMLElement;                    // pretty-printed, in a <pre>
  // A compact line that opens to `body()`; Enter on the focused entry toggles the entry's expanders.
  expander(summary: string, body: () => HTMLElement): HTMLElement;
  // Allow / Deny with their keys beside them (from keys' `keysFor`); Deny opens the reason box. Draws the
  // answer instead once the entry carries one.
  permissionActions(): HTMLElement;
}
```

Task 09 builds the kit and holds a compile-time check that each `ChatEntry` variant is assignable to its
`EntryInput`, so the two never drift.

Pinned names: the permission tool is `permission_prompt`, which Claude names
`mcp__plugin_wigley_wigley-forms__permission_prompt` (the wigley plugin's `wigley-forms` server); task 01 confirms
the name. Recent folders live in chat's data folder at `recent-folders.json`, newest first, at most 20.

### Existing files modified

- `package.json`, `package-lock.json` — drop `@agentclientprotocol/sdk` (task 05; `npm uninstall` touches no new code).
- `forge.config.mts` — drop the mock agent's build entry (task 05).
- `scripts/check-layers.mts` — task 05 (removes `src/main/acp`, `src/mock-agent`; adds
  `src/main/claude-code`, `src/plugins/chat` with its `layouts/`, every later layer this plan creates; chat's parts may
  import `src/shared` and `src/shared/page`, which already hold the shared layout files, so task 02 edits no layer).
- `src/contracts/agent.ts`, `ambient.ts`, `plugin.ts`, `settings.ts`; `src/config/settings.ts` — task 05.
- `src/main/main.ts` — task 05 (services, fake harness in the self-test), task 06 (the Claude adapter line).
- `src/main/window.ts`, `src/main/selftest.ts`, `src/main/plugins/main-api.ts` — task 05.
- `src/plugins/forms/contract.ts`, `main/start.ts`, `main/layouts/layout-registry.ts` (moved), `page/start.ts`,
  `page/layout/layout-loader.ts` (moved), their tests — task 02.
- `src/plugins/forms/main/channel-presenter.ts` (+test) — task 03 (`mark`).
- `src/plugins/forms/page/forms-view.ts` — task 04 (`takeOver`).
- `src/plugins/sessions/contract.ts`, `main/session-list.ts` (+test), `main/start.ts` — task 03.
- `src/plugins/sessions/page/tabs.ts` (+test), `page/session-tabs-view.ts` — task 04.
- `src/plugins/manifests.ts`, `src/plugins/main.ts` — task 07; `src/plugins/page.ts` — task 09.
- Task 09's core edits: `src/contracts/editor.ts` (`FocusOptions.insert`, `TextEditor.setText`) and the CodeMirror
  adapter with forms' two `TextEditor` test fakes; `src/shared/chord-notation.ts` and `src/renderer/key-sequences.ts`
  (a chord may name `Enter`, for `<D-Enter>`); the markdown rules move from `forms/page/forms.css` to a new
  `src/shared/page/markdown.css`, imported by `forms/page/start.ts` and chat.
- `src/plugins/chat/contract.ts`, `src/plugins/chat/main/start.ts` — task 10 (`homeDir`), task 11 (the self-test script).

### New files

- `docs/features/agent-chat/claude-stream.md` — task 01: the wire facts measured on the installed CLI.
- `src/contracts/layouts.ts`, `src/shared/layouts/layout-registry.ts` (+test), `src/shared/page/layout-loader.ts`
  (+test) — task 02, the forms code moved.
- `src/shared/fake-agent-harness.ts` (+test) — task 05: the seam's second adapter.
- `src/main/claude-code/` — task 06: the adapter (process, stream decoding into entries, controls); its pure
  decoding module is tested with lines the test builds.
- `src/plugins/chat/manifest.ts`, `contract.ts`, `main/` — task 07; `layouts/layout.d.ts`,
  `layouts/default/layout.js` — task 08; `page/` — tasks 09, 10; `main/selftest-script.ts` — task 11.

### Boundary rules

- `node:child_process` for `claude` only in `src/main/claude-code/`; nothing else spawns it.
- Chat reaches Claude only through `AgentHarness`; it never parses Claude JSON.
- `src/plugins/chat/layouts/` imports nothing; a chat layout reaches the app only through its `input` and `kit`.
- Chat imports `sessions`' and `keys`' `contract.ts` only (its manifest's `dependsOn: ['sessions', 'keys']`).
- Forms and chat reach the layout machinery only through `src/shared/layouts/` and `src/shared/page/layout-loader.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Spike: Claude stream-json wire facts](01-spike-claude-stream.md)
- [x] [Shared layout machinery](02-shared-layouts.md)
- [x] [Sessions main: owned sessions, mark, closed](03-sessions-owned.md)
- [x] [Chat layout contract and default layout](08-chat-layout.md)

### Wave 2
- [ ] [Sessions page: takeOver, and forms taking over](04-tab-takeover.md) — after 03
- [ ] [Core: agent contract, services, self-test scripts, ACP removal, fake harness](05-core-agent-services.md) — after 02

### Wave 3
- [ ] [Claude Code adapter](06-claude-adapter.md) — after 01, 05
- [ ] [Chat main part](07-chat-main.md) — after 02, 03, 05, 08

### Wave 4
- [ ] [Chat tab](09-chat-tab.md) — after 04, 07, 08

### Wave 5
- [ ] [Start prompt and new session](10-start-prompt.md) — after 09

### Wave 6
- [ ] [Chat self-test script](11-selftest.md) — after 06, 10

### Wave 7
- [ ] [Doc re-read](12-doc-re-read.md) — after 11

### Wave 8
- [ ] [Final verification](13-final-verification.md) — after 12

## Run log

Review base: 4597f154604caf0e8453b17f551918d444f11ab5

### Groups
- 08 chat layout · 187049e · diff read + typecheck + lint pass · concerns: no strict null checks, so `@ts-check` misses null misuse
- 03 sessions owned · 22c3c42 · diff read + typecheck + lint pass · concerns: the `closed` test sets no guard
- 02 shared layouts · a646bb4 · diff read + typecheck + lint pass · concerns: the done-when grep hits fixtures that were already there; 5 `[forms]` log lines in `showLayouts`' tests, not 4
### Contract changes
### Rulings
- Lint and typecheck run under the `.nvmrc` Node (`source ~/.nvm/nvm.sh && nvm use`); the shell's default Node 22.14 rejects `check-layers.mts` — every later brief says so · lead
- A joined relay's `end()` holds its own once-flag, so an old relay's repeated `end()` cannot clear a later relay's join — costs nothing if wrong · group 03
### Review rounds
### Test gate
