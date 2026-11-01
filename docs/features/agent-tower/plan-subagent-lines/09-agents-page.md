# 09 — Agents page: lines, layout, preview

Status: not started
Type: Task
Wave: 4 · Depends on: 06, 08 (precondition: the chat-panes plan `docs/features/chat-panes/plan-chat-panes/` has landed and 06 hooked the row parts into the side bar as it stands then)
Plan: [plan.md](plan.md)

Files:     create `src/plugins/agents/page/start.ts` · create `src/plugins/agents/page/subagent-lines.ts` ·
           create `src/plugins/agents/page/elapsed.ts` · create `src/plugins/agents/page/agents.css` ·
           create `src/plugins/agents/page/layout/read-agents-layout.ts` ·
           create `src/plugins/agents/layouts/layout.d.ts` · create `src/plugins/agents/layouts/default/layout.js` ·
           create `src/plugins/agents/main/preview.ts` · modify `src/plugins/agents/main/start.ts` ·
           modify `src/plugins/agents/manifest.ts` · modify `src/plugins/agents/contract.ts` ·
           modify `src/plugins/page.ts` · modify `src/plugins/keymap.ts` · modify `scripts/check-layers.mts` ·
           modify `docs/keymap.md` ·
           test `src/plugins/agents/page/elapsed.test.ts` · test `src/plugins/agents/page/subagent-lines.test.ts` ·
           test `src/plugins/agents/main/preview.test.ts`
Consumes:  `SessionRowPart`, `SessionsPageExports.addRowPart(part: SessionRowPart): Disposable` ← 06
           `agentsMainPart`, the roster map and `rosters()` / `rosterChanged` in `src/plugins/agents/main/start.ts` ← 08
           `agentsManifest`, `RunningAgent`, `AgentsChannel` ← 07
           `SessionsMainExports.open` / `activate`, `SessionsPageEvents.sessionAdded` / `sessionRemoved`,
           `KeysPageExports` (in the tree)
Produces:  in `src/plugins/agents/layouts/layout.d.ts` (plan.md File Structure, plus the kit, part and complete types):
           `export interface SubagentLineInput { agentType: string; description: string; elapsed: string; toolCalls: number }`
           `export interface AgentsKit extends BaseKit {}`
           `export interface AgentsPart { element: HTMLElement }`
           `export interface Layout { line?(parent: HTMLElement, input: SubagentLineInput, kit: AgentsKit): AgentsPart }`
           `export interface CompleteLayout extends Required<Layout> {}`
           in `src/plugins/agents/page/elapsed.ts`: `export function elapsedText(ms: number): string;`
           in `src/plugins/agents/page/start.ts`: `export const agentsPagePart: PagePart<typeof agentsManifest>`
           in `src/plugins/agents/main/preview.ts`:
           `export interface AgentsPreview { toggle(): void; rosters(): Record<string, RunningAgent[]>; closed(sessionId: string): void }`
           `export function createAgentsPreview(deps: AgentsPreviewDeps): AgentsPreview;`
           `AgentsChannel.invoke` gains `openPreview(): void` in `src/plugins/agents/contract.ts`
           manifest: command `openPreview` (`label: 'open the agents layout preview'`, `group: 'debug'`,
           `runsIn: 'page'`); setting `layout: 'default'` with its `settingInfo` (label `Layout`, description
           `The agents layout the subagent lines under each session row draw in: a folder name in agents' layouts folder, or default.`)
Decisions:
- **Channel addition.** `openPreview()` is added to `AgentsChannel`, beyond plan.md's File Structure, because a
  `where: 'page'` key must name a page command (AGENTS.md § A plugin). The page command invokes main, as
  `chat.openPreview` does (`chat-commands.ts`). On a rejection it logs `[agents] agents preview not opened: <error>`
  and toasts `Agents preview not opened: <error>` (`'error'`).
- **Layout contract and default**, following `src/plugins/sessions/layouts/`:
  - The header comment of `layout.d.ts` says what the layout draws: one `line` per running subagent, drawn into the
    row part's wrapper, its root carrying `data-layout` and `data-layout-owner="agents"`. It also says what the app
    keeps: the click (the session row's), no keys and no focus, the once-a-second redraw while a line shows, and the
    formatted elapsed text.
  - `default/layout.js` (`// @ts-check`, `/** @type {import('../layout').CompleteLayout} */`) draws
    `div.agents-line` with these children:
    - `kit.statusDot(element, 'running')`
    - `span.agents-line-type` (`agentType`)
    - `span.agents-line-description` (`description`)
    - `span.agents-line-elapsed` (`elapsed`)
    - `span.agents-line-tools`, reading `1 tool` when `toolCalls === 1` and otherwise `${toolCalls} tools` (`0 tools`
      included)
  - `elapsed` stays a pre-formatted string, as pinned. Chat's activity line, landing in the peer plan, formats its
    time inside its layout (`spanText`). 12 reads the two lines side by side; plan.md's pin stands.
- **Reader**: `page/layout/read-agents-layout.ts` exports `readAgentsLayout(module, name): Layout` over
  `readLayoutParts` with `LAYOUT_PARTS: Record<keyof Layout, true> = { line: true }`, as
  `read-sessions-layout.ts` does. This file is beyond plan.md's New files list; it follows every owner's reader.
- **Registration of layouts.** Main's `start.ts` calls `api.layouts.register({ layoutTypes })`, with `layoutTypes`
  imported from `../layouts/layout.d.ts?raw`, and its `dispose` disposes the result (as in `keysMainPart`). The page
  calls `api.layouts.show<Layout>({ defaultLayout, read: readAgentsLayout, userLayout: () => api.settings().layout,
  setLayouts: (shown) => lines.setLayouts(shown) })`.
- **`elapsedText(ms)`**, the format chat's activity line uses (DESIGN.md § Surfaces, Chat):
  - whole seconds, rounded down, with a negative value read as `0s`
  - under a minute, `<s>s`
  - under an hour, `<m>m <ss>s`, seconds two digits
  - otherwise `<h>h <mm>m`, minutes two digits
  - The line's text is `elapsedText(clock.now() - startedAt)`, with `services.clock`.
- **`subagent-lines.ts`** exports
  `createSubagentLines(deps: SubagentLinesDeps): { part: SessionRowPart; setRunning(sessionId: string, running: RunningAgent[]): void; setLayouts(shown: ShownLayouts<Layout>): void; forget(sessionId: string): void }`.
  `SubagentLinesDeps` holds:
  - `OwnerKitServices`
  - `log: Log`
  - `clock: Clock`
  - `timers: Timers`
  - `nameOf(sessionId: string): string`

  It works like this:
  - It keeps each session's running list and each built wrapper, by sessionId. A row redraw builds and disposes
    wrappers many times, so the running list outlives them.
  - `part.id` is `'agents.subagentLines'`. `part.build(wrapper, sessionId)` holds the wrapper and draws that
    session's lines into it. Its `dispose` disposes the drawn lines and lets the wrapper go.
  - A draw disposes the wrapper's previous `DrawnPart`s, empties the wrapper, and draws one `line` per running
    agent, in roster order, through `createLayoutParts` (owner `agents`). The kit is
    `createBaseKit(ownerBaseKitDeps(agentsManifest, services, null, rollback))`.
  - `setRunning` stores the list (an empty list deletes it) and redraws that session's held wrapper, if any.
  - `setLayouts` redraws every held wrapper. `forget` deletes the running list and the logged count.
  - **Ticker:** one `timers.set(tick, 1000)`. It is scheduled when a draw leaves at least one line on screen and no
    tick is pending. Each tick redraws every held wrapper and reschedules only while a line still shows. It is
    cleared (`timers.clear`) when the last line goes, whether by a dispose or an empty roster (plan.md Decisions: the
    ticker runs only while a line shows). Each tick redraws whole lines, because the pinned `line` part has no
    update hook.
  - **The page log line** is the self-test's anchor (10): after a draw into a session's wrapper, when the line count
    differs from the last count logged for that session (unlogged reads as 0), it logs
    `[agents] lines in <name>: <count>` (`api.services.log('agents', …)`). The last count is kept per session across
    wrapper rebuilds, so a row redraw or a tick logs nothing new. `forget` clears it.
  - The lines add no listener, no `tabIndex` and no key scope. A click bubbles to the session row's `rowAction`
    (06), which selects the session (plan.md Decisions: lines take no keys or focus, and a click selects the
    session).
- **Page `start.ts`** (`PageApi<typeof agentsManifest, AgentsChannel, Record<never, never>, QualifiedEvents<'sessions', SessionsPageEvents>>`)
  does this:
  - It reads `api.dependency<SessionsPageExports>('sessions')` and `api.dependency<KeysPageExports>('keys')`.
  - It builds the lines and calls `sessions.addRowPart(lines.part)`.
  - Names: a map from sessionId to name, filled on `sessions.sessionAdded` with
    `api.services.paths.base(projectDir)`, or the sessionId when `projectDir` is null. `sessions.sessionRemoved`
    deletes the name and calls `lines.forget`.
  - Rosters: `api.channel.on('rosterChanged', ({ sessionId, running }) => lines.setRunning(sessionId, running))`,
    then `api.channel.invoke('rosters')`. The answer applies only to sessions no `rosterChanged` has touched since
    the call, the stale-read rule `sessions/page/start.ts` follows. A failed read logs
    `[agents] rosters not read: <error>`.
  - It imports `./agents.css`.
- **CSS** (`agents.css`, tokens only):
  - `.agents-line` is a one-line grid: `max-content max-content minmax(0, 1fr) max-content max-content`, with column
    gap `--wg-space-2`, `min-height: var(--wg-row-tree)`, `align-items: center`, and `padding-left: 0`
    so the dot sits under the row label's start (the holder already sits inside `.ui-row`'s padding). Its font size is `--wg-text-12`.
  - Type: `font-family: var(--wg-font-mono)` (DESIGN.md § Type: tool names are mono), in `--wg-fg-secondary`.
  - Description: `--wg-fg-secondary`, with `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis` and
    `white-space: nowrap`.
  - Elapsed and tools: `--wg-fg-tertiary`, with `font-variant-numeric: tabular-nums`.
  - Before writing the rules, check each token name against `src/config/themes/` (`npm run lint` fails a raw value).
- **Preview** (`main/preview.ts`). It follows `chat-preview.ts`'s held row with no process, but toggles like
  `sessions.openPreview` (12's check: the second press closes it).
  - `AgentsPreviewDeps` is `{ sessions: Pick<SessionsMainExports, 'open' | 'activate'>; clock: Clock; send: MainChannel<AgentsChannel>['send']; log: Log }`.
  - `toggle()`, with no preview open, runs `sessions.open({ sessionId: 'agents-layout-preview', projectDir: 'Agents preview', deadlineSeconds: null, harness: null }, { select: true })`.
    Then it runs `sessions.activate(id)`, sends `rosterChanged` with the sample, and logs
    `[agents] agents preview opened`.
  - `toggle()` while it is open ends the row (`owned.end()`), sends `rosterChanged` with `running: []`, and logs
    `[agents] agents preview closed`.
  - `closed(sessionId)` for the preview's row, heard on `sessions.closed` (Cmd+W), ends it the same way with no log,
    so the next press opens a fresh one.
  - `rosters()` returns `{ [id]: sample }` while it is open, else `{}`. Main's `rosters` handler merges it over the
    live map.
  - The sample has two agents, each `startedAt` taken from `clock.now()` at open:
    - `preview-agent-1`: `wigley:sonnet-medium`, `Map every caller of the session list`, started 42 000 ms earlier,
      `toolCalls` 1
    - `preview-agent-2`: `Explore`,
      `Find every adapter behind the Files contract and list what each one writes, so this line ends in an ellipsis`,
      started 185 000 ms earlier, `toolCalls` 12

    At open the lines read `42s` and `1 tool`, and `3m 05s` and `12 tools` (separate columns, no separator).
  - Main's `start.ts` handles `openPreview` with `() => preview.toggle()`, and adds `preview.closed(sessionId)` to
    its `sessions.closed` handler. It now calls `api.dependency<SessionsMainExports>('sessions')` for `open` and
    `activate`.
- **Key.** In `src/plugins/keymap.ts`, right after the `<Leader>zlc` entry, add
  `{ keys: '<Leader>zla', scope: 'any', command: 'agents.openPreview', where: 'page' }`. In `docs/keymap.md`, add
  `zla agents preview` to the `zl` row. Leader sequences are exempt from the placement check (AGENTS.md § Key
  hints, "Leader sequences and vim's own keys are left out"), so the key needs no anchor and no self-test fixture.
- **Registration.**
  - Add `agentsPagePart` to `pageParts` in `src/plugins/page.ts`, after `chatPagePart`.
  - `LAYERS` gains `'src/plugins/agents/layouts': { layers: ['src/shared/page/layout-host'], packages: [] }`.
  - `LAYERS` gains `'src/plugins/agents/page'`, with the `sessions/page` entry's layers: `src/contracts`,
    `src/shared`, `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host`, `src/plugins/agents`,
    `src/plugins/agents/contract.ts`, `src/plugins/agents/layouts`, `src/plugins/sessions/contract.ts` and
    `src/plugins/keys/contract.ts`.
  - Add `'src/plugins/agents/layouts'` to the `agents/main` entry.
  - Add `'src/plugins/agents'` and `'src/plugins/agents/page'` to the `src/plugins/page.ts` entry.
  - `layout-contracts.test.ts` picks the new `layout.d.ts` up on its own.

GIVEN a held wrapper and a session running two agents WHEN the lines draw THEN two `agents-line` roots are drawn with
`data-layout-owner="agents"`, inputs in roster order, and `[agents] lines in <name>: 2` is logged once.
GIVEN lines on screen WHEN a tick fires 1 s later THEN the lines redraw with the new elapsed text and a next tick is
set. GIVEN the roster becomes empty THEN the pending tick is cleared and none is set again.
GIVEN no preview WHEN `toggle` runs twice THEN one row opens selected with the two-agent sample, then that row ends
and `rosterChanged` sends `[]`.

Tests:
- `elapsed.test.ts`: `it.each` `elapsedText_Ms_Formats ($ms → $text)`. Catches a padding, rounding or unit-boundary
  slip. Rows:

  | ms | text |
  | --- | --- |
  | 0 | `0s` |
  | 8000 | `8s` |
  | 42999 | `42s` |
  | 59999 | `59s` |
  | 60000 | `1m 00s` |
  | 185000 | `3m 05s` |
  | 3599000 | `59m 59s` |
  | 3600000 | `1h 00m` |
  | 3720000 | `1h 02m` |
  | -500 | `0s` |

- `subagent-lines.test.ts` (fake DOM via `installFakeDom`; fake timers recording `set` and `clear`; a fake clock;
  `recordingAnchors` for keys):
  - `build_TwoRunning_DrawsLineEachAndLogsCount`: the wrapper holds two `agents-line` elements whose text holds
    `Explore`, `42s` and `1 tool`, and the log holds exactly one `[agents] lines in proj: 2`. A second build of the
    same session logs nothing new. Catches a log on every row redraw, which would break 10's waits.
  - `tick_LinesShown_RedrawsElapsedAndStopsWhenEmpty`: after the clock moves 1000 ms and the recorded tick runs, the
    text shows `43s` and one new `set` is recorded. After `setRunning(id, [])`, the pending handle is cleared, no
    `set` follows, and `[agents] lines in proj: 0` is logged. Catches a ticker left running with no line.
  - `build_UserLineThrows_DrawsWithDefault`: with a user layout whose `line` throws, the roots carry
    `data-layout="default"`.
- `preview.test.ts` (fake `sessions` with `open`/`activate` recorders and a recorded `send`, as
  `chat-preview.test.ts` builds them):
  - `toggle_Twice_OpensSampleThenEndsRow`: the first call opens host id `agents-layout-preview` selected, and the
    sent roster has 2 agents with `startedAt` now−42 000 and now−185 000. The second ends the row and sends `[]`.
  - `closed_PreviewRow_NextToggleOpensAgain`: catches a preview stuck as open after Cmd+W.

Visual and click checks (layout, ellipsis, ticking, click selection, `Space z l a`) are 12's.
Done when: compiles; `npm test` runs the three test files and `layout-contracts.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof
