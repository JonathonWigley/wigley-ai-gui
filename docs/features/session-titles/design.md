# Session titles and row status

**Contents**

- **Status** — what is built.
- **Titles** — the three sources, which one shows, the limit, where titles live.
- **The agent's tool** — `set_session_title` and the instruction that prompts it.
- **Renaming by hand** — the dialog and its key.
- **Row status** — the activity registration, the states, when done and error clear.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

Every row in the Sessions side bar shows a descriptive title, set by the agent or the user, and,
beside it, what the session is doing, so the user tells chats apart and sees which one needs them
without opening each.

## Status

Built, in `src/plugins/sessions/` (titles, the tool, the dialog, row activities), `src/plugins/chat/` (saved
titles, the instruction, chat's activities), `src/plugins/forms/` and `src/plugins/primer/` (the needs you
activity), `src/shared/page/session-form-popups.ts` and `src/plugins/keymap.ts`.

## Titles

A session holds up to three titles, one per source (`TitleSource`, `src/plugins/sessions/contract.ts`):

| Source | Set by | When |
|---|---|---|
| `user` | the rename dialog (`<Leader>br`) | the user submits a name; an empty submit clears it |
| `agent` | the `set_session_title` MCP tool | the agent calls it |
| `firstMessage` | chat main; sessions main for a connected session | the first message with text sent in a row that has none yet (leading whitespace dropped, then kept to 200 code points), or the resumed session's title on resume; a connected session's name in its harness (`AgentHarness.sessionName`), read each time a form opens or its row is activated |

The row shows `user`, else `agent`, else `firstMessage` cut to the limit with `…`, else no title.
A user title therefore locks out the agent's renames until the user clears it, and the agent's
later titles are still kept underneath. A row with a title shows it as the main text in place of
its folder label (`gamma 2`); the tooltip carries both. A row with no title reads `New Chat`, its folder label in the tooltip.

The limit is the `sessions.titleMaxLength` setting (default 30), counted in code points after
whitespace runs collapse to one space. A `user` or `agent` title past it is refused, never cut; a
`firstMessage` title is cut, since nobody chose its words.

Sessions main holds every session's titles while the session lasts, on its row (`SessionRow.titles`),
moving with the row across a clear. Chat main saves an owned row's titles with the row's other facts
in `open-sessions.json`, so they come back on relaunch and go when the user closes the row. A
connected (terminal) session's titles last only while it is connected.

## The agent's tool

Sessions contributes `set_session_title` (`{ title: string }`) to every session. It refuses an
empty or over-long title with an error naming the limit, so the agent shortens it itself. Over a
user title it saves the agent title and says the user's title shows.

Claude Code defers MCP tools: an agent sees only the tool's name until it loads it with ToolSearch, so
the tool's description alone does not prompt a rename. Chat registers one instruction
(`addInstructions`) that every process start it makes passes with `--append-system-prompt`: set the
title as the first thing in the first turn, before any other work, and again only when the work's focus clearly changes. Both the
instruction and the tool's description ask for a 2 to 4 word heading naming the topic ("Agent Status Line"),
not a sentence describing the request, so a title fits the row without a cut. Chat passes
the instruction on every process start, a resume included (`claude-launch.ts`). `agent-chat/design.md`
§ Saved sessions holds that the Claude CLI keeps the system prompt of a conversation's first request on
resume, so a conversation first started before this feature may never receive the instruction. Such a
conversation's row then shows one of two titles until its agent calls the tool on its own:

- **Resumed from the past-sessions list**: the first-message title, which resume sets from the request's
  title.
- **Restored from an `open-sessions.json` written before this feature**: `New Chat`. The row loads
  with no titles and as already sent, so no message gives it a first-message title.

Terminal sessions get no instruction. Their rows show the name Claude Code shows for the session,
its `/rename` title else its AI title, read from the transcript under the config folder the relay's
hello names, unless their agent calls the tool on its own. A session with neither reads `New Chat`.

## Renaming by hand

`<Leader>br` (`sessions.renameSession`, the leader `b` group, "session") opens a one-line dialog over
the focused pane's session, prefilled with the title the row would show uncut (`user`, else `agent`, else
`firstMessage` in full). Enter submits it as the `user`
title and Esc cancels; an empty submit clears the `user` title. A title past the limit keeps the
dialog open with the problem shown.

## Row status

A row's **activity** is the short state drawn at its trailing end, on the title's line: a label
holding its word, capitalized. A state the user should act on takes a Tag; any other is plain text.
The word also appears in the row's tooltip, after the folder label and before the status. Any
page plugin sets one per session under its own source id through the `sessions` page
export `setActivity(sessionId, sourceId, activity | null)`; the row shows the highest `rank` of the
session's activities, the last set winning a tie, and nothing when it has none. A new state is a
new registration in the plugin that knows it, with no edit to sessions.

| Activity | Set by | Rank | Label | Shows while |
|---|---|---|---|---|
| needs you | chat (a permission prompt waits); forms and primer (a form is open) | 40 | `attention` Tag | the wait lasts |
| error | chat | 30 | `error` Tag | the process stopped while a turn ran or with an error, until the user views the session or sends a message |
| working | chat | 20 | `status-running` text, pulsing | a turn runs |
| needs you | workflow (a run paused short of its end) | 18 | `attention` Tag | nothing runs, until a turn or a subagent starts |
| ready to make, closed | workflow (Large's plan ready and closed) | 15 | tinted Tag | the flow is at that stage and not busy |
| done | chat | 10 | `fg-tertiary` text | the turn ended while the session was not the focused pane's, until the user views it or sends a message |

Idle draws nothing. "Views the session" is the session becoming the focused pane's session. Clearing the
session's conversation, sending a message and the next turn starting also clear a done or error. A turn
that ends while its session is the focused pane's skips done. An unselected `marked` row with no activity
draws the needs you label; while a row shows an activity, the default layout draws that activity's label alone. A
selected row draws as unmarked at once: the page clears a done on selecting before main's reply clears the mark.
Other tabs' and popups' status lines (a form's or primer's name and count) still draw on the row's
second line; chat no longer sends one.

Activities live in the page and start blank on a page load.

## Decisions

- **Agent-set titles over Claude's auto title.** Claude Code writes an `ai-title` only in
  interactive sessions: in a sample of 150 transcripts, 67 of 82 terminal (`cli`) sessions held
  one and 0 of 68 app-launched (`sdk-cli`) sessions did. The app's own sessions never get one, so
  only terminal sessions read it, the name reaching their rows at the `firstMessage` source's rank
  and cut to the limit, since neither the user nor the app chose it for the row.
- **Refuse, don't cut, a chosen title.** The agent picks shorter words, rather than losing the end
  of its title to an ellipsis.
- **Status from the app, not the agent.** Every state is something the app already observes, so
  none goes stale when an agent forgets to report it.
- **Activities as registrations.** A closed list of states in sessions would need an edit for each
  plugin's new state.
- **Chat saves titles with its rows.** `open-sessions.json` already follows the owned row's life
  across relaunch and close; a second file in sessions would need its own pruning.

## Out of scope

- Dock badge or notifications for done or needs you.
- An agent-reported free-text activity ("running tests").
- Instructions for terminal sessions in `~/wigley-agents/AGENTS.md`.
