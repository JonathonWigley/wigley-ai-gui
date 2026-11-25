# Permission review: design

**Contents**

- **Intent** — what the review is for, and what it never does.
- **What the reviewer sees** — the subject, and everything kept out.
- **Where requests come from** — chat's permission entries and agent-commands' confirm rounds.
- **The one-shot ask** — the harness seam the review runs on, and Claude Code's isolated `claude -p`.
- **The reply** — the reviewer's JSON, its parsing, and the review record.
- **The card** — chat's permission entry, the verdict part, and the confirm round.
- **Lifecycle** — when a review starts, how long it lives, and what a failure shows.
- **Rejected** — approaches weighed and dropped, with the reason.

## Intent

Every approval the app asks of the user gets a second opinion, the way a colleague would glance at a command before
saying yes. A separate model reads the call by itself and gives a one-line summary of what it does and a verdict,
approve or deny, based on its security risk. The verdict is advice only. Allow once stays the default key, and
nothing is answered automatically. The review is the `permission-review` plugin, so it can be switched off. With it
off, the permission card still draws its target line and its folded full call, just without a verdict.

## What the reviewer sees

- The reviewer sees the **subject** and nothing else. The subject is the tool name, the tool's input, and the
  session's project folder (or none, when the app knows no project for the caller).
- It does not see the transcript, any reason the agent gave for the call, the agent's instructions or skills, any
  `CLAUDE.md` or `AGENTS.md`, or any tool. The agent being reviewed cannot argue its case, and a planted instruction
  in the project cannot reach the reviewer.
- The prompt is the subject as plain text: `Tool: <name>`, `Project folder: <path or "none">`, then the input as
  pretty-printed JSON in a fenced block. An input longer than 50,000 characters is cut there, and the prompt says it
  was cut. That keeps a large `Write` reasonably priced.
- The instructions (the reviewer's system prompt) live in `permission-review`. They name no harness. They ask for
  the reply below and nothing else.

## Where requests come from

- **Chat's permission entries.** The main part watches chat's `chat.entries` list slot. A `put` of a `permission`
  entry whose `answer` is null and whose id the plugin has not seen for that session starts a review. A `replace`
  (a history restore or a clear) starts none: the entries it carries are answered or cancelled. The session's
  project folder, harness and profile name come from chat's `chat.session` slot. The profile's config folder comes
  from that harness's profiles in the registry.
- **agent-commands' confirm rounds.** A risky command that `run_command` runs opens forms' `confirm` round.
  `ConfirmRequest` carries a `subject` (`{ toolName, input }`, or null): agent-commands fills it with
  `toolName: app command <id>` and the command's argument, or `{ session, arg }` with the target session's side-bar
  name when the run names one, since the target is what makes a close or a send risky. While the round is open,
  forms publishes it in its `forms.confirms` keyed slot, keyed by round id, holding `{ sessionId, subject }`, and
  deletes it once the confirm settles, however it ends (submitted, cancelled, aborted or failed). Forms clears any
  key an earlier start left behind when it starts. The plugin reviews each new key. Its profile is the caller's chat
  session's, or chat's default profile for a caller chat does not own (a terminal session). `confirmSample`, the
  demo's round, publishes nothing.

## The one-shot ask

- `AgentHarness.ask(request: AgentAsk): Promise<string>` runs one prompt with its own instructions on a profile.
  It has no tools and no session, and it saves nothing. It resolves with the model's reply text, and rejects with a
  reason the user can read. `AgentAsk` is `{ profileDir, instructions, prompt, signal }`. An abort kills the run and
  rejects. The method is generic: the permission review is its first caller, and any later one-shot (a title, a
  summary) uses the same call.
- Model names stay inside the adapter. Claude Code reads its `claude-code.askModel` setting, default `sonnet`.
- Claude Code runs `claude -p` with the prompt on stdin and these flags:
  - `--system-prompt <instructions>` replaces Claude Code's own system prompt.
  - `--tools ""` turns off every built-in tool.
  - `--strict-mcp-config`, with no `--mcp-config`, loads no MCP server.
  - `--setting-sources ""` loads no user, project or local settings, and so no hooks, plugins or `CLAUDE.md`.
  - `--disable-slash-commands` loads no skills or commands.
  - `--no-session-persistence` saves no session.
  - `--output-format json` gives one result object.
  - `--model <askModel>`.
- The ask runs with the profile's `CLAUDE_CONFIG_DIR`, as every one-shot does, so it signs in with the session's own
  account. It runs in an empty folder of its own, `claude-code-ask` inside the first OS temp folder, made before
  each ask and reused, so no project file is near it. With no temp folder (the self-test), the ask rejects.
- **Checked at plan time, 2026-11-25:** with these flags and the personal profile, the model said no text mentioned
  the profile's `CLAUDE.md` content. Without `--setting-sources ""` it said yes. Subscription sign-in worked without
  user settings. One review cost about $0.006 on `sonnet`.
- The fake harness answers `ask` with a scripted reply, `setAskReply(text)`, and fails the next one with
  `failNextAsk(message)`, so the self-test and the demo never spawn a model.

## The reply

- The reviewer replies with one JSON object: `{"summary": "...", "verdict": "approve" | "deny", "risk": "low" |
  "medium" | "high"}`. The summary is one or two plain sentences on what the call does.
- The parser takes the first `{` to the last `}` of the reply, so a fenced block parses too. Any other shape is a
  failure that reads `the reviewer's reply was not the expected JSON`.
- The plugin publishes each review in its `permission-review.reviews` keyed slot. A chat review is keyed
  `<sessionId>/<entryId>`. A confirm review is keyed `confirm/<roundId>`. A review is one of:
  - `{ state: 'reviewing' }`
  - `{ state: 'done', summary, verdict, risk }`
  - `{ state: 'unavailable', reason }`
- The main process keeps the slot, so a page reload redraws every verdict. The app's restart does not keep it.

## The card

- **Chat's permission entry** carries `summary`: the tool's target line, the same text a tool entry shows (a Bash
  command's first line, an edited file's path; for a tool with no named field, the input's first string field). The
  harness writes it, so no other plugin reads a tool's input shape. The default layout draws, top to bottom:
  1. The contributed entry parts.
  2. The head: the tool name, then the target line in the mono font.
  3. A **Full call** expander, closed, holding the input as JSON that wraps rather than scrolling sideways.
  4. Allow once and Deny, with their keys as before.
- Chat's page export `addEntryPart(part)` lets another plugin draw inside an entry kind, the way forms'
  `addCardPart` does on round cards. A part has an `id`, the `kinds` it draws in, and
  `build(parent, { sessionId, input })`, which returns an optional `update(input)`. A layout places parts with
  `kit.entryParts(parent)`. A user layout that leaves out the call shows none.
- **The verdict part** draws through permission-review's own layout part, `verdict(parent, input, kit)`, under the
  `permission-review.layout` setting. It shows:
  - `Reviewing…` while the review runs.
  - The heading `Approve · low risk` or `Deny · high risk`, then the summary, once it is done.
  - `Review unavailable`, then the reason, on a failure.

  The verdict's colour follows the risk: low is success, medium is warning, high is error. An answered entry
  redraws, and the part reads the same review, so the verdict line stays.
- **The confirm round** gets the same verdict through forms' `addCardPart` on the question card of a round in
  `forms.confirms`. It draws at the card's end, where forms places parts.

## Lifecycle

- Each request is reviewed once, when it arrives. Reviews run at once, with no queue. Each has a 60-second limit,
  after which the plugin itself writes the unavailable review with the reason `the review took longer than 60 s`,
  then aborts the ask; whatever the ask settles with later is dropped.
- A chat review is deleted when its session ends (`sessions.ended`), or when a `replace` of the session's entries (a
  `/clear`) no longer holds its entry; a replace drops only the reviews whose entry went. A confirm review is
  deleted when its round leaves `forms.confirms`. A review that is still running when its key goes is aborted, and a
  deleted review's verdict leaves the card. An answer does not stop a running review: the verdict lands on the
  answered card.
- When the plugin starts again, it drops held reviews that were still running or whose session or round went while
  it was off, and reviews the requests still waiting.
- The plugin logs each outcome, so the self-test can wait on it:
  - `[permission-review] reviewed <tool> in <session>: <verdict> · <risk>`
  - `[permission-review] review unavailable for <tool> in <session>: <reason>`
- An unattended session's prompts are denied by chat before any card draws, so they get no review.

## Rejected

- **Replacing the whole permission entry through `addEntryRenderer`.** The review plugin would redraw chat's
  actions and keys itself, and a user layout naming `permission` would hide the verdict. A part keeps chat's card
  and adds one piece.
- **A `reviewModel` setting on `claude-code`.** That names one caller in the adapter. `askModel` covers every
  one-shot ask.
- **`--bare`.** It skips `CLAUDE.md` but allows only API-key auth, so the app's signed-in profiles would fail.
- **Running the ask in the project folder.** A project's `CLAUDE.md` or settings could steer the reviewer.
- **Answering automatically on a verdict.** The user asked for advice, and a wrong deny would stall a run unseen.
