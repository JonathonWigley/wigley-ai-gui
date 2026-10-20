# Agent chat — design

**Contents**

- **Intent** — what the feature gives the user.
- **Vocabulary** — the terms the code and plans use.
- **Flow** — a session from start to end, with a form swapping in and back.
- **Agent harness seam** — the contract, the Claude adapter, the fake, chat entries, controls.
- **Sessions and tabs** — owned sessions, joining the relay, take over and give back, the attention mark.
- **Chat plugin** — the Chat tab, the start prompt, permission cards, alerts, keys.
- **Layouts** — the shared layout machinery and chat layouts.
- **Plans** — what plan A and plan B each land.
- **Out of scope** — follow-ups.

## Intent

The user starts Claude Code sessions from the app, chats with them, and never switches to a terminal: when a
session's agent sends a forms round, the session's tab swaps to the form in place, and submitting (or cancelling)
swaps back to the chat. Settled in a four-round interview on 2026-10-19/20; this file is the record of it.

## Vocabulary

- **Agent harness** — an agent program the app drives (Claude Code today; Codex and wigley-harness are the named
  next ones). Its seam is `AgentHarness` in `src/contracts/agent.ts`; each harness is one **harness adapter**.
- **Agent process** — one running session of a harness, started by the app: one `claude` child process.
- **Chat entry** — one item in a session's chat, in the app's own shape: a user message, an assistant message,
  thinking, a tool call (with its result), a permission request, a turn result, or a notice. Every entry carries the
  raw harness events it was built from, so nothing the harness sends is lost.
- **Session control** — a setting of a running session the harness adapter declares (id, label, choices, current
  value): Claude declares `mode` (permission mode), `effort` and `model`.
- **Profile** — a named Claude config folder (`work` → `~/.claude`, `personal` → `~/.claude-personal`); it sets the
  login, plugins, settings and where transcripts live. Picked with the folder when starting a session.
- **Owned session** — a session the app started; its row exists from start and ends when its process ends. A
  **connected session** is one a relay connection brought (a terminal session), as today.
- **Take over** — a session tab selecting itself and later giving the session back to the tab shown before.

## Flow

```
 Space k n ─► start prompt (overlay): profile + folder (recent first, or the folder dialog)
                 │                     [plan B: new session, or resume one of the folder's sessions]
                 ▼
 chat main ─► sessions.open(info with a fresh host session id) ─► row + Chat tab, selected
          └─► AgentHarness.start(...) ─► claude -p --input-format stream-json --output-format stream-json
                                            --include-partial-messages --session-id <id>
                                            --permission-mode auto --permission-prompt-tool <chat's tool>
                 │ claude starts the wigley plugin's relay.py, whose hello carries the same session id
                 ▼
 sessions relay ─► connect(info) finds the owned session by host id ─► joins its row (no second row)

 user types ─► message box (vim) ─► Enter (normal) / Cmd+Enter ─► chat main ─► AgentProcess.send(text)
 claude stdout ─► adapter ─► ChatEntry added / updated ─► chat channel ─► Chat tab, drawn by the chat layout
 tool needs approval ─► permission_prompt tool call ─► permission entry ─► y / n ─► tool result to claude
 agent calls ask_round ─► forms ─► Form tab takeOver() ─► user answers ─► submit ─► release() ─► Chat tab
 turn ends, window unfocused or session not on screen ─► alert + sessions.mark(row)
 row closed ─► confirm while a turn runs ─► AgentProcess.end() ─► row gone
```

## Agent harness seam

- `src/contracts/agent.ts` holds `AgentHarness`, `AgentProcess`, `ChatEntry` and `SessionControl`, replacing the
  one-shot `AgentClient`. The ACP adapter (`src/main/acp/`), the mock agent (`src/mock-agent/`, its Forge entry) and
  `@agentclientprotocol/sdk` are removed; ACP comes back as an adapter of this contract if a later harness needs it.
- The Claude adapter is `src/main/claude-code/`, the only place the app spawns `claude`. It runs the installed CLI,
  one long-lived process per session, in stream-json mode, with the user's own login, plugins, skills and hooks. It
  is handed to plugins as a main service. The `claude` path and the profiles are chat settings: an app started from
  the Dock has no shell `PATH` or `CLAUDE_CONFIG_DIR`.
- A fake adapter in `src/shared/` plays scripted entries for the tests and the self-test, so the seam has two
  adapters now.
- The adapter, not the chat, reads Claude's JSON: it turns stdout events into chat entries (streamed text updates
  one entry in place; a tool call and its result are one entry, paired by tool use id). A layout reads an entry's
  raw events for anything the entry does not name.
- **Controls**: the adapter declares its controls and reports their current values; the chat draws whatever it
  declares. Claude changes `mode` by the control protocol and `effort` and `model` by their slash commands; the
  plan A spike confirms each on the installed CLI.
- **Interrupt**: Ctrl+C ends the running turn; the process stays open for the next message.
- **Locality** (plan B): listing a folder's past sessions and reading a transcript into chat entries are adapter
  calls, so Claude's undocumented transcript format stays in the adapter. A line it cannot read becomes a raw entry.
- Slash commands typed in the chat run as in the terminal (`/model`, `/compact`, `/wigley:feature …`).

## Sessions and tabs

- `sessions` main gains `open(info)` for an owned session: the row is added at once. A relay connection whose hello
  carries an owned session's host id joins that session's entry (its tool sessions start there) instead of adding a
  row; the relay going away ends only its tool sessions. The owned session's `end()` drops the row. Closing an owned
  session's row ends it (chat ends the process), after the Chat tab's confirm while a turn runs.
- `markRound` becomes `mark`: one attention mark per row, raised by forms for a round and by chat for a finished
  turn.
- `SessionTabHandle.takeOver()` selects the tab and returns a release; the release reselects the tab that was
  selected before, unless the user selected another tab since. Forms takes over when a round opens (where it calls
  `select()` today) and releases when the round leaves. A round for a session not on screen takes over inside that
  session and marks its row; the user's current session stays on screen.
- `MainServices.window` gains `isFocused()`, for the turn-finished alert.
- Kept as they are: the relay protocol and `relay.py`, the endpoint files, the MCP adapter, forms' round logic.

## Chat plugin

- `src/plugins/chat/`, depending on `sessions` and `keys`. Main keeps every owned session's entries, so a page
  reload redraws the chat whole (the dev server reloads twice at start).
- **Chat tab**: the entries, a vim message box, and a status line under it with each control's value. Enter in
  normal mode sends, Enter in insert mode adds a line, Cmd+Enter sends from any mode. `i` / `a` focus the box, `j` /
  `k` move between entries, `Enter` expands a tool call, `G` jumps to the latest, Ctrl+C interrupts. Tool calls show
  one compact line (tool name and a short input summary) that expands to the full input and output.
- **Controls**: `Space c m` mode, `Space c e` effort, `Space c o` model, each opening a picker of its choices;
  `Space c c` lists every control, so a control a new adapter declares is reachable before it gets a key.
- **Start prompt**: `Space k n`, in the overlay layer: type to filter, `j` / `k` and Enter. It picks the profile and
  the folder: the folders the app started sessions in before, most recent first, plus an entry opening the native
  folder dialog; the last profile used in a folder is pre-selected. Recent folders live in chat's plugin data.
- **Permissions**: sessions run in auto mode; anything auto mode would still prompt reaches chat's `permission_prompt`
  MCP tool, contributed to sessions as forms contributes its tools, and shows as a permission entry. `y` allows, `n`
  denies and opens a box for an optional reason Claude reads.
- **Status**: a row's tab status reads what the chat is doing — working, waiting for a permission — and is empty
  while idle.
- **Turn finished**: when the window is not focused or the session is not on screen, the same alert as a round, and
  the row is marked.
- **Slash completion** (plan B): typing `/` offers the session's commands and skills, from Claude's startup event,
  through CodeMirror's completion (`@codemirror/autocomplete` 6.20.3, already on disk, added as a direct dependency)
  inside the editor adapter, behind an option on the editor contract.
- **Resume and archive** (plan B): after the folder, the start prompt offers a new session or one of the folder's
  saved sessions (terminal and app alike, newest first, labelled by first message and time; one the app has open is
  left out), resumed with its earlier conversation read from the transcript. One key archives the entry under the
  cursor; a toggle shows archived entries to restore one. Archived ids live in chat's plugin data; Claude's
  transcript files stay as Claude keeps them.
- **Self-test**: the self-test host takes one script per plugin and runs them in plugin start order, so chat's
  steps live in chat's own script over the fake adapter. The give-back rule is pinned by the tabs unit tests; the
  swap with a real round is a live check in the final verification.

## Layouts

- The forms layout machinery moves to the shared layer: the registry (list, active, cycle, copy, watch, the `.d.ts`
  copy) and the loader take a plugin's data folder, contract text, default layout and validator as inputs. Forms and
  chat each keep their own contract and `default` layout.
- A **chat layout** builds each chat entry's element from the entry (with its raw events) and a kit of parts, like a
  forms layout builds cards. User chat layouts are folders in chat's plugin data, reloaded on save; an entry that
  throws falls back to the default layout. Debug keys `Space z c n` / `p` / `c` cycle and copy chat layouts.

## Plans

- **Plan A — the loop** (`plan-a-loop/`): the spike, the harness seam with the Claude and fake adapters, ACP removal,
  owned sessions, take over and `mark`, the shared layout machinery, the chat plugin with its default layout,
  permission cards, controls, alerts, and the start prompt with profiles and recent folders.
- **Plan B — resume and completion** (`plan-b-resume/`): resume with history, archive, slash completion.

## Out of scope

In `docs/features/followups.md`: Codex and wigley-harness adapters, a read-only view of terminal sessions, images
and files pasted into the chat, "Always allow" on a permission card.
