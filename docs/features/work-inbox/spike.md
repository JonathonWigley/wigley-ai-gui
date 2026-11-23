# Work inbox — spike

Product reference only: the code on `spike/work-inbox` is throwaway. Rebuild the result this file
describes, not the code's structure. The branch never merges into `main`.

Branch: `spike/work-inbox` · Started: 2026-11-23

## Settled
- A built-in plugin that works for any Slack workspace and Jira site, with nothing tied to one
  project. Its data stays local, in the plugin's own data folder — first ask
- A background agent session gathers the data through Claude's Slack and Atlassian connectors. It
  runs on a timer and on a refresh key, on the Claude profile a setting names, and writes into
  the plugin through the plugin's own tools — first ask
- Two full-window modes: Inbox (`Space k i`) and Board (`Space k j`); `Space k r` sweeps now — first ask
- The Inbox has four sections:
  - Needs you: DMs, @mentions and direct asks
  - My threads: threads the user posted in that have new replies
  - Around Slack: posts in watched channels that relate to the user's tickets or keywords, each
    with a "why"
  - Worth knowing: important general posts in broadcast channels, with a summary and why they
    matter, even when they are not about the user's work
  — first ask
- Each card shows a summary, the participants, the latest reply, an Open in Slack link and ticket
  chips. Needs you cards also show an editable draft reply. Needs you cards have a warning-colour
  edge, and their count raises the Dock badge — first ask
- Nothing is sent or moved on its own: Send posts the user's edited draft through the worker, and
  a board move transitions the real ticket only when the user makes the move — first ask
- An item clears on Send, when the sweep sees that the user replied or reacted in Slack, or on
  Dismiss. Cleared and dismissed items stay findable under All, where they can be restored — first ask
- The Board shows the user's Jira tickets (from a JQL setting) in their own columns: Backlog,
  Todo, In Progress, In QA and Done. A setting maps each column to Jira statuses, and an Other
  column holds statuses that no column maps. A card moves by its ◀/▶ buttons or by drag; while
  Jira catches up it shows "Moving to X in Jira…" — first ask
- Slack and Jira link by ticket key and by the worker's matching (with a reason). A ticket chip on
  an Inbox card opens the Board on that ticket. A "N thread" chip on a Board card opens the Inbox
  filtered to that ticket — first ask

## Tuned values
| Value | Setting | Where |
|---|---|---|
| Worker profile | `''` (chat's default) | `work-inbox.profile` |
| Sweep interval | 10 minutes (0 = never) | `work-inbox.intervalMinutes` |
| First-sweep lookback | 48 hours | `work-inbox.lookbackHours` |
| Watched channels | none | `work-inbox.channels` |
| Broadcast channels | general, announcements | `work-inbox.broadcastChannels` |
| Keywords | none | `work-inbox.keywords` |
| Jira query | `assignee = currentUser() AND (statusCategory != Done OR resolved >= -14d) ORDER BY updated DESC` | `work-inbox.jiraQuery` |
| Columns → statuses | Backlog: Backlog · Todo: To Do, Selected for Development, Open · In Progress: In Progress · In QA: In QA, QA, In Review, Ready for QA · Done: Done, Closed, Resolved | `work-inbox.columns` |

## Next
- Work detection from git branches and commits, pull requests and Auri sessions, matched by
  ticket key, which suggests moves the user accepts. Defaults: branch created → In Progress, PR
  opened → In QA, PR merged with none open → Done. A setting maps each signal to a column. A move
  Jira's own automation already made shows as done rather than suggested
- Spin-up from a card: start a session now, or add the card to Backlog
- Things you promised: the worker finds commitments the user made in Slack ("I'll send that
  tomorrow") and offers each as a task, linked to its thread
- Waiting on others: an Inbox section for the user's unanswered questions and owed replies that
  have gone quiet, with a drafted nudge. How long counts as stalled is a setting

The user approved an HTML prototype of these four (2026-11-23):
- "You promised" and "Waiting on others" are their own Inbox sections
- A promise with no ticket goes on the Board as a local task; it creates no Jira ticket
- Every Inbox card has a spin-up row (Start session, Add to Backlog); every Board card has a
  Session button
- A suggested move sits on the Board card with its reason, and has Accept and Not yet
- Waiting on others cards carry an editable nudge or reply draft, Send, Snooze 1 day and Dismiss
- A Signals setting maps each signal to a column or off; the stall threshold is a setting
  (24 hours)

## Later
- Key people (always Needs you) and muted channels (never shown) as settings, with noise shown as
  counts per channel
- A memory of people, projects and shorthand the worker reads on each sweep and adds to only on
  the user's OK

## Tried and rejected
- Catch-up mode (a wider "since I was last here" sweep with a Decided without you section) —
  rejected in the ideas round, before it was built
