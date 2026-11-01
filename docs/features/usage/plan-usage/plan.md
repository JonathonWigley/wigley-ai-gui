# Usage — plan

Feature: usage · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An always-on status-bar line shows the shown session's context against its autocompact limit, its prompt-cache
countdown and its spend, then its profile's plan rows (5-hour, weekly, Fable, and any row the server adds). `Space v u`
opens a details view in a new right bar: every profile's rows with reset times and extra-usage credits, the poll's
staleness, and the session's context with both autocompact limits. The design is `docs/features/usage/design.md`;
this plan builds it.

## Architecture

Systems touched:

- **Shell** (`src/contracts/plugin.ts`, `src/renderer/shell/`, `src/renderer/plugins/page-api.ts`, the gallery's test
  layout, `src/config/theme-tokens.ts` and the theme): a new `rightBar` area.
- **Main ambient services** (`src/contracts/ambient.ts`, `src/contracts/plugin.ts`, `src/main/main.ts`): injected
  `timers` in `MainServices`.
- **Agent harness seam** (`src/contracts/agent.ts`) and the **Claude adapter** (`src/main/claude-code/`): plan usage
  records, `AgentHarness.planUsage`, `AgentProcessEvents.planUsage` and `agentEvent` with its `usage` member; the fake
  harness (`src/shared/fake-agent-harness.ts`).
- **Chat main** (`src/plugins/chat/`): forwards each owned session's `agentEvent` and `planUsage` as bus events, and
  exports the profiles.
- **The usage plugin** (`src/plugins/usage/`, new): main poller and store, page status-bar line and right-bar details,
  its layout contract and `default` layout, registration, keymap, layer check, self-test and drive actions.

## Preconditions

Each was run at plan time from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `wigley:make` runs them
again before the first dispatch.

| Claim | Command | Result at plan time |
| --- | --- | --- |
| The target branch is `main` | `git rev-parse --abbrev-ref HEAD` | `main` |
| `main` is not behind origin | `git fetch -q origin && git rev-list --left-right --count main...origin/main` | `13 0` |
| The activity-line plan has closed, so its edits to `agent.ts`, `stream-decoder.ts`, `claude-code-harness.ts` and `main.ts` (`ChatEntry.at`, `ClaudeCodeHarnessDeps.clock`) are landed. **This plan starts only after it.** | `test ! -d docs/features/agent-chat/plan-activity-line && git status --porcelain src` | plan folder present, 4 of 10 boxes ticked, `src/` edits uncommitted: **not met at plan time** |
| The chat-panes plan's state is known: it edits `plugin.ts`, `page-api.ts`, `renderer.ts` and `keymap.ts`, which tasks 01, 02 and 06 also edit | `test -d docs/features/chat-panes/plan-chat-panes && grep -c '^- \[ \]' docs/features/chat-panes/plan-chat-panes/plan.md` | 8 open boxes, plan not started. If it is running, wait for it; if it has closed, re-read the files it changed |
| `AreaName` has seven members, with no right-hand area | `grep -n -A8 'AreaName =' src/contracts/plugin.ts` | `titleBar activityBar sideBar main panel statusBar overlay` |
| `MainServices` has a `clock` and no `timers` | `grep -n -A16 'interface MainServices' src/contracts/plugin.ts` | `clock: Clock` only |
| No agent event or plan usage exists yet | `grep -rn 'agentEvent\|planUsage' src` | no match |
| No plugin contributes to the status bar (measured at plan time, re-verify) | `grep -rln 'statusBar.contribute' src/plugins` | only `gallery/` test code |
| The launch strips `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` from the child's env | `grep -n CLAUDE_AUTOCOMPACT_PCT_OVERRIDE src/main/claude-code/claude-launch.ts` | line 19 |
| Claude Code is 2.1.314, and `/usage` in stream-json carries `usage_report` | `claude --version`; `claude -p /usage --output-format stream-json --verbose \| command grep -a -c usage_report` (run with the nested-session vars stripped) | `2.1.314`; `1` |
| `--no-session-persistence` keeps the top-level `usage_report` on the `assistant` line | `claude -p /usage --output-format stream-json --verbose --no-session-persistence \| command grep -a -c usage_report` (nested-session vars stripped) | `1`; the field is top-level, beside `message` |
| `get_context_usage` answers over stdin with `autoCompactThreshold` | `printf '%s\n' '{"type":"control_request","request_id":"r1","request":{"subtype":"get_context_usage"}}' \| claude -p --input-format stream-json --output-format stream-json --verbose \| command grep -a -c autoCompactThreshold` | `1` |
| Both profiles set the autocompact override in `settings.json` `env` | `grep -n AUTOCOMPACT ~/.claude/settings.json ~/.claude-personal/settings.json` | `"30"` in both |

## Docs written ahead

Commit `444f673` (on `main`): `docs/features/usage/design.md` (new: the settled design), `AGENTS.md` (the
shell's right bar, the `usage/` plugin entry, main `timers`), `DESIGN.md` (the right bar surface and token, the
status-bar line, the usage surfaces), `docs/keymap.md` (`Space v u`), `docs/features/agent-tower/design.md` (Status
made true; the grown `usage` event), `docs/features/layouts/design.md` (the `usage` owner),
`docs/features/agent-chat/claude-stream.md` (the measured `rate_limit_event`, `usage_report` and the usage control
requests).

## Mandatory Reads

- `AGENTS.md` (whole: Intent, Architecture, the layer check, Running and testing, Dev quirks)
- `DESIGN.md` — every task that draws (01, 06)
- `docs/keymap.md` — task 06
- `docs/features/usage/design.md` — every task
- `docs/features/agent-tower/design.md` § Agent events — tasks 03, 04
- `docs/features/agent-chat/claude-stream.md` § Other events and the usage section — task 03
- `docs/features/layouts/design.md` — task 06
- `src/**/AGENTS*.md`, `src/**/CLAUDE*.md`, `.claude/rules/*.md` under any touched folder (glob at run time)

## Design Overview

```
 claude -p /usage ──▶ ClaudeCodeHarness.planUsage(profileDir) ──▶ PlanUsage ───────────────┐
 session stdout ──▶ stream-decoder ──▶ harness ──▶ AgentProcessEvents.planUsage(update) ──┐ │
                                              └──▶ AgentProcessEvents.agentEvent(usage) ┐ │ │
                                                                                         ▼ ▼ │
                              chat main ──▶ bus chat.agentEvent / chat.planUsage ──▶ usage main ◀┘
                                                                         │ channel 'changed' (UsageSnapshot)
                                                                         ▼
                                           usage page ──▶ statusBar line · rightBar details (Space v u)
```

Out of scope: the agents plugin, `addRowPart` and every other agent-tower event; subagent context; per-model
weekly windows beyond what the server's `limits[]` sends; sending `get_usage` to an open session; any notification
when a window nears its limit.

Decisions are in `docs/features/usage/design.md` § Decisions; this plan's own:

- `Timers` moves to `src/contracts/ambient.ts` beside `Clock` when it lives elsewhere, so main and page name one type.
- The configured autocompact limit is read once per session start from the profile's `settings.json` `env`; a change
  applies to the next session.
- The adapter sends `get_context_usage` after each turn's `result`, through the same control-request path the
  harness already uses for its own requests, and turns its reply into the next `usage` event's `reported` limit.
- Plan rows from a `rate_limit_event` are folded into the profile's plan usage by `kind` in usage main, never in the
  adapter: the adapter has no memory of the poll.

## File Structure

Shared names and signatures more than one task uses. Each task document names its own files.

**`src/contracts/agent.ts`** (03):

```ts
export type PlanSeverity = 'normal' | 'warning' | 'critical';
export interface PlanRow {
  kind: string; group: string; label: string;
  percent: number;            // 0–100
  resetsAt: number | null;    // epoch ms
  severity: PlanSeverity; isActive: boolean;
}
export interface ExtraUsage {
  enabled: boolean; usedMinor: number | null; limitMinor: number | null; currency: string | null;
}
export interface PlanUsage { rows: readonly PlanRow[]; extraUsage: ExtraUsage | null; at: number }
export type PlanRowPatch = Pick<PlanRow, 'kind' | 'percent' | 'resetsAt' | 'severity'>;
export interface PlanRowUpdate { rows: readonly PlanRowPatch[]; at: number }
export interface AutocompactLimits { configured: number | null; reported: number | null }
export interface UsageAgentEvent {
  type: 'usage'; agentId: string; at: number;
  contextTokens: number; contextWindow: number | null;
  autocompact: AutocompactLimits; cacheExpiresAt: number | null; spendUsd: number | null;
}
export type AgentEvent = UsageAgentEvent;
// AgentProcessEvents gains:  planUsage(update: PlanRowUpdate): void;  agentEvent(event: AgentEvent): void;
// AgentHarness gains:        planUsage(profileDir: string | null): Promise<PlanUsage>;
```

**`src/contracts/ambient.ts`, `src/contracts/plugin.ts`** (02): `MainServices.timers: Timers`, the same `Timers`
interface `PageServices.timers` uses (`set(run, ms): number; clear(handle): void`).

**`src/contracts/plugin.ts`** (01): `AreaName` and `PluginAreas` gain `'rightBar'`.

**`src/plugins/chat/contract.ts`** (04): chat main's bus events and one export:

```ts
export interface ChatMainEvents extends EventShape {
  agentEvent: { sessionId: string; profileDir: string | null; event: AgentEvent };
  planUsage: { profileDir: string | null; update: PlanRowUpdate };
  sessionOpened: { sessionId: string; profileDir: string };
}
// ChatMainExports gains:  profiles(): readonly ChatProfile[]   // chat's `profiles` setting, in its order
```

`ChatProfile` is the existing `{ name, configDir }`. The first profile is the default (05 sets `ProfilePlan.isDefault`
for index 0). Every `profileDir` on the bus and in the usage contract is `configDir` as the setting writes it
(`~/.claude-personal`), unexpanded, so 05 matches profiles by plain equality. `profiles()` sits beside the existing
`profileNames()` and `profileOf(sessionId)` (a profile name); `profileNames` becomes `profiles().map(name)` at its
export. `CHAT_HARNESS_ID` moves from `chat/main/lookups.ts` to `chat/contract.ts` (05), so usage names the harness.

**`src/plugins/usage/contract.ts`** (05):

```ts
export interface ProfilePlan {
  name: string; profileDir: string | null; isDefault: boolean;
  usage: PlanUsage | null; lastGoodAt: number | null; error: string | null; stale: boolean;
}
export interface SessionUsage { sessionId: string; profileDir: string | null; usage: UsageAgentEvent | null } // null until its first usage event
export interface UsageSnapshot { plans: readonly ProfilePlan[]; sessions: readonly SessionUsage[] }
export interface UsageChannel extends ChannelShape {
  invoke: { snapshot(): UsageSnapshot };
  messages: { changed: UsageSnapshot };
}
```

**`src/plugins/usage/manifest.ts`** (05): id `usage`, `dependsOn: ['chat', 'sessions', 'keys']` (the page's base kit reads the `keys` page exports), `settings:
{ pollIntervalSeconds: 300, layout: 'default' }`, command `toggleDetails` (`label: 'hide or show usage details'`,
`group: 'view'`, `runsIn: 'page'`). Default bind (06): `{ keys: '<Leader>vu', scope: 'any', command:
'usage.toggleDetails' }` in `src/plugins/keymap.ts`.

**Boundary rules**: only `src/main/claude-code/` knows `usage_report`, `rate_limit_event`, `get_context_usage`,
`modelUsage` or `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. The usage plugin reaches Claude only through `AgentHarness` and
chat's bus events and exports. New folders get their `scripts/check-layers.mts` entries in the task that creates them.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Right bar shell area](01-right-bar-area.md)
- [x] [Plan usage and agent events from the Claude adapter](03-adapter-usage.md)

### Wave 2
- [x] [Main timers](02-main-timers.md) — after 01 (shares `plugin.ts`)
- [ ] [Chat forwards agent events and plan usage](04-chat-forwarding.md) — after 03

### Wave 3
- [ ] [Usage main: poller and store](05-usage-main.md) — after 02, 03, 04

### Wave 4
- [ ] [Usage page: status-bar line and details bar](06-usage-page.md) — after 01, 05

### Wave 5
- [ ] [Self-test and drive actions](07-selftest-drive.md) — after 06

### Wave 6
- [ ] [Doc re-read](08-doc-re-read.md) — after 07

### Wave 7
- [ ] [Final verification](09-final-verification.md) — after 08

## Run log

Review base: 951296f231ed299e8ca9a12bf918bf1f5e9462cc

### Groups
- 01 · fef2080 · diff read: every Produces present; typecheck clean in 01 files (only errors were 03's in-flight harness tests); worker ran shell/split/page-api tests, 106 pass · concerns: stale prose outside Files: settings.ts:96 shell.layout description and layouts/design.md:72,79 'four chrome areas'; side bar may not regrow in the same pass the right bar shrinks (real-DOM only); grid/handle/gallery layout not checked live; three shell test names undersell their two-handle assertions
- 03 · 356bd8a · diff read: every Produces present; typecheck clean; worker ran 249 tests across adapter, fake harness and chat users, all pass · concerns: oxfmt --check fails on DESIGN.md and docs/keymap.md (committed in 444f673, predate this run); AGENTS.md claude-code row omits claude -p /usage; harness test checks plan-usage row labels only
- 02 · eb3464b · diff read: MainServices.timers after clock, live adapter in main.ts passed to startMainParts; typecheck clean; no tests picked (no test changed) · concerns: oxfmt --check flags DESIGN.md and docs/keymap.md, unmodified since 444f673 (pre-existing)
### Contract changes
### Rulings
- right bar redraws both bars only when its hidden state flips (updateHidden wrapper); a layout swap keeps plain applyHidden — a swap needing a redraw waits for the next resize · group 01 · group 01
- sizedPane 'end' lives in two private mappings inside createSplitDivider plus a flipped nudge direction; createDividerHandle unchanged · group 01 · group 01
- chat-sessions processEvents got empty planUsage/agentEvent bodies with a placeholder comment; task 04 replaces both and drops the comment · group 03 · group 03
- runCli timeout message is built from the args; reads exactly 'claude -p /usage gave no answer in 20 s' · group 03 · group 03
- turnUsageOf falls back to the largest window when the model key exists but has no numeric contextWindow · group 03 · group 03
- get_context_usage is written after every result line, even with a queued turn pending · group 03 · group 03
### Review rounds
### Test gate
