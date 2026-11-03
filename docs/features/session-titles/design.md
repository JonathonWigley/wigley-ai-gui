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

Planned in `plan-titles-and-status/`.

## Titles

A session holds up to three titles, one per source (`TitleSource`, `src/plugins/sessions/contract.ts`):

| Source | Set by | When |
|---|---|---|
| `user` | the rename dialog (`<Leader>rr`) | the user submits a name; an empty submit clears it |
| `agent` | the `set_session_title` MCP tool | the agent calls it |
| `firstMessage` | chat main | the first message sent in a row that has none yet, or the resumed session's title on resume |

The row shows `user`, else `agent`, else `firstMessage` cut to the limit with `…`, else no title.
A user title therefore locks out the agent's renames until the user clears it, and the agent's
later titles are still kept underneath. A row with a title shows it as the main text and its folder
label (`gamma 2`) as dim detail after it; the tooltip carries both.

The limit is the `sessions.titleMaxLength` setting (default 40), counted in code points after
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

Claude Code defers MCP tools, so an agent sees only the tool's name until it loads it (seen at plan
time: a session's MCP tools arrive as names under "deferred tools" and need a ToolSearch before
use), so the tool's description alone does not prompt a rename. Chat adds one instruction to every session it starts
(chat's `addInstructions`): set the title at the end of the first turn, and again only when the
work's focus clearly changes. Terminal sessions get no instruction and keep their folder label
unless their agent calls the tool on its own.

## Renaming by hand

`<Leader>rr` (`sessions.renameSession`, the leader `r` group, "rename") opens a one-line dialog over
the focused pane's session, prefilled with the title the row shows. Enter submits it as the `user`
title and Esc cancels; an empty submit clears the `user` title. A title past the limit keeps the
dialog open with the problem shown.

## Row status

A row's **activity** is the short state drawn at its trailing end, on the title's line: a status dot
and a word. Any page plugin sets one per session under its own source id through the `sessions` page
export `setActivity(sessionId, sourceId, activity | null)`; the row shows the highest `rank` of the
session's activities, the last set winning a tie, and nothing when it has none. A new state is a
new registration in the plugin that knows it, with no edit to sessions.

| Activity | Set by | Rank | Dot tone | Shows while |
|---|---|---|---|---|
| needs you | chat (a permission prompt waits); forms and primer (a form is open) | 40 | `attention` | the wait lasts |
| error | chat | 30 | `error` | the process stopped while a turn ran or with an error, until the user views the session or sends a message |
| working | chat | 20 | `running`, pulsing | a turn runs |
| done | chat | 10 | `success` | the turn ended while the session was not the focused pane's, until the user views it or sends a message |

Idle draws nothing. "Views the session" is the session becoming the focused pane's session; a turn
that ends while its session is the focused pane's skips done. While a row shows an activity, the
default layout leaves out the row's separate attention dot (`marked`), which the needs you dot
covers. Other tabs' status lines (workflow's stage, a form's progress) still draw on the row's
second line; chat no longer sends one.

Activities live in the page and start blank on a page load.

## Decisions

- **Agent-set titles over Claude's auto title.** Claude Code writes an `ai-title` only in
  interactive sessions: in a sample of 150 transcripts, 67 of 82 terminal (`cli`) sessions held
  one and 0 of 68 app-launched (`sdk-cli`) sessions did. The app's own sessions never get one, and
  reading a terminal session's would need its Claude config folder, which the relay does not send.
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
