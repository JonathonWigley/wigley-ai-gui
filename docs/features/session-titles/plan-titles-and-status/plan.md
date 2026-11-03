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
- [ ] [Titles on session rows](01-row-titles.md)

### Wave 2
- [ ] [The set_session_title tool](02-title-tool.md) — after 01
- [ ] [Row title, activities and the rename dialog](03-row-drawing-and-rename.md) — after 01
- [ ] [Chat saves titles, first-message fallback, the instruction](04-chat-titles.md) — after 01

### Wave 3
- [ ] [Chat activities](05-chat-activities.md) — after 03
- [ ] [Forms and primer set needs you](06-form-activities.md) — after 03

### Wave 4
- [ ] [Doc re-read](07-doc-re-read.md) — after 02, 03, 04, 05, 06

### Wave 5
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: e38f1bb7

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
