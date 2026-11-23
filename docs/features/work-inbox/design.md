# Work inbox

Planned in `plan-work-inbox`, not built yet: every plugin, command, setting and key below lands with that plan.

**Contents**

- **Intent** — why Slack and Jira come into the app, and what the user never has to do by hand.
- **Plugins** — the data plugin and the two view plugins over it.
- **Flow** — from a timer or `W` to cards on screen, and from a press to a write in Slack or Jira.
- **The worker** — one unattended session per job, its queue, its tools and its permissions.
- **Inbox** — its sections, cards and how an item clears.
- **Board** — columns, Jira tickets, local tasks and moves.
- **Work detection** — the signals, where each comes from, and the suggested moves.
- **Spin-up** — starting a session from a card.
- **Settings** — every `work.*` setting with its default.
- **Keys** — the binds the three plugins add.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

The user's work arrives in Slack threads and Jira tickets, and ends in commits, pull requests and Auri sessions. The
work plugins bring the two sources into the app, sorted by what needs the user, with drafts written ahead, and watch
the user's own git, PR and session activity so the Board suggests the moves Jira is waiting on. The data stays local, in
the `work` plugin's data folder, and works for any Slack workspace and Jira site. Nothing reaches Slack or Jira on its
own: every post, transition or comment runs only when the user presses for it.

The spike's record of the settled result is [`spike.md`](spike.md).

## Plugins

| Plugin | Role |
|---|---|
| `work` | Data: the store, the job queue, the worker sessions, the worker's tools, work detection, spin-up, every card action as a command, and every `work.*` setting. Publishes the `work.state` slot. |
| `work-inbox` | View: Inbox mode (`<Leader>ki`), drawn through its layouts from `work.state`. |
| `work-board` | View: Board mode (`<Leader>kj`), drawn through its layouts from `work.state`. |

Each view can be switched off alone; the data plugin keeps sweeping for the other. The views hold no state of their own
beyond focus and selection, and every press is a `work` command, so a hook or a key reaches each action.

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
  fresh owned session each, and closes it once its row is idle with no background work, after a short settle, as
  auto-retro does. A fresh session keeps every job's context bounded; the conversation never grows across sweeps.
- **Queue.** A pure reducer over the queued jobs and the running one, saved in plugin data so a restart keeps queued
  presses. A sweep already queued is not queued twice. A restart drops a running job whose row never returned and
  re-queues a press that never launched.
- **Unattended and permissive.** Each job launches `unattended` (a prompt is denied at once, never left waiting) and with
  chat's role-based `permissions: 'auto'`, which each harness maps to its most permissive launch mode, so connector
  calls need no allow rule. The worker's instructions are the only guard on what it writes: a sweep reads only, and a
  press job does exactly the one write it was sent.
- **Write-back.** The worker records what it found only through `work`'s own MCP tools, which answer only the running
  job's session. The page never reads a transcript.
- **Harness-neutral text.** The instructions name capabilities ("your Slack tools", "your Jira tools"), never one
  harness's tool names.
- **Status.** The status line in both views shows the running or last job, its time and outcome, and links to the last
  finished job's transcript. A running job's row is hidden and owned, so it has no link until it ends.
- **When.** Only while the app runs: one sweep at start, then a one-shot timer re-armed after each sweep. Interval 0
  turns the timer off; `W` still sweeps.

## Inbox

Sections, in order: **Needs you** (DMs, @mentions, direct asks), **You promised** (commitments the user made in Slack),
**Waiting on others** (the user's questions and owed replies gone quiet past `work.stallHours`), **My threads** (threads
the user posted in with new replies), **Around Slack** (watched-channel posts tied to the user's tickets or keywords,
each with a why), **Worth knowing** (important posts in broadcast channels, each with a why), and **All**.

A card shows its summary, participants, latest reply, Open in Slack, ticket chips and a spin-up row (Start session, Add
to Board). Needs you cards carry an editable draft and Send, have a warning-colour edge, and their count drives the Dock
badge. Waiting on others cards carry an editable nudge, Send, Snooze 1 day and Dismiss. A ticket chip opens the Board
on that ticket.

An item clears on Send, when a sweep sees the user replied or reacted in Slack, or on Dismiss; a snoozed item returns
when its snooze ends. Cleared and dismissed items stay under All for 90 days after their last activity, where Restore brings one back.

## Board

Columns from `work.columns`, each a name and the Jira statuses it stands for, plus Other for any unmapped status. A
card is either a Jira ticket from `work.jiraQuery` or a **local task**: a card with no Jira ticket, made by Add to
Board or from a promise with no ticket, kept in plugin data, starting in Todo and gone only when the user deletes it.

A card moves by ◀/▶ or drag. A Jira card shows "Moving to X in Jira…" while its Move job runs; the worker takes the
first status in the target column's list the ticket can reach, and the card shows a note when none is reachable. A
local task moves at once. A card's "N thread" chip opens the Inbox filtered to that ticket, and its Session button
starts a session ([Spin-up](#spin-up)).

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
carrying the key, title, link and linked threads' summaries. `work.projects` pairs a Jira project key with an Auri
project; a key with no entry, and a thread with no ticket, open chat's new-session prompt with the message ready. The
session is linked to the card, so its branch and work count as signals.

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

## Keys

- `<Leader>ki` Inbox, `<Leader>kj` Board, in the `k` go-to group.
- `W` sweeps now in both views, matching Backlog's sweep.
- Ctrl+n opens the new-session prompt from both views, as in every main view.

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
