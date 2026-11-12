# Scoped agents — settled design

**Contents**

- **What a scoped agent is** — an owned chat session per scope, and who uses one.
- **Registration** — the spec, the owner, the store seam and its two adapters.
- **Lifetime** — first ask, later asks, resume, a refused resume, the superseded close, `/clear`.
- **The pane** — the ask box, the chat view, the host's hooks, the log lines.
- **The tool check** — how a registration's tools refuse other sessions.
- **The layout and keys** — the `askBox` part and the `scoped-agents.ask` scope.
- **The self-test** — how the shared mechanics are driven.
- **Seams** — the plugin's parts and what each owns.

A scoped agent is a chat session a plugin owns for one scope of its own, such as a Practice problem or the whole
Backlog. The `scoped-agents` plugin holds the mechanics every such agent shares, so a tool that wants an agent beside
its view registers one and writes no session code. Practice's interviewer and Backlog's assistant are its two
registrations.

## What a scoped agent is

- A scoped agent is one chat session per (owner, agent id, scope):
  - the **owner** is the plugin that registered it
  - the **agent id** is unique within its owner (`interviewer`, `assistant`)
  - the **scope** is a string the owner picks: a problem's slug for Practice, `global` for Backlog's one assistant
- Its session is a row with an owner (`AGENTS.md` § Architecture, A chat pane): it has no row in the Sessions side bar
  and shows only in its owner's pane, through chat's `mountChat`.
- It carries the registration's instructions as the session's own instructions (`LaunchRequest.instructions`), not
  as a message, so they hold across `/clear`, a relaunch and a resume.
- It runs in the registration's folder for its scope, under chat's default profile. A launch or resume rejects with
  `Chat has no profiles.` when chat has none.

## Registration

- A plugin's main part calls `addScopedAgent(spec)` from `scoped-agents`' main exports and gets a `ScopedAgent`
  back: `ask(scope, text)`, `sessionOf(scope)`, `scopeOf(session)` and `dispose`.
- The owner is `spec.owner`: the registering plugin passes its own manifest id (`practiceManifest.id`,
  `backlogManifest.id`), which chat keeps as the owner of each row. The exports' consumer handle carries no plugin id,
  so the id comes in the spec. The registration is filed with the consumer's registrations, so it ends when the
  consumer stops. Disposing a registration launches and closes no session: its records stay in its store for the next
  start, and an ask in flight runs to its end.
- One live registration per (owner, agent id): a second throws `Scoped agent <owner>/<agentId> is already
  registered.`, and an ask or read for a pair with none rejects `No scoped agent <owner>/<agentId>.`
- `ScopedAgentSpec` holds:
  - `owner`: the registering plugin's manifest id
  - `agentId`
  - `folder(scope)`: the folder the session runs in
  - `instructions(scope)`: the session's own instructions
  - `title(scope)`: the title a resumed row takes
  - `store`: where each scope's record lives
- **The store seam.** `ScopedAgentStore` keeps one record per scope, `{ sessionId, hostSessionId }`, so the record
  lives where the owner's own state lives. Its methods:
  - `read(scope)` and `write(scope, record | null)`
  - `entries()`: the scopes' records, for `scopeOf` and for following `/clear`'s new host id; which scopes it lists is
    the store's rule
  - `superseded(scope)`: the record a fresh launch for the scope replaces, closed after the launch; null for none
  - `checkAsk(scope)`: rejects with the reason an ask may not launch now; resolves otherwise
- The store has two adapters:
  - Practice's keeps the current attempt's interviewer in the problem's `progress.json`. Its `entries` lists each
    problem's current attempt only; its `superseded` is the latest earlier attempt's interviewer; its `checkAsk`
    refuses a problem with no attempt (`<slug> has no attempt; open it first.`).
  - Backlog's keeps `assistant.json` in its plugin data. Its `superseded` is null; its `checkAsk` always resolves.
- A third use is one more registration and one more store adapter.

## Lifetime

- **One service.** The main part runs one service for every registration. Asks for one (owner, agent id, scope) run
  one at a time, each after the one before it settles.
- **An ask** runs `checkAsk(scope)` (its rejection is the ask's), then reads the scope's record. With none, it
  launches. With one, it brings the session back as `sessionOf` does and sends `text` to it. When that gives no
  session (chat refused the resume, or the record went away under the ask), it runs `checkAsk` again and launches for
  the scope's current state. This last case differs from Practice's interviewer before the move, which refused
  `<slug> has no interviewer; ask again.` when the attempt changed under an ask: the store cannot say an attempt
  changed, so the ask launches instead.
- **A launch** reads `superseded(scope)`, then launches the session through chat's `launch` with `text` as its first
  message and the spec's folder, instructions and owner, under chat's default profile. It waits for chat's
  `sessionOpened` to name the host id. A launch that gets no host id within two seconds logs
  `<agentId> <id> sent no sessionOpened in 2000 ms`, is closed, and fails `Chat sent no sessionOpened for <agentId>
  <id>.` On success the store writes the record; a failed write closes the row and fails the ask. The ask resolves to
  the session id.
- **Superseded close.** After a launch, the superseded record's row is closed when chat still holds it, since that row
  has no Sessions row the user could close.
- **Resume.** `sessionOf(scope)` resolves the stored session id, or null when the scope has none. When chat no longer
  holds the row, it resumes it through chat's main `resume`, with the spec's title, instructions and owner, and writes
  the new row id with the same host id. Concurrent calls for one scope share one resume.
- **Cleared resume.** A resume chat refuses writes a null record for the scope, then logs
  `<agentId> <sessionId> not resumed, so cleared: <error>`, and `sessionOf` resolves null. A failed write rejects
  `sessionOf` with no log. The next ask launches a fresh session.
- **`/clear`.** The plugin hears chat's `sessionOpened`, `sessionClosed` and `sessionCleared` once, for every
  registration. A clear moves the row to a new host id; the registration whose `entries()` holds the row writes the
  new host id in the scope's turn, and only while the scope's record still holds the row, so a later resume brings back the cleared conversation.
- **`scopeOf(session)`** names the first scope in `entries()` whose record holds the session's row id or host id, and
  null for any other session.

## The pane

- A plugin's page part calls `addAgentPane(spec)` from `scoped-agents`' page exports and places the returned
  `element` in a slot of its own view. The pane is filed with the consumer's registrations, so it ends when the
  consumer stops.
- The pane shows a plain ask box until the scope's first message, then the session's chat view through chat's
  `mountChat`. The ask box shows the spec's `heading()` and `hint`.
- `AgentPaneSpec` holds `owner` and `agentId` (the pane's channel calls name them), `heading()`, `hint`, and the
  host's hooks:
  - `setShown(shown)`: the host shows or hides the slot holding the pane
  - `resizeTarget`: the slot's divider, for the resize keys
  - `tookKeys()`: the pane took the keys, so the host's focus is the pane
  - `leave()`: `Esc` in the ask box or `Alt+h` from the pane; the host takes the keys back
- The host drives the pane through `AgentPane`:
  - `toggle()` shows the pane and gives it the keys, or hides it. With no scope open it shows nothing and logs
    `<agentId> has no scope`; the host's own copy for that case is the host's (Practice toasts
    `Open a problem first`).
  - `scopeOpened(scope | null)` names the open scope; the same scope keeps the mount and the ask box's text, another
    or null drops both. Practice passes the open problem's slug, and calls `scopeOpened(null)` then
    `scopeOpened(slug)` when the attempt changes, so a fresh attempt drops them too; Backlog passes `global` once.
  - `refresh()` reads `sessionOf` again after an ask the host made itself (Backlog's sweep): while the pane shows, an
    answered session replaces the ask box, or a mount of another session. A hidden pane reads nothing.
  - `redraw()` draws the ask box again; the page part redraws every pane on a layout set, so a host calls it only
    when its heading changes
  - `hostTookKeys()` hears the keys leave the pane; `modeHidden()` gives them back as the mode hides
  - `outerPanes` moves `Alt+h` from the pane to the host, and `Alt+l` into the shown pane from wherever the host has
    the keys. A host that must refuse `Alt+l` from one of its own panes wraps it (Practice takes it only from its
    problem column, not its list).
- The ask box's `Enter` and `Esc` act on the pane that holds the keys.
- The page reaches main over the plugin's channel: `ask(owner, agentId, scope, text)` and
  `sessionOf(owner, agentId, scope)`.
- The pane logs under `[scoped-agents]`, each line naming the agent id: `<agentId> pane shown`, `<agentId> pane
  hidden`, `<agentId> focused`, `<agentId> left`, `<agentId> ask box shown for <scope>`, `<agentId> mounted <scope>`,
  `<agentId> not mounted <scope>: <error>`, `<agentId> not read <scope>: <error>`, `<agentId> ask ignored: empty`,
  `<agentId> ask ignored: sending`, `<agentId> ask failed: <error>`.
- A rejected ask toasts `Could not start the <agentId>: <error>`; a failed read or mount toasts its error. Each is an
  error toast.

## The tool check

- A registration's MCP tools are its owner's, contributed through sessions' `contributeTools`. The tool list is
  global, so every session lists them.
- Each such tool checks the calling session at call time with `scopeOf(session)`: a null scope gets an error result.
  Practice's `read_practice_state` and Backlog's `read_backlog_state` and `set_backlog_chunks` check this way.

## The layout and keys

- The plugin has a layout (`scoped-agents.layout`, contract `src/plugins/scoped-agents/layouts/layout.d.ts`,
  built-in `default`) holding one part, `askBox`: the heading, the hint and the text box. Main registers the
  contract; the page part shows it. The part moves from Practice's layout.
- The ask box's scope is `scoped-agents.ask`, a base scope the pane sets through `setScope`, never pushed.
- Keys (`src/plugins/keymap.ts`):

  | Key | Scope | Action |
  |---|---|---|
  | `Enter` | `scoped-agents.ask`, in the box, normal and insert mode | send the first message (`scoped-agents.askSend`) |
  | `Esc` | `scoped-agents.ask`, in the box | leave the box (`scoped-agents.leaveBox`) |
  | `Ctrl+n` | `scoped-agents.ask` | the new-session prompt, as in every main view |
  | `Cmd+'` / `Cmd+Enter` | `scoped-agents.ask` | Practice's Run and Submit, so Practice's ask box keeps them; they do nothing while Practice is hidden |

- The host's own show key (`Space v i` in Practice, `Space v b` in Backlog) stays in the host's manifest.
- The mounted chat view holds chat's own keys.

## The self-test

- The plugin has no mode, so it has no self-test script of its own. Each host's script drives its pane over the fake
  harness. Practice's `interviewer` group drives the ask box, the launch and mount, `Alt+h` out and `Alt+l` back,
  another scope's ask box, and the resume of an earlier scope. Backlog's `assistant` group opens the pane with the
  keys and gives them back, and sends no ask, since each ask launches a session.

## Seams

- `src/plugins/scoped-agents/contract.ts` holds every shared name: `ScopedAgentRecord`, `ScopedAgentStore`,
  `ScopedAgentSpec`, `ScopedAgent`, `ScopedAgentsMainExports`, `AgentPaneSpec`, `AgentPane`,
  `ScopedAgentsPageExports`, and the channel's `ask` and `sessionOf`.
- `main/scoped-agent-service.ts`: the registrations, the lifetime rules and chat's three session events.
- `page/agent-pane.ts`: the pane; `page/start.ts`: the page part, its exports, the keys' commands and the layout.
- The manifest depends on `sessions` and `chat` in main and `chat` in the page. A registering plugin adds
  `scoped-agents` to its own `dependsOn` and imports nothing but the contract.
