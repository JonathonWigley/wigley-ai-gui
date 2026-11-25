# Work inbox

**Contents**

- **Intent** — why Slack and Jira come into the app, and what the user never has to do by hand.
- **Plugins** — the data plugin and the two view plugins over it.
- **Flow** — from a timer or `W` to cards on screen, and from a press to a write in Slack or Jira.
- **The worker** — one unattended session per job, its queue, its tools and its permissions.
- **Inbox** — its sections, cards and how an item clears.
- **Board** — columns, Jira tickets, local tasks and moves.
- **Detail pane** — a ticket's or thread's detail beside the cards, with a comment or reply box.
- **Work detection** — the signals, where each comes from, and the suggested moves.
- **Spin-up** — starting a session from a card.
- **Settings** — every `work.*` setting with its default.
- **Keys** — the binds the three plugins add.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

The user's work arrives in Slack threads and Jira tickets, and ends in commits, pull requests and Auri sessions. The
work plugins bring the two sources into the app, sorted by what needs the user and marked once seen, and watch
the user's own git, PR and session activity so the Board suggests the moves Jira is waiting on. The data stays local, in
the `work` plugin's data folder, and works for any Slack workspace and Jira site. Nothing reaches Slack or Jira on its
own: every post, transition or comment runs only when the user presses for it.

The spike's record of the settled result is [`spike.md`](spike.md).

## Plugins

| Plugin | Role |
|---|---|
| `work` | Data: the store, the job queue, the worker sessions, the worker's tools, work detection, spin-up, every card action as a command, and every `work.*` setting. Publishes the `work.state` slot (items, cards, suggestions, job, `lastSweepAt`, `sweepFailedAt`) and the keyed `work.details` slot (each ticket's and thread's stored detail, read only by the panes). |
| `work-inbox` | View: Inbox mode (`<Leader>ki`), drawn through its layouts from `work.state`. |
| `work-board` | View: Board mode (`<Leader>kj`), drawn through its layouts from `work.state`. |

Each view can be switched off alone; the data plugin keeps sweeping for the other. The views hold no state of their own
beyond focus, selection and their place slots (`work-inbox.place`, `work-board.place`), and every press is a `work` command, so a hook or a key reaches each action.

## Flow

```
timer (work.intervalMinutes) ─┐
app start (one sweep)        ─┼──► job queue (pure reducer, plugin data) ──► one job at a time
W in Inbox or Board          ─┘                │
card press (Send, Move,       ────────────────┘
  Accept, nudge Send)
                                               ▼
        chat.launch({ projectDir: <home>, profile: work.profile, unattended: true,
                      permissions: 'auto', owner: 'work', message: <job text> })
                                               │
              worker reads Slack and Jira through the user's connectors,
              writes results back through work's own tools only
                                               │
                                               ▼
        work store ──► work.state slot ──► work-inbox and work-board views
                                               │
        job's row idle, nothing running ──► chat.close(row, 'finished') ──► next job

git (services.git) ─┐
PRs (services.pullRequests, gh) ─┼──► detection (pure) ──► suggested moves on Board cards
Auri sessions (chat.session, sessions.rows) ─┘
```

## The worker

- **One session per job.** A sweep, and each Send, Move, Accept or nudge, is a job. The queue launches one at a time, a
  fresh owned session each, and ends it on an idle settle (its row idle with no background work for 5 s, as
  auto-retro does), on its row's process ending, on the timeout, or on a close matched by the row's id or its host id,
  and follows its row to each new host, so `/clear` on the worker row does not end it. Only the installed app's live run
  launches workers: a drive run or the dev app queues jobs, logs each one not launched and shows "Not launched: this run
  launches no worker." on its queued status. A fresh session keeps every job's context bounded; the conversation never grows across sweeps.
- **Queue.** A pure reducer over the queued jobs and the running one, saved in plugin data so a restart keeps queued
  presses. A sweep already queued is not queued twice, and a press for a target already queued replaces the queued one.
  After a restart a running job that never launched goes back to the head of the queue (an unlaunched sweep is dropped
  when a sweep is already queued), and a launched one is kept for its row's return, which claims the row by its row id or its host id. A launched row has 30 s to report
  its host id, else the row is closed and the job fails. A job that runs past 20 minutes is closed and fails. The
  launched rows are recorded in `job-rows.json` (`work/main/job-rows.ts`).
- **Unattended and permissive.** Each job launches `unattended` (a prompt is denied at once, never left waiting) and with
  chat's role-based `permissions: 'auto'`, which each harness maps to its most permissive launch mode, so connector
  calls need no allow rule. The worker's instructions are the only guard on what it writes: a sweep reads only, and a
  press job does exactly the one write it was sent.
- **Write-back.** The worker records what it found only through `work`'s own MCP tools, which answer only the running
  job's session. The page never reads a transcript.
- **Harness-neutral text.** The instructions name capabilities ("your Slack tools", "your Jira tools"), never one
  harness's tool names.
- **Status.** The status line in both views (the Board's layout also has an optional `problem` part, drawn in the status
  slot under it while `work.json` was not read at start) shows only when the work was last updated: `Updated 7m ago`
  from the last good sweep (`lastSweepAt` in `work.state`), `Updating…` while a sweep runs, `Update queued` while one
  waits behind another job, `Update failed <age> ago` while the last sweep failed (`sweepFailedAt`, kept until a sweep
  ends well, so a later send or move does not hide it), or `Not updated yet`. `gs` opens the last finished job's transcript: a `log` hint in
  the Inbox, a Show transcript Button on the Board. A running job's row is hidden and owned, so it has no link until it
  ends.
- **When.** Only while the app runs: one sweep at start, then a one-shot timer re-armed after each sweep. Interval 0
  turns the timer off; `W` still sweeps.

## Inbox

Sections, in order: **Needs you** (DMs, @mentions, direct asks), **You promised** (commitments the user made in Slack),
**Waiting on others** (the user's questions and owed replies gone quiet past `work.stallHours`), **My threads** (threads
the user posted in with new replies), **Around Slack** (watched-channel posts tied to the user's tickets or keywords,
each with a why), **Worth knowing** (important posts in broadcast channels, each with a why), and **All**, the
seventh nav row. The first four are **Threads**: conversations the user is part of, which take a reply. Around Slack and
Worth knowing are the **Digest**: the worker's summaries of channel posts the user should know about, which take no
reply. The side bar lists the sections under Threads and Digest headings, then All, each with its unseen open count
(All counts every item); the shown section fills the sheet, newest first. All and a ticket filter list the threads
first, then the digest, each under its heading.

A row shows an unseen dot, its meta line (with a `digest` Tag on a digest item), the title, one line (the latest
message on a thread, the why on a digest item), key prompts and a failed Send's note; the people, ticket chips, summary,
thread, reply box and Buttons sit in the detail pane ([Detail pane](#detail-pane)). The unseen Needs you count drives
the Dock badge and the activity bar count. Waiting on others items carry Snooze 1 day. Send is offered on every open
thread, in the pane; a digest item has none. Every open item has Dismiss, Start session and Add to Board. A ticket
chip opens the Board on that ticket.

- **Seen.** An item is seen once the list cursor rests on it for 1.5 s while Inbox is on screen with real work (not
  the demo sample): the page runs `work.markSeen`, which stamps the item's `seenAt` in `work.json`. A message newer than
  `seenAt` makes the item unseen again. Unseen rows carry the dot and a semibold title.
- **The reply** is the user's own text: the worker writes no draft. Edits are kept per item in `work-inbox.place` while
  the item is in `work.state`, so a reload keeps them. Send posts the reply and drops the edit; an empty reply toasts
  and sends nothing. A row being sent shows its reply read-only and takes no other press.
- **The ticket filter** (the Board's `N thread` chip, `t` on a Board card, or a ticket chip) lists the open items
  holding one ticket key across every section, shown as a chip reading `<key> ✕`. `Esc` in the list or a click on the
  chip clears it and returns to the section shown before.
- **First show.** With no saved place the Inbox opens on Needs you with the cursor on its first card. Its place (section,
  filter, cursor, drafts and whether the pane is open) is `work-inbox.place`, kept across reloads.

An item clears on Send, when a sweep sees the user replied or reacted in Slack, or on Dismiss; a snoozed item returns
when its snooze ends. Cleared and dismissed items stay under All for 90 days after their last activity, where Restore
brings one back; a sweep's recording removes the older ones.

## Board

Columns from `work.columns`, each a name and the Jira statuses it stands for, plus Other for any unmapped status, shown
only while it holds a card and never a drop target. A
card is either a Jira ticket from `work.jiraQuery` or a **local task**: a card with no Jira ticket, made by Add to
Board or from a promise with no ticket, kept in plugin data, starting in Todo and gone only when the user deletes it.

A card moves by ◀/▶ or drag. A Jira card shows "Moving to X in Jira…" while its Move job runs; the worker takes the
first status in the target column's list the ticket can reach, and the card shows a note when none is reachable. A
local task moves at once. A card's "N thread" chip opens the Inbox filtered to that ticket, and its Session button
starts a session ([Spin-up](#spin-up)). A local task's Delete removes it at once, with no confirm. An empty board
shows one line with the sweep hint in place of the columns. A card shown by another view (a ticket chip in the Inbox)
flashes; a key `showTicket` finds no card for toasts and leaves the mode alone.

A Jira card's ◀/▶ and a drop mark it moving and queue a Move job; a card in Other has neither. When the cursor card
leaves its column, the cursor keeps the same row, else the column's last card, else the nearest column with cards.

## Detail pane

The Board and the Inbox each split their sheet: the cards on the left, a **detail pane** on the right that shows the
cursor card's detail and follows the cursor. `Enter` opens and closes the pane; `gx` opens the Jira ticket or Slack
thread instead. Focus stays on the cards, so `j`/`k` read card after card. Whether the pane is open is kept in each
view's place slot; its width is the split's own UI state, dragged like every split. The Board keeps the cursor card in
view when its column area narrows (the pane opens, the divider moves, the window narrows). The pane heads with when
the sweep last fetched that record (`Fetched 5m ago`, or `Fetched just now` under a minute), so a stale copy reads as
stale. A Board card with no stored detail yet shows `No detail yet: the next sweep fetches it.`, and an Inbox item
shows `No thread detail yet: the next sweep fetches it.` The pane keeps its scroll position across a redraw of the
same card, and the minute age refresh waits while the box is focused or text in the pane is selected.

- **A Jira ticket's pane**: key, title, type, priority, status, assignee, reporter, last updated, the description, the
  `work.detailComments` most recent comments, subtasks and linked issues, then each open Inbox thread naming the
  ticket as its summary and latest line (`t` opens them in the Inbox). A comment box closes the pane: `i` enters it,
  `Cmd+Enter` queues a **Comment job** (`work.comment`, `WorkJob` kind `comment`) that posts exactly one comment
  through the user's Jira connector, and the pane and the card show `Posting…` while it runs. A second comment queues
  behind the first; it never replaces it. A comment equal to one still posting is refused (`Already posting that
  comment`). The open ticket pane lists its Inbox threads before its detail is fetched.
- **A thread's pane** (the Inbox, and a local task on the Board): channel, participants, ticket chips, the worker's
  why on a digest item, the summary, the root message and the `work.threadReplies` most recent replies (author, time,
  text), then an empty reply box on every open thread (none on a digest item); a local task whose thread is not open in
  the Inbox shows a line saying it takes no reply from the Board. The Inbox draws the thread as a chat: other people
  on the left beside an icon of their initials in a colour their name picks, the user on the right (the worker marks
  each message the user wrote, `byUser`), and a run of one person's messages under one icon and name line. A typed
  reply stays in its box until the send clears the item, so a refused or failed send keeps it. `Cmd+Enter` sends through the Send job, as before. A
  Board task whose Slack thread left the Inbox reads `Its Slack thread is no longer in the Inbox.`
- **Inbox rows stay one line each** whether or not the pane is open: meta line, title and one line. The summary,
  reply box, people, ticket chips, thread and Buttons draw in the pane, not on the row.
- **Where detail comes from.** Each sweep stores a detail record per ticket and per thread in its own section of
  `work.json`, published as the keyed `work.details` slot that only the panes read. `read_work_state` hands the worker
  each stored record's updated stamp, and the worker refetches only tickets and threads that moved since. Description,
  comments and messages are stored as markdown and drawn with the app's markdown renderer.

## Work detection

Each sweep also reads three sources, matched to cards by ticket key (and, for a local task, by the session started
from it):

| Signal | Source | Default column |
|---|---|---|
| Branch with the key | `services.git` `branches()` over every watched repo | In Progress |
| Commit with the key | `services.git` `commitsMatching()` since the card's last move | In Progress |
| PR opened | `services.pullRequests` (the `gh` CLI) | In QA |
| PR merged, none open | `services.pullRequests` | Done |
| Session linked | started from the card, or the key in its branch or first message | In Progress |

`work.signals.<signal>` maps each signal to a column or off. A signal whose column sits after the card's suggests a move: the
card shows it with its reason, Accept (a Move job) and Not yet (hides it until a newer signal). A move Jira's own
automation already made shows as done rather than suggested.

Watched repos are chat's projects with their pool clones, plus `work.repoFolders`.

## Spin-up

Start session (Inbox) and Session (Board) launch a visible session with `chat.launch`, as notes does, its message
carrying the key, title, link and linked threads' summaries (up to five). `work.projects` pairs a Jira project key with
an Auri project chat lists; a key with no entry, a project chat does not list, and a thread with no ticket, open chat's
new-session prompt with the message in its box, through chat's `newSessionWithDraft`. The session is linked to the
card, so its branch and work count as signals.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `work.profile` | `''` | The profile worker jobs run on; empty for chat's default |
| `work.intervalMinutes` | 10 | Minutes between sweeps while the app runs; 0 for never |
| `work.lookbackHours` | 48 | How far back the first sweep reads Slack |
| `work.channels` | `[]` | Watched channels (no `#`) for Around Slack |
| `work.broadcastChannels` | `general`, `announcements` | Channels whose important posts go to Worth knowing |
| `work.keywords` | `[]` | Words that make a post relevant |
| `work.stallHours` | 24 | Hours of quiet before a thread counts as Waiting on others |
| `work.jiraQuery` | `assignee = currentUser() AND (statusCategory != Done OR resolved >= -14d) ORDER BY updated DESC` | The JQL for the Board's tickets |
| `work.columns` | Backlog: Backlog · Todo: To Do, Selected for Development, Open · In Progress: In Progress · In QA: In QA, QA, In Review, Ready for QA · Done: Done, Closed, Resolved | Columns in order, each `{ "name", "jiraStatuses" }` |
| `work.signals.branch`, `.commit`, `.pr_opened`, `.pr_merged`, `.session` | In Progress · In Progress · In QA · Done · In Progress | Each signal's column, or `off` |
| `work.repoFolders` | `[]` | Folders watched beyond chat's projects and pool clones |
| `work.projects` | `[]` | Spin-up targets, each `{ "jiraProject", "project" }`: a Jira project key and the Auri project its sessions start in |
| `work.detailComments` | 10 | Most recent Jira comments a ticket's detail keeps |
| `work.threadReplies` | 5 | Most recent replies a thread's detail keeps under its root message |

## Keys

- `<Leader>ki` Inbox, `<Leader>kj` Board, in the `k` go-to group.
- `W` sweeps now in both views (in the Inbox's sections and list, not in a reply box, where it types), matching
  Backlog's sweep. `gs` shows the last job's transcript row.
- Ctrl+n opens the new-session prompt from both views, as in every main view.

**Inbox sections** (side bar): `j`/`k`, `gg`/`G` move the cursor, `Enter` shows the section and moves focus to the
list, `l` shows it keeping focus. Alt+h/l move focus between the sections and the list.

**Inbox list:** `j`/`k`, `gg`/`G` move the card cursor.

| Key | Does |
|---|---|
| `Enter` | Open or close the detail pane |
| `gx` | Open the thread in Slack |
| `Ctrl+j` / `Ctrl+k` | Scroll the detail pane a line (`Ctrl+Shift+j`/`k` half a page) |
| `i` | Write a reply in the pane's box (opens the pane) |
| `Cmd+Enter` | Send the reply |
| `d` | Dismiss |
| `z` | Snooze 1 day |
| `u` | Restore |
| `b` | Add to Board |
| `s` | Start a session |
| `t` | Show the card's ticket on the Board |
| `Esc` | Clear the ticket filter |

**Board:** `j`/`k` and `gg`/`G` move the cursor in a column, `h`/`l` between columns.

| Key | Does |
|---|---|
| `H` / `L` | Move the card to the previous or next column |
| `Enter` | Open or close the detail pane |
| `gx` | Open the ticket in Jira, or the task's thread in Slack |
| `i` | Enter the pane's comment or reply box (`Cmd+Enter` sends, `Esc` leaves) |
| `Ctrl+j` / `Ctrl+k` | Scroll the detail pane a line (`Ctrl+Shift+j`/`k` half a page) |
| `y` / `n` | Accept the suggested move, or Not yet |
| `t` | Show the ticket's threads in the Inbox |
| `s` | Start a session |
| `d` | Delete the local task |

## Decisions

- **Three plugins.** A view that can be switched off is its own plugin over a data plugin (`AGENTS.md`).
- **A fresh unattended job session over a long-lived assistant.** Bounded context, no stalled prompt, and the profile
  setting works; scoped-agents has neither unattended nor a profile choice.
- **Role-based permissive launch.** The user chose `permissions: 'auto'` over allow rules, so the worker never stops on a
  connector the profile does not allow; instructions guard writes.
- **Local tasks, not follow-ups.** "Add to Board" makes a local task; Auri's Backlog keeps meaning follow-ups.
- **PRs through `gh`, behind a contract.** Deterministic per sweep, independent of a site's Jira–GitHub link; `gh` runs only
  in its adapter.
- **Only while the app runs.** Scheduling has no exports for another plugin, and a closed app has no Board to show.
- **No catch-up mode** (rejected in the ideas round); key people, muted channels and a memory are later work.
- **Detail from the sweep, not on open.** A worker job is a whole agent session, so a fetch on open would keep the pane
  empty for a minute; the sweep stores detail and skips what has not moved.
- **Detail in its own slot.** The heavy text stays out of `work.state`, which every view redraws from.
