# Usage — settled design

**Contents**

- **Intent** — what the user watches and why.
- **Vocabulary** — plan usage, plan row, session usage, autocompact limit, cache expiry, session spend.
- **Sources** — where each number comes from, measured on Claude Code 2.1.314.
- **Flow** — adapter to bus to the usage plugin to the screen.
- **Records** — the harness-neutral shapes that cross the seam.
- **The usage plugin** — the poller, the status-bar plan line, each session's line and the details bar.
- **The right bar** — the new shell area.
- **Decisions** — what the user settled, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-10-30 interview, kept so a later change does not reopen them. How the shell areas work
is in AGENTS.md § Architecture (The shell); how the line and the bar look is in `DESIGN.md`.

## Intent

The user runs long sessions on a plan with a 5-hour window, a weekly window and a Fable weekly window, with
autocompact set to fire well before the model's window. The user wants, always on screen: how much of each plan
window is used, and for each session on screen, in its own pane, how much context it holds against the autocompact
limit, how long its prompt cache stays warm, and what it has spent; and, one key away, every profile's windows with reset times and the
extra-usage credits.

## Vocabulary

- **Plan usage** — one profile's plan windows and extra-usage credits: an account fact, not a session's.
- **Plan row** — one plan window as the server reports it: a kind (`session`, `weekly_all`, `weekly_scoped`), a
  label, the percent used, the reset time and the server's severity. The app renders rows in the server's order and
  never grades one itself, so a meter the server adds shows with no app change.
- **Extra usage** — the plan's overage credits: on or off, spent and monthly limit in minor units of a currency.
- **Session usage** — one session's context tokens, its window, its autocompact limit, its cache expiry and its
  spend. It rides the agent event `usage` (`agent-tower/design.md` § Agent events).
- **Autocompact limit** — the token count the context bar measures against: the profile's configured limit when one
  is set, otherwise the limit Claude reports. The configured limit is `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` from the
  profile's `settings.json` `env`, as a percent of the context window (30 → 300,000 on a 1,000,000 window).
- **Cache expiry** — when the session's prompt cache goes cold: its last model reply plus the TTL that reply wrote
  (1 hour for `ephemeral_1h_input_tokens`, 5 minutes for `ephemeral_5m_input_tokens`; a reply that wrote both counts
  5 minutes, since part of its context goes cold then). A reply that only read the cache restarts the expiry with the
  TTL last written; a session that has written none has no expiry. After it, the next message re-reads the whole
  context at full price.
- **Session spend** — the session process's `total_cost_usd`, cumulative. On a subscription it is priced at API list
  rates (`modelUsage.<model>.costBasis: "list"`), not money billed.

## Sources

Only `src/main/claude-code/` knows any of these shapes.

| Number | Source | When |
| --- | --- | --- |
| Plan rows, extra usage | `claude -p /usage --output-format stream-json --verbose`: the `assistant` line's `usage_report.rate_limits` (`limits[]`, `extra_usage`) | every poll, per profile; 0 tokens, about 3 s; killed and failed after 20 s (`PLAN_USAGE_TIMEOUT_MS`) |
| Session and weekly rows between polls | `rate_limit_event.rate_limit_info.unifiedWindows` (`five_hour` → `session`, `seven_day` → `weekly_all`; `status` `allowed` / `allowed_warning` / `rejected` → `normal` / `warning` / `critical`) | after every model message |
| Context tokens | each `assistant` message's `usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens` | every reply |
| Context window | the `get_context_usage` control request's `maxTokens`, and the `result` line's `modelUsage.<model>.contextWindow` | session start and every turn |
| Session spend | the `result` line's `total_cost_usd` | every turn |
| Reported autocompact limit | the `get_context_usage` control request's `autoCompactThreshold` | session start and after every turn |
| Configured autocompact limit | the profile's `settings.json` `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, read when a session starts | session start |
| Cache expiry | the reply's `usage.cache_creation` bucket (or a cache read) and the adapter's clock | every reply |

Measured 2026-10-30 on 2.1.314: `get_context_usage` reported `autoCompactThreshold: 967000`,
`autocompactSource: "model-default"` on Opus, Sonnet and Haiku with the override at 30 in both the environment and
`settings.json`. Claude applies the override only under conditions its code does not expose, so the details input
carries both limits and flags a session whose two differ.

The launch strips `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` from the child's environment (`claude-launch.ts`,
`NESTED_SESSION_ENV`) because a parent Claude session sets it for its own children; Claude still reads it from the
profile's `settings.json`, which is why the configured limit is read there.

## Flow

```
 claude -p /usage (per profile, every pollIntervalSeconds, least 60)
        │ usage_report
        ▼
 ClaudeCodeHarness.planUsage(profileDir) ──▶ PlanUsage ─────────────┐
                                                                    │
 session process stdout                                             │
   rate_limit_event ──▶ AgentProcessEvents.planUsage(PlanRowUpdate)─┤
   assistant usage, result,                                          │
   get_context_usage reply ──▶ AgentProcessEvents.agentEvent(usage) │
        │                                                           │
        ▼                                                           │
 chat main ──▶ bus: chat.sessionOpened {sessionId, profileDir}     │
           ──▶ bus: chat.agentEvent {sessionId, profileDir, event}  │
           ──▶ bus: chat.planUsage {profileDir, update}             │
        │                                                           │
        ▼                                                           ▼
 usage main: per-profile PlanUsage (poll, then live updates folded in), per-session usage
        │ channel: snapshot
        ▼
 usage page ──▶ status bar line (the shown session's profile's plan rows)
            ──▶ chat.addStatusPart: each Chat session's context, cache and spend in its status line
            ──▶ sessions.addRowPart (usage.rowLine): each session's context meter under its side-bar row
 usage-tab-line page (optional) ──▶ sessions.addBarPart: the same line in each session's tab bar
            ──▶ right bar details (every profile, the shown session)   toggled by Space v u
```

## Records

In `src/contracts/agent.ts`, beside `AgentHarness`:

- `PlanUsage` — `rows: readonly PlanRow[]`, `extraUsage: ExtraUsage | null`, `at` (epoch ms, when the poll started).
- `PlanRow` — `kind`, `group`, `label` (the server's model or surface name for a scoped row, otherwise the
  adapter's name for the kind), `percent` (0–100), `resetsAt` (epoch ms or null), `severity`
  (`'normal' | 'warning' | 'critical'`), `isActive`.
- `ExtraUsage` — `enabled`, `usedMinor`, `limitMinor`, `currency` (a three-letter ISO 4217 code; each null when the
  server sends none, and `currency` null when it sends another shape).
- `PlanRowUpdate` — the live rows a session saw: `rows` of `PlanRowPatch` (`{ kind, percent, resetsAt, severity }`), `at`. Folded into
  the profile's last `PlanUsage` by `kind`; a kind the poll has not reported yet is held until it does.
- `AgentHarness.planUsage(profileDir)` — runs one poll and resolves its `PlanUsage`, or rejects with the reason.
- `AgentHarness.lastUsage(sessionId, projectDir, profileDir)` — the main agent's `usage` event as the saved session's
  main replies left it, folded in order as a live process folds them: `at` is the last main reply's time,
  `contextTokens` and `cacheExpiresAt` come from those replies, and
  the window, both limits and spend are null, since only a running process knows them. It resolves null when the
  session has no main reply, and rejects, naming the path, when the transcript is missing.
- `AgentProcessEvents.planUsage(update)` and `AgentProcessEvents.agentEvent(event)`.
- `AgentEvent` — the agent-tower union, built here with its first member, `usage`: `agentId` (`main`), `at`,
  `contextTokens`, `contextWindow` (null until the harness reports it), `autocompact` (`configured` and `reported`, each
  tokens or null), `cacheExpiresAt` (epoch ms or null), `spendUsd` (null until the first result).
- A process emits its first `usage` event once it knows the context. A new session knows it from the start (0 tokens),
  so its line gains the limit when `get_context_usage` replies. A resumed session first seeds the context from its
  saved transcript, the same read as `lastUsage`, unless a live reply came first, so it never reports a false 0.

## The usage plugin

`src/plugins/usage/` depends on `chat`, `sessions` and `keys` (the page kit's key anchors).

- **Main** keeps one plan per chat profile (re-read at the start of each poll round, so a profile added or removed in
  settings joins or leaves), polls every one at start and then every `usage.pollIntervalSeconds` (default 300, never
  under `MIN_POLL_SECONDS` = 60; read at each reschedule and rescheduled on a settings change) through the injected
  main `timers`. It folds each `chat.planUsage` update into that profile's plan usage, records each session's profile
  from `chat.sessionOpened` (so the line shows the right profile before the session's first turn ends), keeps each
  session's latest `usage` agent event from `chat.agentEvent` (an event whose `at` is older than the kept one's records
  only the session's profile, keeping the kept usage), and drops a session when it ends. Chat sends a restored or
  resumed row's saved usage the same way: it reads `harness.lastUsage` on restoring a row that ever sent a message,
  and on resuming a session from the past-sessions picker beside its history read, and emits the result as the row's
  `agentEvent` (a resumed row's as soon as the row opens, before its process emits). A failed read is logged, and the
  row keeps the zero line until its process reports. It sends one snapshot over its channel on every change.
- A failed poll keeps the profile's last plan usage, marks it stale with the time of the last good poll, and carries
  the reason, which the details bar shows; the next good poll clears both. With no good poll yet the profile has no
  usage: the line says `plan loading` (or `plan unavailable` after a failure) and the details say `no good read yet`.
  A poll still running when the next one is due is not doubled.
- **Page** draws, through the `usage` layout:
  - a status-bar line, always on, aligned to the end: every profile stacked, one line each, its name before its plan
    rows, each limit in a column shared across the profiles. The 5h and Week rows always show; any other row shows
    only while used. Each meter is tinted by its severity. A stale profile's rows draw muted. The input also carries
    the shown session's profile's plan rows (the default profile while no session shows), for a layout that shows
    one profile.
  - each Chat session's line, a status part (chat's `addStatusPart`) in its Chat status line; the optional
    `usage-tab-line` plugin (in `plugins.disabled` by default) draws the same line as a bar part (sessions'
    `addBarPart`) in each session's tab bar. The line: its context bar
    (`used/limit`), its cache countdown and its spend. The context bar is tinted by its share of the limit (`warning`
    from 70 %, `critical` from 90 %); with no autocompact limit it shows tokens alone. A narrow bar drops whole items
    from the line's end (spend, then cache, then the context text) and keeps the context bar. Every session draws a line:
    one with no usage event yet (a new chat, a restored row before its saved usage is read, a session usage does not
    track) draws a zero line, its context `0k` with no cache or spend. The line redraws on each snapshot, each `sessions.activeChanged`, each layouts set and the
    minute tick. Each surface logs `session line in <name>: <text>` under its own plugin when a session's text
    changes, `<name>` the session's side-bar label (its id while none is known).
  - each session's row line, a sessions row part (`usage.rowLine`, added through `sessions.addRowPart`) under its
    side-bar row: the session's context meter alone, drawn by the `rowLine` layout part and redrawn like the session
    line.
  - the details bar in the right bar, toggled by `usage.toggleDetails` (`Space v u`), its open state kept in
    `uiState`: a card per profile, its rows with reset times (5h and Week always, any other row only while used),
    extra usage as `spent / limit` in its currency (only while on and spent), the poll's staleness beside the name
    and its error. A fresh profile reads `updated <ago>`, measured from the poll's `at`; with no profiles the bar says
    `No profiles`. The input also carries the shown session's context, both autocompact limits and the marker when
    they differ, cache expiry and spend, for a layout that draws them.
- Countdowns redraw once a minute through the page `timers` and `clock`.

## The right bar

A new shell area, `rightBar`, beside `main` on the right across every mode, filled by plugin contributions and hidden
while empty, like the status bar. Its width opens at the `rightbar-width` theme token and is then the user's,
resized through the split core and kept in `uiState` (`shell.right-bar-width`), as the side bar's is. Any plugin
contributes to it through `api.areas.rightBar`.

## Decisions

- **The GUI shows it, as a plugin.** The app runs the sessions and already decodes the stream; a terminal status line
  would be a second reader.
- **Poll `/usage` plus live events.** `/usage` is the only source with the Fable window and the credits, and it costs
  no tokens; the live `rate_limit_event` keeps the session and weekly rows current between polls.
- **The structured `usage_report`, not the text.** The server's rows, severities and order render verbatim.
- **Credits:** spend against the monthly limit when the plan has it; `off` when extra usage is disabled.
- **Always-on status-bar line, details one key away in a right bar.**
- **Session numbers sit on the session, plan numbers on the shared bar.** With several panes, one shared line can
  show only one session's context, so each session's context, cache and spend draw on that session (its Chat status
  line, and its tab bar with usage-tab-line on); the plan rows are account facts every pane shares and stay on the
  status bar.
- **The session line is a part, never chat input.** Usage draws it into chat's `addStatusPart` (the Chat status line,
  the default home since the chat bar, `docs/features/chat-bar/design.md`) and, through the optional `usage-tab-line`
  plugin, into sessions' `addBarPart`, so neither chat nor sessions knows usage. The tab-bar copy is for a user who
  wants the line on every tab, Form and Primer included.
- **A new right bar shell area** rather than a floating panel or a Sessions-only pane: it serves the next plugin and
  covers nothing.
- **The agent-tower agent event seam is built now,** with `usage` as its first member grown to carry the autocompact
  limits, cache expiry and spend, so there is one forwarding path from adapter to plugins.
- **Profiles:** the default status bar stacks every profile, its input also carrying the shown session's profile
  for a layout that shows one; the details bar lists every profile.
- **Autocompact limit:** the configured override wins, the reported limit rides beside it, and a difference is flagged.
- **Cache time** is the prompt-cache expiry, not an autocompact timer: autocompact fires on tokens alone.
- **Main gains injected `timers`,** matching the page's, since the poller is main's first periodic work.
- **Every chat shows its line.** A session with no usage draws a zero line rather than nothing. A restored or resumed
  session's context and cache come from its saved transcript (`lastUsage`), which covers every saved session, sessions
  from before this shipped included, with no saved state of the app's own to keep in sync. The limit and spend
  arrive with the session's process.

## Rejected

- **Parsing the `/usage` text** — the structured twin rides the same run.
- **The OAuth usage endpoint called directly** — an undocumented API behind a Keychain credential the app would have
  to hold.
- **A `get_usage` control request to an open session instead of a spawn** — no session may be open for a profile,
  and one path for every profile is simpler.
- **App-side severity thresholds** — the server already grades each row.
- **A separate `sessionUsage` event** — a second forwarding path agent-tower would then have to merge.
- **Chat depending on usage for the session line** — usage already depends on chat (its profiles), so the dependency
  would be a cycle, and each later readout would edit chat's layout contract.
- **A global data store or data buckets any plugin reads** — a second sharing mechanism beside `dependsOn` exports
  and events.
- **The session line only in the Chat composer** — it would hide while a Form or Primer tab shows; the user took it
  as the default with the tab-bar line one switch away.
