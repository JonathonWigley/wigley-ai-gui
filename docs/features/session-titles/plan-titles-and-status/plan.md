# Session titles and row status — plan

Feature: session titles and row status · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every Sessions side-bar row shows a descriptive title (set by the agent through a new
`set_session_title` tool, by the user through `<Leader>rr`, or taken from the first message) and,
beside it, what the session is doing: working, needs you, done or error. The user tells chats apart
and sees which one needs them at a glance. The design is `docs/features/session-titles/design.md`.

## Architecture

- `sessions` plugin: titles on rows (main), the `set_session_title` MCP tool (main), the shared
  title rules (`session-title.ts` at the plugin root), row drawing, the activity registry, and the
  rename dialog and command (page), plus the Layout contract and `default` layout.
- `chat` plugin: saves an owned row's titles in `open-sessions.json`, the first-message fallback,
  the session instruction (main); sets working / needs you / done / error activities (page).
- `src/shared/page/session-form-tabs.ts`: forms and primer set needs you while a form is open.
- `src/plugins/keymap.ts`: `<Leader>rr` and the `<Leader>r` group.

## Preconditions

Each was run at plan time; `wigley:make` re-runs them before the first dispatch.

| Claim | Command | At plan time |
|---|---|---|
| `visuals` is merged into main, so chat's `addInstructions` exists (the user chose to wait for it rather than copy commit `da9a67f`) | `grep -c "addInstructions" src/plugins/chat/contract.ts` ≥ 1 | **0: not met.** Stop and tell the user until `visuals` lands on main |
| `<Leader>r` holds no bind | `grep -c "<Leader>r" src/plugins/keymap.ts` | 0 |
| No session row has titles yet | `grep -c "titles" src/plugins/sessions/contract.ts` | 0 |
| Chat's saved session has no titles field | `grep -c "titles" src/plugins/chat/main/open-sessions.ts` | 0 |
| App-launched Claude sessions get no `ai-title` (why the fallback is the first message) | the python sample in the design doc's Decisions | 0 of 68 `sdk-cli` transcripts |

## Docs written ahead

Commit `af96276c`: `docs/features/session-titles/design.md`, `docs/keymap.md` (the `r` rename group
row; `r` dropped from the reserved list), `AGENTS.md` (the sessions folder line; the row activity
and session title bullet).

## Mandatory Reads

- `AGENTS.md` (repo root) — whole; § Architecture on plugins, session parts, layouts, keys, settings, self-test
- `DESIGN.md` — § Colour (status tokens), § Keys and focus, and the primitives a task draws with
- `docs/keymap.md` — § Adding a bind
- `docs/features/session-titles/design.md`
- `docs/features/layouts/design.md` — the sessions owner
- `src/plugins/sessions/contract.ts`, `src/plugins/sessions/layouts/layout.d.ts`

## Design Overview

```
            agent                               user
              │ set_session_title                 │ <Leader>rr dialog
              ▼                                   ▼
  sessions main ─ SessionList ── titles {user, agent, firstMessage} per row ──► stateChanged ─► sessions page
       ▲    │ titleChanged                                                                    │ shownTitle(titles, max)
       │    ▼                                                                                 ▼
  chat main: first message ─► setTitle(firstMessage)                         row: title · dim label · ● word
             saves titles in open-sessions.json, restores after open           ▲
             addInstructions(rename instruction)                               │ highest-rank activity
                                                                               │
  chat page ── setActivity(id,'chat', working | needs you | done | error) ─────┤
  forms/primer page (session-form-tabs) ── setActivity(id, plugin, needs you) ─┘
```

Decisions (from the interview):
- Title source: the agent's tool, then the first message as fallback; Claude's `ai-title` dropped
  (round 3, measured). User title locks out the agent's until cleared (round 1).
- Limit: setting `sessions.titleMaxLength`, default 40; refuse over-long user and agent titles,
  cut the first-message one (round 1).
- Row: title as main text, folder label as dim detail; activity dot plus word at the trailing end
  on the title's line (round 1).
- Titles kept across clear and relaunch (round 1); chat saves them with its rows (design review).
- Agent renames at the end of its first turn and when the focus clearly changes (round 1).
- Statuses needs you / working / done / error, idle blank; done and error clear on view or send
  (round 1). A turn ending in the focused pane's session skips done (Decided).
- `<Leader>rr` rename; empty submit hands naming back (round 2).
- Activities are registrations (`setActivity`), not a closed list (design review).
- Terminal sessions get no instruction (round 2).

Out of scope: Dock badge or notifications; agent free-text activity; Claude `ai-title`;
instructions in `~/wigley-agents/AGENTS.md`.

## File Structure

New:
- `src/plugins/sessions/session-title.ts` (+ `.test.ts`) — the title rules main and page share,
  as chat's `image-rules.ts` is shared at its plugin root:
  - `normalizedTitle(text: string): string` — whitespace runs to one space, trimmed
  - `titleProblem(text: string, max: number): string | null` — on the normalized text: `'The title is empty.'`, or `` `The title is ${n} characters; the limit is ${max}.` `` (n in code points), else null
  - `shownTitle(titles: SessionTitles, max: number): string | null` — `user ?? agent ?? cut(firstMessage)`, the cut being the first `max - 1` code points of the normalized text plus `…` when it has more than `max`; null when all three are null
- `src/plugins/sessions/main/title-tool.ts` (+ `.test.ts`) — the `set_session_title` tool definition and handler
- `src/plugins/sessions/page/rename-dialog.ts` (+ `.test.ts`) — the rename dialog

Shared names (in `src/plugins/sessions/contract.ts`, task 01):
- `export const TITLE_SOURCES = ['user', 'agent', 'firstMessage'] as const;`
- `export type TitleSource = (typeof TITLE_SOURCES)[number];`
- `export type SessionTitles = Record<TitleSource, string | null>;`
- `SessionRow.titles: SessionTitles`
- `SessionsMainExports.setTitle(sessionId: string, source: TitleSource, title: string | null): void`
- `SessionsMainExports.titles(sessionId: string): SessionTitles | null`
- `SessionsMainEvents.titleChanged: { sessionId: string; titles: SessionTitles }`
- `SessionsChannel.invoke.setUserTitle(sessionId: string, title: string | null): void`
- `export type ActivityTone = 'idle' | 'running' | 'success' | 'warning' | 'attention' | 'error';` (task 03; the same members as the page's `DotStatus`, which a contract may not import)
- `export interface RowActivity { word: string; tone: ActivityTone; rank: number }` (task 03)
- `SessionsPageExports.setActivity(sessionId: string, sourceId: string, activity: RowActivity | null): void` (task 03)

Modified: the `sessions` contract, manifest, main and page files, its layout contract and
`default` layout; chat's `contract.ts`, `main/chat-sessions.ts`, `main/open-sessions.ts`,
`main/start.ts`, `page/chat-view.ts`, `page/chat-state.ts`; `src/shared/page/session-form-tabs.ts`;
forms' and primer's page views (wiring only); `src/plugins/keymap.ts`.

Boundary rules: sessions imports nothing from chat, forms or primer (they depend on it).
`session-title.ts` imports only `./contract` types; the existing `src/plugins/sessions` entry in
`scripts/check-layers.mts` already covers files at the plugin root, and main and page already list
it. A plugin contract imports only `src/contracts`, so the sessions contract declares
`ActivityTone` itself; passing it to `kit.statusDot` makes the compiler check it stays assignable
to `DotStatus`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Titles on session rows](01-row-titles.md)

### Wave 2
- [x] [The set_session_title tool](02-title-tool.md) — after 01
- [x] [Row title, activities and the rename dialog](03-row-drawing-and-rename.md) — after 01
- [x] [Chat saves titles, first-message fallback, the instruction](04-chat-titles.md) — after 01

### Wave 3
- [x] [Chat activities](05-chat-activities.md) — after 03
- [x] [Forms and primer set needs you](06-form-activities.md) — after 03

### Wave 4
- [x] [Doc re-read](07-doc-re-read.md) — after 02, 03, 04, 05, 06

### Wave 5
- [x] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: e38f1bb7

### Groups
- 01 · 3b62145d · diff read (every Produces present), typecheck clean, lint clean per worker · concerns: worktree guard refuses nvm-sourced npm, so npm runs by its absolute v24.22.1 path; per-call limit covered across two table rows rather than one list
- 02 · 79a46745 · diff read (SET_SESSION_TITLE_TOOL and startTitleTool present, deps as named TitleToolDeps), no type errors in sessions/main · concerns: start test's exactly-once check rests on the list refusing a duplicate name, since tools() is not reachable through exports; fake paths built inline to keep the layer rule
- 04 · e9cb027c · diff read (SavedSession.titles, ResumeRequest.title, ChatSessions.titleChanged, deps widened all present), no type errors in chat, layers clean · concerns: agent-chat design.md saved-sessions field list omits titles (for 07); that doc says a resume keeps the first request's system prompt, so a pre-change conversation may not get the instruction on resume, against the plan's 'a resumed agent may rename once more'
- 03 · f98fa386 · diff read (ActivityTone, RowActivity, NEEDS_YOU_ACTIVITY, setActivity, createRowActivities, SessionRowInput.title/activity, commands, scope, binds present), typecheck clean, lint and sessions self-test passed per worker · concerns: status-dot.css header 'Static: only the streaming indicator moves.' now stale (for 07); .session-rename-box is a third copy of the input reset in .docs-box and .settings-box-input; problem line stays while editing until next Enter; Esc during an in-flight invoke closes but the title still sets and logs
- 06 · b24de12c · diff read (formShown dep present, forms and primer wired with own source ids), no type errors outside chat's in-progress files · concerns: forms-view.test.ts and primer-view.test.ts stubs gained setActivity, outside the Files list; start.ts files untouched since they pass the whole exports
- 05 · 4de1cf63 · diff read (Unseen, rowActivity, unseenAfterTurnEnd, unseenAfterRest, markSent, ChatViewDeps listeners and Pick widened present), typecheck clean, lint and chat self-test passed per worker · concerns: needs you has no self-test step of its own: the fixture permission is asked during open, before any step; the permission card y step's 'none' line stands in; chat-state imports the value NEEDS_YOU_ACTIVITY from sessions' contract (layers pass); the done step depends on FAKE_VISUAL_HOLD_MS outlasting two key presses
- 07 · f66c42a6 · diff read; keymap.md, AGENTS.md and layouts design.md read with no change needed · concerns: the CLI resume keeping the first request's system prompt is the agent-chat doc's claim with no code showing it; design.md Status still names the plan folder, which Close deletes
- 08 · none · drive run st08 with real Claude: checks 1-6 pass (report /tmp/claude-session-titles/reports/08-1.md, captures .drive/st08/screenshots/) · concerns: at the least side-bar width the folder label ellipsizes alongside the title, and one title cut to a bare 'M' with no ellipsis while the label vanished; restored chat's first step header read '498243h 11m'; two stray rows appeared briefly after restart while the plan loaded
### Contract changes
- createRowActivities(): inline return type → named RowActivities interface, same members · why: readability · consumers: 03 · group 03
- startTitleTool deps: inline type → named TitleToolDeps, same shape · why: readability · consumers: 02 · group 02
### Rulings
- setUserTitle(null) clears the user title, as an empty string does — channel type allows null — a caller expecting an error gets a clear · group 01 · group 01
- titles(id) returns a copy, as state() does — keeps main's object private — none · group 01 · group 01
- setTitle's unchanged check compares the normalized value — a whitespace-only change is no change — none · group 01 · group 01
- an ended session is checked before the args — an ended session with bad args reads 'This session has ended.' — none · group 02 · group 02
- an unknown tool name rejects with 'no sessions tool <name>', matching createAgentFormToolSession — unreachable through routing today — none · group 02 · group 02
- a resumed title is capped at 200 code points by the same helper as the first message — keeps saved state small — none · group 04 · group 04
- empty text means text === ''; a whitespace-only message calls setTitle, which normalizes to null — none · group 04 · group 04
- openRow sets titles for restore, resume and start alike; the titleChanged it fires saves nothing since the row is not yet held, and the following save writes them — none · group 04 · group 04
- activities live in the sessions view; forget runs in view.render for rows that left, from the same rowChanges sessionRemoved uses — none · group 03 · group 03
- set returns true only when the drawn word or tone changes — a rank-only change does not redraw — none · group 03 · group 03
- the titleMaxLength settings subscription is never disposed: PageStart has no dispose hook — a hot-reloaded part would hold a stale listener · group 03 · group 03
- trailing grid column is minmax(max-content, 1fr), not bare max-content, so it sits at the line end without a spacer track — none · group 03 · group 03
- row-drawing tests live in preview.test.ts under describe('session rows'), since Files named no sessions-view test — none · group 03 · group 03
- the exact-call-list cases are a new test rather than rows in the existing sync test — reviewers may want them merged · group 06 · group 06
- the row activity log line fires only on a change, compared by identity against shared constants — duplicate lines if the constants stopped being shared · group 05 · group 05
- markSent, activeChanged and sessionHostChanged share one clearUnseen — none · group 05 · group 05
- needs you's self-test is covered by the permission card step's 'none' line rather than a step of its own — changing the runner or fixture to re-ask a permission is out of the plan's scope; the unit table covers rowActivity's waiting row — a regression only in the view's wiring of waiting would slip past the self-test · lead
- the plan's 'a resumed agent may rename once more' is dropped: per agent-chat design a resume keeps the first request's system prompt, so a pre-feature conversation never gets the instruction — if the CLI does re-read appended prompts on resume, the doc understates it · group 07 · group 07
- the test gate, self-test and drive run all run in the worktree: this is an Electron app with no editor boundary, and the worktree has its own .vite and node_modules symlinked to the main tree — none · lead
- triage by the user's standing word (go with every recommendation): fix now 1-8, 12-14, 16-18; leave 15 (a done on the visible session would linger after the user returns; the OS alert already names the finish) and 20 (invisible, and dropping late sets conflicts with set-before-row); follow-up 19 (shared input reset across five plugins) and 21 (pre-existing split picker) — none · lead
- re-review 1 finding 1 (fake permission ask matched by folder) left: chat's session state holds no host session id, and the self-test's folders are distinct
### Review rounds
- review 1 · 675f65f7 · NEEDS FIXES — 5 important, 15 minor, 1 pre-existing (/tmp/claude-session-titles/review-675f65f7.md); lead applied 9, 10, 11 in e3981051
- re-review 1 · eb88d107 (fix commits 187973e1..eb88d107) · NEEDS FIXES — every prior finding closed; 2 minor: rename dialog redraw untested, fake permission ask routed by folder not host session id
- re-review 2 · a2ba7507 · PASS — redraw test pins body, layout, box place, text and focus
### Test gate
- Vitest: src/plugins/{sessions,chat,forms,primer}, src/shared/page/session-form-tabs.test.ts, keymap.test.ts, shared/keymap-checks.test.ts, agent-form-drive.test.ts — every touched plugin and the keymap/session-form-tabs seams the range edits; first run failed 3 in chat/main/start.test.ts (stale fake and instructions assertion from group 04), fixed in a dispatched test-only commit, re-run 1652/1652 pass · self-test --plugin sessions,chat,forms,primer: all passed (/tmp/claude-session-titles/selftest-gate.log) · lint clean
