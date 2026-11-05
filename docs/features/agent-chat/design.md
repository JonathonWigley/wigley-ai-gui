# Agent chat — design

**Contents**

- **Intent** — what the feature gives the user.
- **Vocabulary** — the terms the code and plans use.
- **Flow** — a session from start to end, with a form swapping in and back.
- **Agent harness seam** — the contract, the Claude adapter, the fake, chat entries, controls, images, accounts.
- **Sessions and tabs** — owned sessions, joining the relay, take over and give back, the attention mark.
- **Chat plugin** — the Chat tab, activity lines, the activity dock, the start prompt, sign-in, app slash commands, images, permission cards, alerts, keys, starting a session from an agent.
- **Layouts** — chat layouts on the core layout service and the page host.
- **Plans** — what plans A to F each land.
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
  thinking, a tool call (with its result and the id of the agent that made it: `main` for the session's own agent,
  else the subagent's id the agent events use), a permission request, a turn result, a notice, or a raw entry. Every entry
  carries the raw harness events it was built from. Of Claude's stream events it keeps only a text or thinking block's
  `content_block_start`; every other stream event is left out, since the entry's start event or the final `assistant`
  event already holds what it carries. Every entry carries `at`, the epoch milliseconds it first appeared; a later
  version of the entry (same id) keeps it. The Claude adapter stamps a live entry through its injected clock and a
  history entry from its transcript line's `timestamp` (a line with none takes the time of the last line that had one,
  whether or not that line made an entry, `0` before any); chat main's own notices and permission entries, the layout
  preview's notices and the fake's live entries take their clock's time, while the preview's sample entries and the
  fake's history entries carry fixed times.
- **Step** — a `tool`, `thinking` or `raw` chat entry. A **run** is the steps between two other entries (user,
  assistant, permission, notice, result): any other entry ends it. The **live run** is the run that is the last entry
  while the session is working (`running` and activity `working`); every other run is finished.
- **Activity line** — a run as the Chat tab draws it under a chat layout that sets `activityInTranscript`: one slot
  and one cursor stop, drawn by the chat layout's `activity` part (§ Activity line). The default layout draws none.
- **Activity dock** — the composer row that shows the running turn, then the finished turn's one line, drawn by the
  chat layout's `working` part (§ Activity dock).
- **Session control** — a setting of a running session the harness adapter declares (id, label, choices, current
  value): Claude declares `mode` (permission mode), `effort` and `model`.
- **Profile** — a named Claude config folder (`work` → `~/.claude`, `personal` → `~/.claude-personal`); it sets the
  login, plugins, settings and where transcripts live. Picked with the folder when starting a session.
- **Owned session** — a session the app started; its row exists from start and stays, across a quit and relaunch
  (its process still running in the session host) and after its process ends on its own, resting until the next message starts the process again, until the user
  closes the row (§ Saved sessions). A
  **connected session** is one a relay connection brought (a terminal session), as today.
- **Take over** — a session tab selecting itself and later giving the session back to the tab shown before.
- **App slash command** — a `/name` the app runs itself when typed in the message box, instead of sending it to the
  agent. Any plugin registers one through chat's page exports. Chat registers `/login`, `/logout` and `/status`, the
  terminal-only commands print mode refuses (`claude-stream.md` § Terminal-only commands), and `/clear` with Claude's
  names for it, `/reset` and `/new` (§ Flow, Clear).
- **Sign-in** — signing a profile in to its harness account, run by the harness adapter (`claude auth login` for
  Claude) and shown by chat in the sign-in dialog. **Account status** is whether a profile is signed in, and as whom.
- **Attached image** — an image pasted or dropped on the Chat tab, shown as a thumbnail above the message box and
  sent with the next message. A paste whose plain text is more than the name of a pasted file or a single URL is a
  text paste: the text goes to the editor and no image is attached (spreadsheet and word-processor copies carry a
  picture beside the text). Blank text, a file name or a lone URL (a Finder copy, Copy Image) attaches the image.

## Flow

```
 Space k n ─► start prompt (overlay): folder (the app's recent folders and every folder the harness has sessions in,
                 │                     newest first, or the folder dialog), then profile (skipped with one profile),
                 │                     then sign-in when that profile is signed out, then a new session or one of the
                 │                     folder's saved sessions to resume; a registered resume section sits at the top of
                 │                     the folder and session steps (`docs/features/session-log/design.md`)
                 ▼
 chat main ─► sessions.open(info with a fresh host session id, or the saved one's on resume) ─► row + Chat tab, selected
          └─► AgentHarness.start(...) ─► claude -p --input-format stream-json --output-format stream-json
                                            --include-partial-messages --verbose --session-id <id> (--resume <id> on resume)
                                            --permission-mode <the row's mode, auto without one> --permission-prompt-tool <chat's tool>
                                            (--model <m> and --effort <e> when the user picked them and Claude confirmed)
                                            (--append-system-prompt <the registered instructions>, none when no plugin added any)
                 │ claude starts the wigley plugin's relay.py, whose hello carries the same session id
                 ▼
 sessions relay ─► connect(info) finds the owned session by host id ─► joins its row (no second row)

 user types ─► message box (vim), images pasted or dropped ─► Enter / Cmd+Enter
          ├─► `/name` an app slash command registered ─► its handler runs in the page; nothing goes to the agent
          └─► otherwise ─► chat main ─► AgentProcess.send({ text, images }) (Cmd+Enter during a turn: every unsent
              pending message first, § Pending messages, Send now)
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
- The Claude adapter is `src/main/claude-code/`, the only place the app builds the `claude` command; the session host
  (`docs/features/session-host/design.md`) spawns it. It runs the installed CLI,
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
- **Controls**: the adapter declares its controls and reports their current values; the chat draws whatever it declares.
  Claude changes `mode` by a `set_permission_mode` control request and `effort` and `model` by sending `/effort <value>`
  and `/model <value>` as messages (`claude-stream.md` records each on the installed CLI). The adapter reads Claude's
  values like this: each control starts at the value the start carries, so a new row starts with its mode at `auto`, the
  value the launch passes, and its model and effort unset (null) until the first `get_settings` reply, and a resumed
  or cleared row starts with the row's mode and the model and effort the user picked; `default` mode is the `manual`
  choice; the model and effort also come from a `get_settings` control request, sent at process start and after each
  turn, local commands included, because no event reports effort and a default depends on the model, the flags and the
  profile: the reply's `applied` values replace the held ones, so the chips show what the process uses, or unset for a
  model with no effort. The last successful `/effort` or `/model` with a value among the control's choices also sets
  its control, and `/effort auto` clears effort until the reply. Claude answers a value it refused with a `success`
  result too, so any other value leaves the control alone, and the reply shows what Claude applied. The model also
  comes from the init event, and a full model name shows as its alias. A failed `get_settings` is logged and changes
  nothing.
- **Interrupt**: Ctrl+C ends the running turn by an `interrupt` control request, and stops every running subagent and
  background task by that request and a `stop_task` for each, with a turn running or none (claude-stream.md § Subagents,
  Probe 7); the process stays open for the next
  message. A SIGINT would end the process. Ctrl+C always ends the running turn (a message queued behind it still
  runs): when neither the turn's result nor an answer that leaves nothing running arrives within 5 s, the adapter
  drops its turn state, posts the notice `Claude did not stop within 5 s; showing the session idle.` and shows idle. A
  second Ctrl+C while that 5 s grace is pending and the session still works posts `Interrupted again; ending the
  Claude process.` and ends the `claude` process; the row rests and resumes on the next message.
- A result entry's `costUsd` is the difference between consecutive results, since Claude's `total_cost_usd` is
  cumulative for the process; a total below the last one gives `null`.
- **Locality**: listing a folder's past sessions and reading a transcript into chat entries are adapter
  calls, so Claude's undocumented transcript format stays in the adapter. A line it cannot read becomes a raw entry.
- Slash commands typed in the chat run as in the terminal (`/model`, `/compact`, `/wigley:feature …`), except the
  app slash commands, which the app runs itself (§ Chat plugin).
- **Commands**: `AgentProcessEvents.commands` reports the session's commands and skills as the whole list of
  `AgentCommand` records each time: `name` and `aliases` without a leading `/`, and `description` and `argumentHint`
  (`''` when none). The Claude adapter writes an `initialize` control request as the first stdin line of a started
  process, because `init` waits for the first message (`claude-stream.md` § Initialize), and reads the answer's
  `commands` as the records. Each `init` then replaces the list: an `init` name takes the held record of that exact
  name; a name with none then takes the first record left that holds it as an alias; a name that matches none becomes a
  record with empty text; a record no name took drops. An `init` with no names leaves the list. The list reported adds
  the name after a `plugin:name` record's first `:` to its aliases, and the held records stay as the CLI listed them, so
  the merge never matches on it. The session fold owns the records, so a failed `initialize` answer
  only logs and leaves the list to `init`, the answer stays out of the chat entries, and a re-attach rebuilds the
  records from the pipe log and writes no `initialize`. A process that started before the request existed has no such
  line in its log, so its list comes from `init`.
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
- **Chat tab**: the entries under a floating composer: a vim message box and, under it, a status line, drawn in this order: repo, branch, the key prompts (`i`/`a`, then `J`, `K`, `V`, `y`, with no labels), the model · effort chip, every other
  control's chip, the status parts other plugins add (usage: spend), the running indicator. `J`, `K`, `V` and `y` carry no labels because labelled they overflowed the line at minimum width, and hiding them when narrow hid them in the default window. The box's cursor shape shows
  the vim mode (changed by ui-design plan C). Enter sends in insert and normal mode, Shift+Enter in insert mode adds a line, Cmd+Enter sends from any mode, and while a turn runs sends the pending messages with it (§ Pending messages, Send now). `i` /
  `a` focus the box, `j` / `k` move between blocks, `J` / `K` jump between messages, `V` starts or ends a range, `y`
  copies the range as markdown source while one is open (a range with nothing to copy, on an activity line or a permission card, toasts that and stays open), else allows a waiting permission, else copies the block, page `Esc` cancels the range, and a
  plain click moves the cursor to the block under it. A block is a paragraph, heading, top-level list item, code block,
  table or quote of a user or assistant message; any other row is one stop, and the turn and compaction dividers are
  none. When the transcript scrolls away from the cursor, it moves to the nearest block wholly in view; a block too tall for the view counts while any of it shows; with no such block, it moves to the nearest that shows. `j` or `J` onto the last stop scrolls to the bottom and follows, unless the stop is too tall for the view: then its start shows, and it follows only once a scroll lands on the bottom. A layout gets block stops when it draws the text with `kit.markdown`; an entry with no marked block has one stop; a body drawn later is not read until the next redraw; copy reads source lines by position, so copy per block needs the layout to draw `input.text` itself. `Enter` opens or closes
  the entry holding the cursor or the focused activity line and pulls back a focused pending message, `G` jumps to the latest, Ctrl+C interrupts and pulls back every unsent pending message
  (§ Pending messages). The transcript shows the messages, permission prompts, notices, turn dividers and pending rows; the agent's
  steps show in the session hub's activity dock (§ Activity dock), and in the transcript as
  activity lines only under a layout that sets `activityInTranscript` (§ Activity line). Each `result` entry is a
  turn divider, its step count the main agent's steps since the last user message or result. While the box
  has focus no entry is marked and the box draws no focused frame; once it loses focus (Esc) the cursor's block (the entry, when it has no blocks) shows a
  thin left bar (DESIGN.md § Keys and focus). These keys act only on the Chat tab on screen and its session: on any other tab or mode they do
  nothing, and the control pickers and the chat's dialogs close when another session's Chat tab shows, or when the
  shown session's process exits (the image viewer stays open then; the start prompt and the sign-in dialog, tied to
  no session, stay open). A resting session (§ Saved sessions) keys in the
  same `chat.chat` scope as a running one; interrupt and the control pickers log and do nothing until its process
  runs.
- **Activity line**: under a chat layout that sets `activityInTranscript: true`, the entry list groups each run into
  one slot, a cursor stop, drawn by the layout's `activity` part. The
  default layout sets it `false`: the list then builds no slot and no cursor stop for a run or its steps, and the agent's work shows in the activity dock alone. A user layout that leaves the flag out takes
  `default`'s. Everything below holds while the flag is `true`.
  - **Time**: each line ends with how long its run took, from the entry before the run (the user message or mid-turn
    assistant text; a run that opens the list starts at its first step) to the entry after it, compact in tabular
    numerals: `8s`, `42s`, `1m 05s`, `1h 02m`. A live line's time ticks once a second to now, so it covers the
    thinking before the first step; only that line redraws. A finished run that is the last entry ends at its last
    step.
  - **Live run**: drawn as a finished run's line that grows as steps arrive, its time ticking; the activity dock
    (below) carries the live look.
  - **Finished run**: one dim line, the step count, the tools used and the time, such as
    `6 steps · Read 3 · Bash 2 · Edit · 42s` (most used first, a single use named alone); a failed tool step adds
    `· 1 failed` in the error colour before the time.
  - **Open**: Enter on the focused activity line, or a click on it, opens it, and again closes it. The open line keeps
    its summary line and lists one plain row per step under it, each drawn by the `tool`, `thinking` or `raw` entry
    builder; each step row is a cursor stop, `j` / `k` walk into them, and Enter on a step row opens its input and
    result in place. Closing the line makes it one stop again; a cursor on one of its steps moves to the line. A cursor
    following the last activity line stays on it as steps arrive, and `G` lands on that line, until the open run
    overflows: at the bottom, whether or not the list had to scroll there, the cursor moves to the nearest step in view, and it follows the last step from there. A line stays open or
    closed by itself across a layout reload, a history read and the live run finishing.
  - Permission prompts, notices and the turn result stay entries of their own, and each ends the run before it.
  - The key log lines are `focused activity line`, `expanded activity line` and `collapsed activity line`; a step row
    logs as its entry kind does (`focused tool entry`).
- **Activity dock**: the Main agent section of the session hub (`docs/features/chat-bar/design.md` § The session hub),
  drawn by the layout's `working` part. While the hub is not visible, the layout's `workingLine` part draws its time and
  state, or its finished line, into the composer's `working` slot, under the composer parts and above the attached images
  and the box; while the hub is visible and the turn runs, the same part draws the time and state as the turn line, the
  transcript's row after the last entry, which is no cursor stop; all read one dock. It shows the running turn while the session works on one or waits on a permission answer (the harness reports `working`
  or `waiting`), then the finished turn's one line until the user sends the next message. While the session is idle with
  no finished turn to show, the slot is hidden and takes no space. It is display only: not a cursor stop, and it adds no
  key. It counts only the main agent's tool calls (a `tool` entry's `agentId` is `main`); a subagent's calls show in its
  agent strip box. Settled from the user's sketch in an interview on 2026-11-02, and moved into the composer in a second
  interview that day (`docs/features/chat-bar/plan-activity-dock/`), then into the session hub on 2026-11-03.
  - **Header**: the turn's time, the state word, and `…`: `1:05 Working…`. The time counts from the turn's first
    entry to now: the later of the last user entry (a queued message from when it was sent) and the entry after the
    last result, so a turn Claude starts on its own after a background task counts from its own start. While the
    turn holds no entries, the dock keeps what it showed: a live dock drawn then counts from when it was drawn, and
    one live when the result lands keeps the finished turn's live look until the session goes idle. It ticks once a
    second, as `m:ss` (`h:mm:ss` past an hour).
  - **State**: one of four, the first that holds: **Waiting** while a permission entry in the turn is unanswered,
    **Working** while a tool in the turn has no result, **Writing** while the last entry is streaming assistant
    text, else **Thinking**. A pure module picks it, so a layout only words it.
  - **Action box**: the main agent's latest tool calls in the turn, oldest first and the newest highlighted, each the
    tool and what it acted on, a file path as its file name (`Read chat-kit.ts`, `Bash npm test`). The built-in
    layout shows 3 and lists tool calls only: thinking shows as the state. The part's input carries every step of
    the turn but the subagents' tool calls, so a user layout may list more.
  - **Tool counts**: every tool the main agent used in the turn with its count, most used first, always numbered:
    `Read 3 Bash 2 Edit 1`.
  - **Finished line**: once the session goes idle, the dock shrinks to one dim line: the word, the time, the cost
    and the tool counts, `Done · 1m 05s · $0.57 · Bash 6 · Read 2`. The finished turn is every entry since the
    user's last message, so a turn Claude ran on its own after it (a `success` result) joins it, and the line
    updates in place when such a result lands before the user sends again. The word is `Done` when the last result's
    stop reason is `end_turn` or `success`, else the stop reason itself (`max_tokens`). The time runs from the
    user's last message to the last result, compact (`8s`, `1m 05s`, `1h 02m`). The cost is the sum of every result's
    cost since that message, in cents (`$0.57`); a result with no cost adds nothing, and the line shows no cost when
    no result has one. A finished turn with no result entry (the process ended without one) shows no line. Sending
    the next message starts the next turn's live dock in its place.
  - **No live cost**: Claude reports cost only when the turn ends (`claude-stream.md` § Result), so only the
    finished line shows it. A live estimate from token counts and a price table was rejected for keeping Claude's
    prices out of the app.
- **Pending messages**: a message sent while the harness reports the session's turn running (the process runs and
  its own activity is not `idle`) is not written to the agent. A turn Claude runs on its own after a background task
  ends counts as running too: the session shows working through it, its messages wait, and the turn-finished alert
  fires when it ends. Written into a running tool turn, Claude would fold a message into it with no turn of its own
  (claude-stream.md § Queued messages), so chat holds it until the turn ends, unless the user sends it now (Send now
  below). A permission call left waiting after the turn ended
  queues nothing; a running turn waiting on a permission still queues. Chat main holds the message in the session's
  queue (`ChatSessionState.queued`, oldest first, each with an id of its own; kept across a page reload, and saved
  with the session's record so a relaunch that re-attaches the session shows and sends them,
  `docs/features/session-host/design.md` § Re-attach), and the Chat tab shows it as a pending row after the last entry, drawn by the layout's `queuedMessage` part:
  dim, with a `pending` label on its own line above the text (`pending · 2 images` when it carries images; `sending` in place of `pending` once sent now). The code names these **queued**
  messages, after claude-stream.md § Queued messages, since `pending` already names chat main's permission calls and a
  restored session's unread history.
  - **Sending**: when the harness reports the turn ended (activity `idle`) and a message is queued, chat main writes
    the oldest unsent queued message to the agent and swallows that `idle`: the activity the session shows does not change,
    so it shows no idle between turns. Each queued message runs as its own turn, in the order sent, so the
    turn-finished alert fires once, after the last one. A write that throws puts the message back at its place in
    the queue and logs `queued message <id> not sent: <error>`. Every message, sent at idle or sent now, joins the
    transcript as its user entry when the agent takes it in, at the place it really ran: the Claude adapter adds the
    entry on the message's `started` lifecycle line (claude-stream.md § Message lifecycle), or at the write when the
    CLI's init has reported no lifecycle; a message sent before that init joins on it. `AgentProcess.send` returns
    the id that entry will carry.
  - **Send now**: two routes write a message to the agent at once, ahead of the rest of the queue. Cmd+Enter on the
    focused pending row, with the box unfocused, sends that row only (`chat.sendNow`, bound to `<D-Enter>` in
    `chat.chat`); the rest of the queue keeps waiting in order. Cmd+Enter in the box, while the harness reports the turn
    running, sends every unsent pending message in the order written, then the box's text and images as a last
    message; with the box empty it sends the pending messages alone and leaves the box and the entries as they are,
    and with no unsent pending message it sends nothing and logs `nothing to send`, as Enter does. While the turn
    runs the status line's running indicator shows `⌘↩ send now` beside `stop`. While the session is idle it sends the box as
    Enter does, and an app slash command in the box runs as on Enter. Claude folds a message sent now into a running
    tool turn at the turn's next model request, or runs it as its own turn straight after a turn with no tool call
    (claude-stream.md § Queued messages). The page logs `sending a pending message now in <session>` for a row and
    `sending now in <session>` for the box; a refused call logs `sendNow failed: <error>` or `sendAllNow failed:
    <error>`, and a refused box message goes back into the box. Main logs `nothing to send now in <session>` when
    the box call finds nothing unsent and no message. Main writes each message and keeps its row in the queue,
    marked sent (`QueuedMessage.sentEntryId`, the id `send` returned), and the row's label reads `sending` until the
    entry with that id arrives, which drops the row. A send-now for a message no longer queued does nothing and logs
    `queued message <id> no longer queued`; one for a sent row does nothing and logs `queued message <id> already
    sent`. A write that throws leaves the row unsent, logs
    `queued message <id> not sent: <error>` and stops the box call there. When the harness reports the agent dropped a sent message without taking
    it in (`AgentProcessEvents.messageDropped`: Claude's `cancelled`, `discarded` or `refused` with no `started`
    before it), main returns it to the box and logs `sent message <id> returned: never taken in`; main holds every
    message it writes, idle sends included, until its entry arrives, so a dropped idle send returns the same way. The
    event carries the message, so one written before a relaunch returns too: a drop the re-attach's replay finds, one
    that comes live after it, and one the replay left held when the process closes. The saved record keeps the ids
    returned for its process, so a replay of a drop already returned logs `dropped message <id> already returned` and
    returns nothing.
  - **Returned messages**: every return (a pull-back, an interrupt, a clear, a process end, a drop) stays with the row
    until the page puts it in the box, because the `returned` message is lost when no page or tab hears it, as during
    a re-attach's replay at startup. Main holds each message in `ChatSessionState.returned` (each with an id of its
    own) and in the saved record. The page puts them in the box when the `returned` message arrives, or when the tab
    mounts for those its state holds, then calls `returnedPlaced`, and main drops them from the state and the record.
    A quit before that keeps them: the relaunched row returns them to the box again.
  - **Pulling back**: a pending row is a cursor stop after the last entry, so `G` and a following focus land on the
    newest pending row when any exist. Three routes pull a message back: Enter on the focused row, a click on it, and
    `<Leader>cp` in the box, which pulls back the newest unsent. Each logs `pulling back a pending message in
    <session>` (`no pending message in <session>` for `<Leader>cp` with no unsent row). Main takes the message out of the queue and returns
    it, and the page puts it into the box the way a refused message goes back: its text on its own line above
    anything typed, its images ahead of any attached. `putBack` returns whether the box took the messages, and each
    caller logs its own line: `pulled back <n> message(s) in <session>`, or `put the refused message back in
    <session>` for a refused send. A pull-back for a message no longer queued (already written to the agent, returned,
    or pulled back) does nothing and logs `queued message <id> no longer queued`; one for a sent row, which the agent
    already holds, does nothing and logs `queued message <id> already sent`. A `returned` for a session with no tab logs
    `returned for unknown session <id> ignored`, and main holds it for the tab's mount. The key log lines are `focused pending message` for `j` / `k` onto a pending row and
    `following the latest entry` for `G`.
  - **Interrupt and exit**: Ctrl+C returns every unsent queued message, oldest first, then interrupts the running
    turn; the oldest ends at the top of the box. A sent row stays: Claude's interrupt cancels nothing it holds, so the
    message runs as its own turn straight after (claude-stream.md § Queued messages, B). A process that exits, and Clear,
    return every queued message, sent rows included, and every written message not yet taken in, in the order written
    (a row counts from when it was queued, a message with no row from its write), so nothing is
    written to a process started later without the user sending it again.
  - App slash commands run at once, working or not, and never queue; the agent's slash commands queue like any
    message.
- **Saved sessions**: every session chat runs — started, resumed, or launched by another plugin — is saved in
  `open-sessions.json` in chat's plugin data: its host session id, folder and profile, its `titles` (the user, agent
  and first-message titles; a file without them reads as untitled), its last process's
  id, the controls and resume flag that process launched with, the controls the row holds and the values the user
  picked, the entry ids of the messages that process dropped which already went back to the box, and its unsent queued
  messages and the returned messages the page has not placed, with their images (a file without any of these reads as none), its `activeMs` (`docs/features/session-clock/design.md`; a file without it reads as 0), in row order, with the selected
  row (null when it names no row chat still holds), whether a message was ever sent, and whether a turn was running. A
  new, resumed or launched session is saved only after its process starts, so a start that fails leaves no record. Only
  the user closing its row removes a record; quit, `install-app`, a process exit and a chat plugin reload keep it.
  Plugin data is per app instance, so the stable and dev apps, drive runs and the self-test each keep their own list.
  Quit and `install-app` end no process: the session host keeps each one running, and quitting only disconnects the
  app from it (`docs/features/session-host/design.md`): chat's main part's stop saves once, detaches each held process, kills only a running process no row holds, and ends its rows, which removes no record. `chat.stopAll` (`<Leader>:`) ends the process of every owned session chat holds
  and leaves each row resting. On start, chat opens a row for each record, in order and unselected, then
  selects the saved row. A row whose process the host still holds is **re-attached**: the harness replays its pipe
  log, the row shows the transcript up to that process's start and then the process's own entries, and it carries on
  live (`session-host/design.md` § Re-attach). Every other row **rests**, holding no process. A record whose host id is already open, or whose open throws, is skipped and logged; a skipped record that holds queued or returned messages stays in the saved file, so the next start tries it again. A restored
  row that was ever sent to has its earlier conversation read from its transcript once, on the first show of its Chat
  tab or the first send, whichever comes first, while its profile is in the settings, so start reads no transcripts; a
  send reads it before starting the process, so the read never holds the new turn. The first message sent in a resting
  row starts its process (`--resume` when a message was ever sent, else `--session-id`); app slash commands run without
  one, its controls show what the record held, and the agent's slash commands and the controls' current values fill in
  once it runs. Every process start in a row passes, in `AgentStart.controls`, the `mode` the row holds now as
  `--permission-mode` (`auto` when the row holds none), whoever set it, since a mode narrows nothing: a `plan` Claude
  entered after the user approved its `EnterPlanMode` card carries over. It passes `model` as `--model` and `effort` as
  `--effort` only once the user picked them through `setControl` in the row and a controls report from the same process
  then held the picked value: a pick Claude refused, one a clear or exit cut short before it resolved, or one a newer
  pick replaced is never passed. The picked value is what a start passes, and a report never changes it, so a typed
  `/effort low` after a pick of High goes back to High at the next start. A report of no value for the control drops the
  pick: after `/effort auto`, or on a model with no effort, the next start passes none for it. A typed value outside the
  control's choices other than `/effort auto` reports nothing and leaves the pick alone, because Claude answers a value
  it refused with a `success` result too: `/effort hihg` after a pick of High keeps High. A model or effort Claude
  only reported is not passed, so a profile's own model (`opus[1m]`, `opusplan`, a pinned id), which the chip shows as
  its alias, is never narrowed to the alias. So a row resumed after its process exits, or cleared, keeps its mode and
  the model and effort the user picked, and its chips show them from the start. A restored row, re-attached or resting,
  keeps them the same way: its record gives it the held controls and the picked values, a replay's one report, the
  fold's final state, then replaces the held values and drops a pick only when its final value is null (a clear then a
  settings reply inside the replay leaves the pick), and its next start passes the mode it holds and the picks. A
  record with no controls opens with none and passes none, so its first start runs in `auto`.
  Every start also passes `AgentStart.instructions`, the text plugins registered through `addInstructions` in
  registration order, as one `--append-system-prompt` value joined with a blank line; no flag when none are
  registered. On a resume the Claude CLI sends the system prompt it recorded on the conversation's first request until
  compaction (`--system-prompt-snapshot`, on by default), so a resumed conversation keeps the instructions of its
  first launch.
  A session whose process exits while the app runs rests the same way, a notice in its chat giving the exit and its
  reason. A restored session whose turn was running when its process was lost (a reboot or a host crash, since quit
  ends none) gets a notice that the app quit during that turn; one whose
  profile is no longer in the settings gets a notice naming it, and a send there toasts that the message was not sent
  because the profile is missing, instead of starting. A message main refuses goes back into the box, above anything
  typed since, with its images ahead of any attached since. A resting row looks like an idle one in the sidebar. A file
  that cannot be read is logged (`open sessions not read`) and restores nothing, and the store refuses every save
  (logged `open sessions not saved: … unreadable`) so the file is never overwritten: it is the user's state. A later
  clean load lifts the refusal. Closing a row asks the end-session confirmation only while Claude is working, as before;
  closing removes the row for good but touches no transcript, so the session stays in the start prompt's saved-session
  list, unarchived.
- **Controls**: raw `m` mode, `e` effort, `o` model in the chat scope (`<Leader>cm` / `ce` / `co` in the composer box),
  each opening a picker of its choices; raw `c` (`<Leader>cc` in the box) lists every control, so a control a new
  adapter declares is reachable before it gets a key (changed by ui-design plan C).
- **Start prompt**: `Space k n`, in the overlay layer: `j` / `k` and Enter, `/` to filter. It picks the folder, then
  the profile (a single profile is not asked; the last profile used in a folder is pre-selected). Esc at any step
  starts nothing. `Ctrl+n` (`chat.startNewSession`) opens the same prompt and starts a new session straight after the
  profile and any sign-in, passing the session step over. The folder step lists, newest first, the folders the app started sessions in (`recent-folders.json`
  in chat's plugin data) merged with every folder each profile's harness has saved sessions in (`listProjects`),
  one line per folder, its newest use and the profile of that use kept. A path that is no longer a folder, one that
  sits in an OS temp folder (`MainServices.tempFolders`), and one whose check fails (logged) are left out, and the list
  holds the newest 40 of the rest; `Choose folder…`, the native folder dialog, is last.
  After the profile, chat reads the profile's account status: a signed-out profile opens the sign-in dialog, and a
  finished sign-in goes on to the session step. A status that cannot be read is logged and the prompt goes on.
  Opening the prompt again drops the earlier one: its answers and sign-in still to arrive are logged and go no
  further.
- **Sign-in dialog**: one at a time, in the overlay layer over the `chat.signIn` scope: "Finish sign-in in your
  browser", the fallback link with a Copy button, and a vim box for a code the browser page shows, which Enter (in
  either vim mode, since a code is one line) or Cmd+Enter sends. `Space c y` in the box's normal mode and the Copy
  button, which shows those keys, copy the link. The box opens in insert mode, so Esc first leaves insert mode and Esc
  again cancels the sign-in. When the sign-in ends the dialog closes; a sign-in that finished with no error and
  reads signed in toasts `Signed in to <profile> as <account>`, any other end toasts `Sign-in failed: <reason>` (a
  wrong code on a profile already signed in fails, though the profile still reads signed in), and a sign-in that
  cannot start toasts `Sign-in not started: <reason>`. Opening the dialog while it is open cancels its sign-in and
  starts the new one. Each open calls its caller back exactly once, so a start prompt opened again since never runs
  the old prompt's next step.
- **Clear**: `/clear`, `/reset` and `/new` (registered by the page's `clear-commands.ts`, each calling chat's `clear`
  channel call) end the row's process and start a fresh one at once in the same row, under a new host session id and
  with the row's mode and the model and effort the user picked (§ Saved sessions), so the harness loads its plugins,
  skills, MCP servers and settings again. A running turn is interrupted first; waiting permission calls are cancelled
  and written messages not yet taken in, then queued messages, are pulled back into the box, as on an exit; no exit notice shows for the old process and no
  turn-finished alert fires. The old process's later events are no longer live: none reaches the chat, but its
  `agentEvent`s that do emit keep the old host id, and its `sessionEnded` still emits; the agents roster folds each host
  id apart, so that `sessionEnded` drops only the old process's subagents. The row's active time returns to 0 (`docs/features/session-clock/design.md`). The row's entries become one info notice,
  `Conversation cleared`, followed by whatever the fresh process reports at start (its start step draws under the notice
  as a finished run, such as `1 step · 0s`), and chat logs `conversation cleared in <folder name>`. The row's host id
  moves through the sessions plugin's `OwnedSession.setHostSessionId(newId)`, which keeps the app session id and its
  tool sessions, updates the sidebar row and emits `hostSessionChanged` (main) and `sessionHostChanged` (page); it
  throws when another session holds the id. It changes the id inside the session's one info object, so the row's forms
  and primer sessions save and look up rounds under the new id. The old process's relay loses its join and its later
  tool calls are refused, and a late hello for the old id is refused rather than adding a row. The new process's relay
  joins the same row by the new id. Chat's saved record (with nothing sent yet), the session's docs source
  (`sessions.hostSessionChanged` disposes it and adds it again, and the page's `sessions.sessionHostChanged` rebuilds a
  Docs tab that has shown) and the notes page's session (`sessions.sessionHostChanged`) follow the new id, so a later
  resume reopens only the conversation after the clear; the earlier one stays in the past-sessions list. A resting row
  clears the same way, with no process to end, starting its fresh process; a start that fails leaves it resting under
  the new id. A clear for an unknown session, or after chat stops, logs `clear for unknown session <id> ignored` or
  `clear for session <id> ignored: chat is stopping` and does nothing. The app clears rather than passing `/clear` to
  Claude: Claude's own clear (measured on 2.1.314) keeps the same process, so its plugins and settings stay as loaded,
  and it moves the conversation to a new session id the row would not follow.
- **Sign-in identity**: main runs one sign-in at a time. The page names each sign-in by an id it picks, since the
  sign-in's link can reach the page before `logIn` answers; the link, the end, the code and the cancel all carry it,
  and the dialog ignores a message for any other id. A cancel stops the sign-in at once, so another may start, and
  the cancelled one's later link and end reach no page. Main cancels the running sign-in when the page loads again
  (the page's `loaded` message, sent once on each load) and when chat's main part is disposed, so a reload never
  leaves one running that refuses every later `/login`.
- **App slash commands**: chat's page exports `addSlashCommand({ name, description, run })`, returning a
  `Disposable`. Sending a box whose trimmed text is `/name` or `/name <args>` with `name` registered runs
  `run({ sessionId, profile, args })` in place of sending, and clears the box; attached images stay. A registered
  name wins over the agent's command of the same name. The `/` completion offers the registered commands and the
  agent's, without repeats (§ Slash completion). A handler reports through chat's `notice` channel call, which adds a notice entry
  main keeps, in a resting session too. Chat registers `/login` (the sign-in dialog for the session's profile), `/logout` (signs the profile
  out) and `/status`, each reporting through a notice, never a toast (`/logout`: `Signed out of <profile>`; `/status`: `<profile>: signed in as <account>` or `<profile>: not signed in`).
- **Images**: pasting an image file into the composer, or dropping one anywhere on the Chat tab, attaches it: PNG, JPEG, GIF and WebP;
  one whose base64 text is over 5 MB (the API's per-image limit, which counts that text) is shrunk to fit first
  (`docs/features/file-drop/design.md` § Images over 5 MB). Any other file goes into the box as a file chip, its path. Attached images show as a strip of
  thumbnails above the message box, each with a remove button; `<Leader>cx` removes the last one. Enter sends the
  text with the images, or the images alone. A sent user entry shows its images as thumbnails under its text;
  clicking one, or Enter on the focused entry, opens the image viewer over the `chat.image` scope: the image fitted
  to the window, `h` / `l` the entry's previous and next image, Esc closes. The chat layout kit's `images(parent)` part
  draws the thumbnails, so a user layout gets the viewer too.
- **Completion popup**: the editor adapter draws CodeMirror's popups on the page body, so the composer's scroll box
  does not clip the slash completion list.
- **Permissions**: a session runs in the `mode` its row holds, `auto` when it holds none; anything that mode would
  still prompt reaches chat's `permission_prompt` MCP tool, contributed to sessions as forms contributes its tools,
  and shows as a permission entry. `y` allows (with no range open), `n` denies and opens a box for an optional reason Claude reads, each
  answering the oldest pending permission of the session on screen.
- **Status**: a row's tab status reads what the chat is doing — working, waiting for a permission — and is empty
  while idle.
- **Turn finished**: when the window is not focused or the session is not on screen, the same alert as a round, and
  the row is marked.
- **Slash completion**: typing `/` at the start of the box offers the app slash commands and the session's commands
  and skills (§ Agent harness seam, Commands), and Tab accepts. The typed word fuzzy-matches each command's name
  and aliases through the app's fuzzy matcher (fzf), best match first; with text typed, the completion hands the
  matcher the commands shortest text first, so the shorter text and then the list's own order break ties. A row shows
  and inserts the full name, so `/feature` offers `/wigley:feature` first. It runs through CodeMirror's completion
  (`@codemirror/autocomplete` 6.20.3, already on disk, added as a direct dependency) inside the editor adapter,
  behind an option on the editor contract. While the popup is open its keys (`Ctrl+n` and `Ctrl+p` among them) run
  ahead of the page's chord binds.
- **Completion rows**: chat's page exports `addCompletionRow(draw)`, returning a `Disposable`. `draw(command, row)`
  gets the row's command (name, description, argument hint, aliases, and whether it is the app's or the agent's)
  and the row's element, an element inside the row after the name, empty at first and cut to the width the name
  leaves, and returns `true` when it drew. The most recently added draw goes first, and the first to return `true` ends
  the row; a draw that returns `false` or throws has the element cleared for the next; a row no draw takes shows the
  name alone. Chat adds its own
  draw through the same export: the description in a dim column after the name: most names fit one width, so their descriptions line up, a longer name pushes only its own, and each is cut to one line, to the width the name leaves, so a long name still shows as much description as fits (the `completionDescription` chat layout part), while the `completionDescriptions`
  setting is on (default on), else `false`.
- **Active time**: chat's page exports `activeTime(sessionId)`, a session's clock as an `ActiveTime` (null for a session the
  page does not hold), and fires `activeTimeChanged` when a session arrives and when main sends a clock; chat's `rowClock` layout part draws it on the
  side-bar row (`docs/features/session-clock/design.md`).
- **Resume and archive**: a plugin's resume section (`addResumeSection`, `docs/features/session-log/design.md`) lists above the folders and above the new-session line. After the folder and profile, the start prompt offers a new session or one of the folder's
  saved sessions (terminal and app alike, newest first, labelled by first message and time; one open in the app
  through the relay is left out, and picking one that has a chat row selects that row instead of opening a second),
  resumed with its earlier conversation read from the transcript. A resume lists the session host first, so a session
  never runs two processes: a process of the session running in the current host has the row open and attach to it,
  its history pending, as a restored row does; a process running in another app version refuses, and a host that
  cannot be listed rejects, each opening nothing. `x` archives the entry under the
  cursor or restores an archived one; `.` shows or hides archived entries. When the transcript cannot be read, the
  chat shows one notice and the session still resumes. Archived ids live in chat's plugin data; Claude's
  transcript files stay as Claude keeps them.
- **Self-test**: the self-test host takes one script per plugin and runs them in plugin start order, so chat's
  steps live in chat's own script over the fake adapter. The give-back rule is pinned by the tabs unit tests; the
  swap with a real round is a live check in the final verification.
- **Starting a session from an agent**: the `start_session` MCP tool opens a chat session through the same background
  launch Notes and Workflow use, so the row appears without taking focus. The tool is the only route from outside
  the window. A command-line route was rejected because it returns nothing to the caller, needs its own check of who
  is calling, and has no caller that lacks the relay. The app adds no approval and no cap: the calling session's
  permission mode gates the call, which has been checked on Claude only since a Codex caller's gate has had no live
  run, and the new row keeps every start visible. The relay re-sends a pending call after a dropped channel, so an app
  quit between the launch and the flushed answer can start a second session on return. This is accepted: the window is
  milliseconds, the extra row is visible, and de-duplicating would need the call id saved across a restart.

## Layouts

- Chat's layouts draw through the core layout service and the page host (`src/shared/page/layout-host/`), as every
  owner's do. Chat keeps its own contract, `default` layout, reader and kit parts.
- A **chat layout** builds each chat entry's element from the entry (with its raw events) and a kit of parts, like a
  forms layout builds cards: each builder takes `(parent, entry, kit)` and appends its element to `parent`. User chat
  layouts are folders in `~/.config/wigley-ai-gui/layouts/chat/`, reloaded on save; an entry that throws is rolled
  back and drawn with the default layout. The `chat.layout` setting names the user's layout.
- Besides the entries, a layout draws the Chat tab's other surfaces through parts that take `(parent, input, kit)`
  and return a `PartView`: `activity` (a run of steps, § Activity line), `working` (the activity dock in the hub's Main agent section, § Activity
  dock: the running turn's state, its steps and its times `startedAt` and `now`, sent again each second, else the
  finished turn's `done` state with its steps, `startedAt`, `endedAt`, stop reason and cost), `queuedMessage` (one pending message, § Pending
  messages: its text, how many images it carries, and whether it was sent now), `composer`, `statusLine`, `attachments` (the
  strip of attached images), `pickerRow` (a row of the start prompt and the pickers), `pickerHeading` (a heading in a picker's list, which the cursor skips), `signIn`, `reasonBox` (the deny
  reason), `closeConfirm` (the end-session confirm) and `imageViewer`. The `activity` part's input is the run's steps
  (each the step's entry input), the current step (the last), whether the run is live, whether it is open, and its times:
  `startedAt`, `endedAt` (null while live) and `now`, which the app sends again each second while the run is live, so a
  user layout formats its own time; the part draws the summary line open or closed, and the app places the step rows
  under it when open. The built-in step builders draw a plain one-line row through the kit's `collapsibleRow`; a user layout that redraws `tool`, `thinking` or `raw` draws the
  open line's rows. Each part's kit extends the base kit with the app parts it places (the editor frame, the
  dialog actions). The composer's kit places the `working` slot the layout's `workingLine` part draws into; a composer that leaves
  it out gets it just above the box. The app keeps the composer's box and its draft, the dialogs' frames and titles,
  the keys and the focus; a part a user layout leaves out draws with `default`.
- Beside its parts, a layout holds one flag, `activityInTranscript`: `true` draws the runs as activity lines
  in the transcript, `false` leaves them out of the list and the cursor. The flag is read through
  the same pick as a part: a user layout that leaves it out takes `default`'s, which is `false`.

## Plans

- **Plan A — the loop** (landed 2026-10-20, its plan folder closed): the spike, the harness seam with the Claude and fake adapters, ACP removal,
  owned sessions, take over and `mark`, the shared layout machinery, the chat plugin with its default layout,
  permission cards, controls, alerts, and the start prompt with profiles and recent folders.
- **Plan B — resume and completion** (landed, its plan folder closing): resume with history, archive, slash
  completion.
- **Plan C — chat usability** (landed 2026-10-23, its plan folder closed): sign-in from the app, app slash commands,
  the merged folder list, pasted images with previews, and the completion popup drawn outside the composer.
- **Plan D — slash completion** (`plan-slash-completion/`, settled in a four-round interview on 2026-10-23): the
  command list from `initialize` at start, alias and fuzzy matching on the fzf matcher (shared with every list picker
  and the Settings, keymap, Docs and Backlog filters), descriptions behind a setting, and the completion row hook.
- **Plan E — activity line** (`plan-activity-line/`, settled in an interview on 2026-10-30): the activity line, the
  chat focus outlines, and the `text-prose` token with its `fonts.proseSize` setting.
- **Plan F — clear command** (`plan-clear-command/`, settled in an interview on 2026-10-31): `/clear` as an app
  slash command restarting the row's process under a new host id, the sessions plugin's host-id change, and control
  values carried into every process start.
- **Plan G — working block** (`plan-working-block/`, settled in an interview on 2026-11-02): the turn's working
  block from the user's sketch, the live run drawn as its summary line, and the result entry's cost in cents.
- **Activity dock** (`docs/features/chat-bar/plan-activity-dock/`, settled in an interview on 2026-11-02): the
  working block moved into the composer as the activity dock with its finished line, the main agent's tool calls
  only (`agentId` on tool entries), and the `activityInTranscript` flag, `false` in the default layout.

## Out of scope

In `docs/features/followups.md`: Codex and wigley-harness adapters, a read-only view of terminal sessions, files
other than images pasted into the chat, "Always allow" on a permission card.
