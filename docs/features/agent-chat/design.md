# Agent chat — design

**Contents**

- **Intent** — what the feature gives the user.
- **Vocabulary** — the terms the code and plans use.
- **Flow** — a session from start to end, with a form swapping in and back.
- **Agent harness seam** — the contract, the Claude adapter, the fake, chat entries, controls, images, accounts.
- **Sessions and tabs** — owned sessions, joining the relay, take over and give back, the attention mark.
- **Chat plugin** — the Chat tab, the start prompt, sign-in, app slash commands, images, permission cards, alerts, keys.
- **Layouts** — the shared layout machinery and chat layouts.
- **Plans** — what plans A, B and C each land.
- **Out of scope** — follow-ups.

## Intent

The user starts Claude Code sessions from the app, chats with them, and never switches to a terminal: when a
session's agent sends a forms round, the session's tab swaps to the form in place, and submitting (or cancelling)
swaps back to the chat. Settled in a four-round interview on 2026-10-19/20 and extended by plan C's two-round
interview on 2026-10-23; this file is the record of both.

## Vocabulary

- **Agent harness** — an agent program the app drives (Claude Code today; Codex and wigley-harness are the named
  next ones). Its seam is `AgentHarness` in `src/contracts/agent.ts`; each harness is one **harness adapter**.
- **Agent process** — one running session of a harness, started by the app: one `claude` child process.
- **Chat entry** — one item in a session's chat, in the app's own shape: a user message, an assistant message,
  thinking, a tool call (with its result), a permission request, a turn result, a notice, or a raw entry. Every entry
  carries the raw harness events it was built from, so nothing the harness sends is lost.
- **Session control** — a setting of a running session the harness adapter declares (id, label, choices, current
  value): Claude declares `mode` (permission mode), `effort` and `model`.
- **Profile** — a named Claude config folder (`work` → `~/.claude`, `personal` → `~/.claude-personal`); it sets the
  login, plugins, settings and where transcripts live. Picked with the folder when starting a session.
- **Owned session** — a session the app started; its row exists from start and ends when its process ends. A
  **connected session** is one a relay connection brought (a terminal session), as today.
- **Take over** — a session tab selecting itself and later giving the session back to the tab shown before.
- **App slash command** — a `/name` the app runs itself when typed in the message box, instead of sending it to the
  agent. Any plugin registers one through chat's page exports. Chat registers `/login`, `/logout` and `/status`, the
  terminal-only commands print mode refuses (`claude-stream.md` § Terminal-only commands).
- **Sign-in** — signing a profile in to its harness account, run by the harness adapter (`claude auth login` for
  Claude) and shown by chat in the sign-in dialog. **Account status** is whether a profile is signed in, and as whom.
- **Attached image** — an image pasted or dropped into the composer, shown as a thumbnail above the message box and
  sent with the next message.

## Flow

```
 Space k n ─► start prompt (overlay): folder (the app's recent folders and every folder the harness has sessions in,
                 │                     newest first, or the folder dialog), then profile (skipped with one profile),
                 │                     then sign-in when that profile is signed out, then a new session or one of the
                 │                     folder's saved sessions to resume
                 ▼
 chat main ─► sessions.open(info with a fresh host session id, or the saved one's on resume) ─► row + Chat tab, selected
          └─► AgentHarness.start(...) ─► claude -p --input-format stream-json --output-format stream-json
                                            --include-partial-messages --verbose --session-id <id> (--resume <id> on resume)
                                            --permission-mode auto --permission-prompt-tool <chat's tool>
                 │ claude starts the wigley plugin's relay.py, whose hello carries the same session id
                 ▼
 sessions relay ─► connect(info) finds the owned session by host id ─► joins its row (no second row)

 user types ─► message box (vim), images pasted or dropped ─► Enter (normal) / Cmd+Enter
          ├─► `/name` an app slash command registered ─► its handler runs in the page; nothing goes to the agent
          └─► otherwise ─► chat main ─► AgentProcess.send({ text, images })
 /login ─► chat main ─► AgentHarness.logIn(profile) ─► claude auth login opens the browser ─► sign-in dialog
          (link, paste-code box) ─► process ends ─► accountStatus confirms ─► dialog closes + toast
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
  is handed to plugins as a main service. The `claude` path is a core setting (`claude.command`) and the profiles a
  chat setting: an app started from the Dock has no shell `PATH` or `CLAUDE_CONFIG_DIR`.
- A fake adapter in `src/shared/` plays scripted entries for the tests and the self-test, so the seam has two
  adapters now.
- The adapter, not the chat, reads Claude's JSON: it turns stdout events into chat entries (streamed text updates
  one entry in place; a tool call and its result are one entry, paired by tool use id). A layout reads an entry's
  raw events for anything the entry does not name.
- **Raw entries**: the adapter folds related events into their entries and gathers the rest into one raw entry per
  turn, re-sent under one id as it grows (the start hooks open the first). An event of a type the adapter has no
  name for gets a raw entry of its own, since it signals a new CLI event.
- **Controls**: the adapter declares its controls and reports their current values; the chat draws whatever it
  declares. Claude changes `mode` by a `set_permission_mode` control request and `effort` and `model` by sending
  `/effort <value>` and `/model <value>` as messages (`claude-stream.md` records each on the installed CLI). The
  adapter reads Claude's values like this: `default` mode is the `manual` choice; effort stays unset (null) until a
  `/effort` succeeds, since no event reports it; the model comes from the init event and the last successful
  `/model`, a full model name shown as its alias.
- **Interrupt**: Ctrl+C ends the running turn by an `interrupt` control request; the process stays open for the next
  message. A SIGINT would end the process.
- A result entry's `costUsd` is the difference between consecutive results, since Claude's `total_cost_usd` is
  cumulative for the process; a total below the last one gives `null`.
- **Locality**: listing a folder's past sessions and reading a transcript into chat entries are adapter
  calls, so Claude's undocumented transcript format stays in the adapter. A line it cannot read becomes a raw entry.
- Slash commands typed in the chat run as in the terminal (`/model`, `/compact`, `/wigley:feature …`), except the
  app slash commands, which the app runs itself (§ Chat plugin).
- **Messages carry images**: `AgentProcess.send` takes `{ text, images }`, each image `{ mediaType, data }` (base64,
  no `data:` prefix), and the `user` chat entry carries the same `images`. Claude sends them as `image` content blocks
  before the text block (`claude-stream.md` § Images); a resumed transcript's image blocks come back as the user
  entry's `images`, and the CLI's `isMeta` `[Image: source: …]` record shows nothing.
- **Accounts**: `accountStatus(profileDir)` gives `{ signedIn, account }` (`account` the adapter's one-line label,
  for Claude the email and the subscription); `logIn(profileDir, events)` starts a sign-in that reports its fallback
  link and its end, and takes a pasted code and a cancel; `logOut(profileDir)` signs out. Claude runs
  `claude auth status --json`, `claude auth login` and `claude auth logout` with the session launch's environment
  (`claude-stream.md` § Auth). The login's exit code is not measured, so Claude reads the status as the login starts
  and again when it exits: the sign-in finished only when the profile then reads signed in and the login exited 0,
  the profile was signed out before, or the account changed.
- **Project folders**: `listProjects(profileDir)` gives every folder the harness has saved sessions in, each with its
  newest change, so the folder step can offer them; for Claude, one transcript head per project folder names it.

## Sessions and tabs

- `sessions` main gains `open(info)` for an owned session: the row is added at once and the contributed tool sessions
  start. A relay connection whose hello carries an owned session's host id joins that session's entry, its calls
  routed to those tool sessions, instead of adding a row; the relay going away ends nothing, and a later relay joins
  again. A newer relay takes the join from an older one still connected (the harness restarting its MCP connection),
  and the older relay's later end leaves the join alone. The owned session's `end()` drops the row. Joining depends on the child not inheriting the parent's
  `CLAUDE_CODE_SESSION_ID` when the app was started from a Claude Code terminal, so the launch strips the
  nested-session environment (`claude-stream.md` § Launch). Closing an owned
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
- **Chat tab**: the entries under a floating composer: a vim message box, the box's vim mode, each control's value
  as a chip, and send (changed by ui-design plan C). Enter in normal mode sends, Enter in insert mode adds a line, Cmd+Enter sends from any mode. `i` /
  `a` focus the box, `j` / `k` move between entries, `Enter` expands a tool call, `G` jumps to the latest, Ctrl+C
  interrupts. Tool calls show one compact line (tool name and a short input summary) that expands to the full input
  and output. These keys act only on the Chat tab on screen and its session: on any other tab or mode they do
  nothing, and the control pickers and the chat's dialogs close when another session's Chat tab shows (the start
  prompt and the sign-in dialog, tied to no session, stay open).
- **Controls**: raw `m` mode, `e` effort, `o` model in the chat scope (`<Leader>cm` / `ce` / `co` in the composer box),
  each opening a picker of its choices; raw `c` (`<Leader>cc` in the box) lists every control, so a control a new
  adapter declares is reachable before it gets a key (changed by ui-design plan C).
- **Start prompt**: `Space k n`, in the overlay layer: `j` / `k` and Enter, `/` to filter. It picks the folder, then
  the profile (a single profile is not asked; the last profile used in a folder is pre-selected). Esc at any step
  starts nothing. The folder step lists, newest first, the folders the app started sessions in (`recent-folders.json`
  in chat's plugin data) merged with every folder each profile's harness has saved sessions in (`listProjects`),
  one line per folder, its newest use and the profile of that use kept. A path that is no longer a folder, one that
  sits in an OS temp folder (`MainServices.tempFolders`), and one whose check fails (logged) are left out, and the list
  holds the newest 40 of the rest; `Choose folder…`, the native folder dialog, is last.
  After the profile, chat reads the profile's account status: a signed-out profile opens the sign-in dialog, and a
  finished sign-in goes on to the session step. A status that cannot be read is logged and the prompt goes on.
- **Sign-in dialog**: one at a time, in the overlay layer over the `chat.signIn` scope: "Finish sign-in in your
  browser", the fallback link with a Copy button, and a vim box for a code the browser page shows, which Cmd+Enter
  (or Enter in the box's normal mode) sends. Esc cancels the sign-in. When the sign-in ends the dialog closes; a
  confirmed sign-in toasts `Signed in to <profile> as <account>`, any other end toasts `Sign-in failed: <reason>`, and
  a sign-in that cannot start toasts `Sign-in not started: <reason>`. Asking for a second sign-in while one runs
  focuses the open dialog.
- **App slash commands**: chat's page exports `addSlashCommand({ name, description, run })`, returning a
  `Disposable`. Sending a box whose trimmed text is `/name` or `/name <args>` with `name` registered runs
  `run({ sessionId, profile, args, ended })` in place of sending, and clears the box; attached images stay. A registered
  name wins over the agent's command of the same name. The `/` completion offers the registered names first, then
  the agent's, without repeats. A handler reports through chat's `notice` channel call, which adds a notice entry
  main keeps, or through a toast in an ended session, which has no entries to show it. Chat registers `/login` (the sign-in dialog for the session's profile), `/logout` (signs the profile
  out; a notice says so) and `/status` (a notice: `<profile>: signed in as <account>` or `<profile>: not signed in`).
- **Images**: pasting an image file into the composer, or dropping one anywhere on the Chat tab, attaches it: PNG, JPEG, GIF and WebP whose base64 text is at most
  5 MB (the API's per-image limit, which counts that text); any other file is refused with a toast. Attached images show as a strip of
  thumbnails above the message box, each with a remove button; `<Leader>cx` removes the last one. Send sends the
  text with the images, or the images alone. A sent user entry shows its images as thumbnails under its text;
  clicking one, or Enter on the focused entry, opens the image viewer over the `chat.image` scope: the image fitted
  to the window, `h` / `l` the entry's previous and next image, Esc closes. The chat layout kit's `images()` part
  draws the thumbnails, so a user layout gets the viewer too.
- **Completion popup**: the editor adapter draws CodeMirror's popups on the page body, so the composer's scroll box
  does not clip the slash completion list.
- **Permissions**: sessions run in auto mode; anything auto mode would still prompt reaches chat's `permission_prompt`
  MCP tool, contributed to sessions as forms contributes its tools, and shows as a permission entry. `y` allows, `n`
  denies and opens a box for an optional reason Claude reads, each answering the oldest pending permission of the
  session on screen.
- **Status**: a row's tab status reads what the chat is doing — working, waiting for a permission — and is empty
  while idle.
- **Turn finished**: when the window is not focused or the session is not on screen, the same alert as a round, and
  the row is marked.
- **Slash completion**: typing `/` at the start of the box offers the session's commands and skills, from Claude's
  startup event, and Tab accepts. It runs through CodeMirror's completion (`@codemirror/autocomplete` 6.20.3, already
  on disk, added as a direct dependency) inside the editor adapter, behind an option on the editor contract.
- **Resume and archive**: after the folder and profile, the start prompt offers a new session or one of the folder's
  saved sessions (terminal and app alike, newest first, labelled by first message and time; one the app has open is
  left out), resumed with its earlier conversation read from the transcript. `x` archives the entry under the
  cursor or restores an archived one; `.` shows or hides archived entries. When the transcript cannot be read, the
  chat shows one notice and the session still resumes. Archived ids live in chat's plugin data; Claude's
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

- **Plan A — the loop** (landed 2026-10-20, its plan folder closed): the spike, the harness seam with the Claude and fake adapters, ACP removal,
  owned sessions, take over and `mark`, the shared layout machinery, the chat plugin with its default layout,
  permission cards, controls, alerts, and the start prompt with profiles and recent folders.
- **Plan B — resume and completion** (landed, its plan folder closing): resume with history, archive, slash
  completion.
- **Plan C — chat usability** (planned 2026-10-23, `plan-chat-usability/`): sign-in from the app, app slash commands,
  the merged folder list, pasted images with previews, and the completion popup drawn outside the composer.

## Out of scope

In `docs/features/followups.md`: Codex and wigley-harness adapters, a read-only view of terminal sessions, files
other than images pasted into the chat, "Always allow" on a permission card.
