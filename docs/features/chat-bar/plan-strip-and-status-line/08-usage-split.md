# 08 — Usage in the status line, and the usage-tab-line plugin

Status: in progress
Type: Task
Wave: 4 · Depends on: 01, 05, 07
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/usage/contract.ts`
- modify `src/plugins/usage/manifest.ts`
- modify `src/plugins/usage/page/start.ts`
- modify `src/plugins/usage/page/session-lines.ts` · test `src/plugins/usage/page/session-lines.test.ts`
- create `src/plugins/usage/page/session-line-parts.ts` · test `src/plugins/usage/page/session-line-parts.test.ts`
- modify `src/plugins/usage/page/usage.css`
- modify `src/plugins/usage/layouts/layout.d.ts`, `src/plugins/usage/layouts/default/layout.js` (comments only)
- modify `src/plugins/usage/main/start.ts` · test `src/plugins/usage/main/start.test.ts`
- modify `src/plugins/usage/main/selftest-script.ts` · test `src/plugins/usage/main/selftest-script.test.ts`
- create `src/plugins/usage-tab-line/manifest.ts`
- create `src/plugins/usage-tab-line/page/start.ts` · test `src/plugins/usage-tab-line/page/start.test.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/page.ts`, `scripts/check-layers.mts`

Consumes:
- `ChatStatusPart` and `ChatPageExports.addStatusPart(part: ChatStatusPart): Disposable` in
  `src/plugins/chat/contract.ts` ← 05
- the plugin id rule: `definePlugin` accepts `-` (`PLUGIN_ID = /^[a-z0-9-]+$/` in `src/shared/define-plugin.ts`, tree
  today), so the id is `usage-tab-line` ← 01 confirms
- the self-test starts every plugin (`plugins.disabled: []`; task 01 § Decisions, Self-test; plan.md § Decided by
  the agent) ← 01
- `SessionsPageExports.addBarPart`, `sessions.sessionAdded` (`label`), `sessions.sessionRemoved`;
  `ChatMainExports.launch`, `ChatMainExports.closeSessionsIn`; `SessionsMainExports.activate`; `fakeUsageEvent` and the
  fake turn's end in `src/shared/fake-agent-harness.ts` (tree today)

Produces:
- in `src/plugins/usage/contract.ts`:
  ```ts
  // A part usage draws one session's usage line into: the same { id, build } shape as chat's status part and
  // sessions' bar part.
  export interface UsageLinePart {
    id: string;
    build(parent: HTMLElement, sessionId: string): { dispose(): void };
  }
  // The page part's exports.
  export interface UsagePageExports {
    sessionLinePart(id: string, log: (line: string) => void): UsageLinePart;
  }
  ```
- `export const usageTabLineManifest` in `src/plugins/usage-tab-line/manifest.ts` (id `usage-tab-line`)
- `export const usageTabLinePagePart: PagePart<typeof usageTabLineManifest>` in
  `src/plugins/usage-tab-line/page/start.ts`
- `createSessionLines(deps: SessionLinesDeps): SessionLines` in `src/plugins/usage/page/session-lines.ts`, deps gaining
  `id: string` and `nameOf(sessionId: string): string`
- in `src/plugins/usage/page/session-line-parts.ts`, the page's instance set:
  `export interface SessionLineParts { add(lines: SessionLines): void; redraw(): void; forget(sessionId: string): void }`
  `export function createSessionLineParts(): SessionLineParts`
  (`redraw` and `forget` reach every added instance, through the members `SessionLines` already has for them)

Decisions:
- **One source for the line's look: usage's layout.** The line stays usage's `sessionLine` layout part, and both
  surfaces draw it through usage's layout and kit. usage-tab-line owns no layout, no setting and no main part: it is a
  page-only plugin that places usage's line in each tab bar. Each plugin owning its layout was rejected: two layouts
  would hold one line's look, and a user restyling the line would edit two files. This differs from the docs written
  ahead, which give usage-tab-line a `layouts/` folder and an `usage-tab-line.layout` setting (AGENTS.md § Architecture
  plugin list; `docs/features/layouts/design.md` owner table); task 10 fixes those lines.
- **The export draws, it does not hand data.** `sessionLinePart(id, log)` returns a part with the given `id` that
  draws a session's line with usage's `UsageParts.sessionLine` into the wrapper its host hands it, and logs through
  `log`. Each call makes one `createSessionLines` instance and adds it to the page's `SessionLineParts` for the page's
  life: every redraw (each snapshot, each `sessions.activeChanged`, each layouts set, the minute tick) calls
  `parts.redraw()`, and `sessions.sessionRemoved` calls `parts.forget(sessionId)`.
- **usage's status part.** usage's page calls `chat.addStatusPart(sessionLinePart('usage.sessionLine', log))` once at
  start, through `api.dependency<ChatPageExports>('chat')`, in place of today's `sessions.addBarPart(lines.part)`.
  The page returns `exports: { sessionLinePart }`. The bar part id `usage-session-line` goes.
- **The tab-bar line is off by default, by intent.** Today the line draws in the tab bar of every session kind
  (connected, Form, Primer, preview). After this task, by default it draws only in a Chat tab's status line; a
  connected, Form or Primer session shows no usage line until the user turns usage-tab-line on. This follows the
  user's default `plugins.disabled` list (plan.md Design Overview). Measured at plan time: no self-test script waits on
  the old `[usage] session line <id>` text or the `usage-session-line` id outside usage's own script;
  `.session-bar-parts` appears in chat's and agents' scripts only as `scrollsItself` entries, which stay valid
  (re-verify with `grep -rn "session line\|usage-session-line\|session-bar-parts" src --include='selftest-script*.ts'`).
- **usage-tab-line's page part** calls
  `sessions.addBarPart(usage.sessionLinePart('usage-tab-line.sessionLine', (line) => services.log('usage-tab-line', line)))`
  and returns no commands. Manifest: `id: 'usage-tab-line'`, `dependsOn: ['usage', 'sessions']`, `commands: {}`,
  `scopes: {}`, `settings: {}`, `settingInfo: {}`, `themeTokens: {}`.
- **Same items, drop order and logging as today's bar part.** The input (`sessionLineInput`), the text
  (`sessionLineText`), the default layout's `sessionLine` and its CSS stay as they are: context meter and text, cache,
  spend; a narrow line drops spend, then cache, then the context text. A session with no usage draws no line. The log
  keeps its dedupe on the line's text, per session and per instance, but names the session by its side-bar label, as
  agents' lines do: `session line in <name>: <text>`, `<name>` the label from `sessions.sessionAdded`, read through
  `nameOf` when the line logs, the session id while none is known. A label change alone logs nothing new. usage's page hears `sessions.sessionAdded` for the names. Lines read `[usage] session line in <name>: …` and
  `[usage-tab-line] session line in <name>: …`. The name lets a self-test step wait for a chat-launched session's line,
  whose id it cannot know.
- **The drop needs room to shrink.** The line drops items only when its box is narrower than its content. usage's CSS
  keeps `.usage-session-line` as today and adds `min-width: 0`. Chat's wrappers pass the width down: task 05 gives
  `.chat-status-parts` `min-width: 0; flex: 0 1 auto` and `.chat-status-part` `display: flex; min-width: 0`. usage
  styles none of chat's classes.
- **Comments and copy.** usage's manifest comment and `layout` description say the session line draws in each Chat
  status line (description: `The layout that draws the status-bar plan line, each session's usage line and the usage details: a folder in the layouts/usage folder, or default.`
  stays word for word). `layout.d.ts` says `sessionLine` draws one session's line into the slot its host gives it: a
  Chat status line, or a tab bar while usage-tab-line is on. `usage.css`'s comment over `.usage-session-line` says
  "A session's line in its Chat status line or tab bar".
- **Self-test: a Chat session, not a connected one.** A status part draws only in a Chat tab, and a connected session
  has none. usage's script `open(run)` now: makes `<realPath(homeDir)>/usage-selftest` (as agents' script makes its
  project), calls `chat.closeSessionsIn(projectDir)` so the label stays `usage-selftest`, then
  `chat.launch({ projectDir, profile: 'work', message: { text: 'usage self-test', images: [] } })`, activates the new
  row, waits for the store to hold that session's usage (the fake turn's `usage` event), and only then seeds
  `usageFixture('fresh', now, sessionId)`. Seeding first would let the fake turn's own usage event overwrite the
  seed. The wait is a new script dep `sessionUsage(sessionId: string): Promise<void>` that `usage/main/start.ts` builds:
  it resolves at once when the snapshot holds an entry for the id whose `usage` is not null, else on the first `apply`
  after which it does. An entry with `usage: null` (the one `chat.sessionOpened` adds) does not count. `shownLine`
  becomes `[usage] session line in usage-selftest: context 180k/300k, cache 42m, spend $1.23`. Deps gain `homeDir`,
  `files: Pick<Files, 'makeFolder' | 'realPath'>`, `paths`, `chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>`
  and `sessionUsage`; `sessions` narrows to `Pick<SessionsMainExports, 'activate'>`. `problems` keep their checks.
- **Self-test groups.** `details` and `narrow` keep their keys, expects and screenshot names; the shown tab is now the
  run's Chat tab, so `details` and `status-line` show the Chat status line with the usage part, and the `narrow`
  group's `why` becomes `In a narrow window the status line wraps between its groups, the Chat status line's usage part drops whole items from its end, and the right bar lies over the content at its least width.`
  `scrollsItself` keeps `.session-bar-parts` and adds `.usage-session-line`, which clips its own overflow by design.
  The self-test starts every plugin (task 01), so usage-tab-line's page part runs there: the run's tab bar draws the
  same line, and the `checksFit` steps and screenshots see it in `.session-bar-parts`. usage-tab-line has no main part
  to hand a script, so usage's script proves it: the `details` group's first step gains `alsoExpect`
  `[usage-tab-line] session line in usage-selftest: context 180k/300k, cache 42m, spend $1.23` beside its expect.
- **LAYERS:** add `src/plugins/usage-tab-line` (`src/contracts`, `src/shared`) and `src/plugins/usage-tab-line/page`
  (`src/contracts`, `src/shared`, `src/plugins/usage-tab-line`, `src/plugins/usage/contract.ts`,
  `src/plugins/sessions/contract.ts`). Add `src/plugins/chat/contract.ts` to `src/plugins/usage/page`. Add
  `src/plugins/usage-tab-line` and its `page` to `src/plugins/page.ts`'s entry, and it to `src/plugins/manifests.ts`'s
  entry. `src/plugins/main.ts` gets no entry: the plugin has no main part.
- **Lists:** `usageTabLineManifest` right after `usageManifest` in `builtInManifests`; `usageTabLinePagePart` right
  after `usagePagePart` in `pageParts`.

GIVEN a Chat session whose last usage event reads 180k of a 300k limit, cache 42 minutes, spend $1.23 WHEN its Chat tab
shows THEN its status line holds the usage line and the log says
`[usage] session line in <name>: context 180k/300k, cache 42m, spend $1.23`.
GIVEN `plugins.disabled` lists usage-tab-line WHEN a session shows THEN its tab bar holds no usage line.
GIVEN usage-tab-line is on WHEN the snapshot changes THEN both the status line and the tab bar redraw the same line, and
each plugin logs its own line once.

Tests:
- `session-lines.test.ts`: every log assertion becomes `session line in <name>: <text>` through a `nameOf` fake; add
  row `build_UnknownName_LogsTheSessionId` (no name known → the id). Catches a log line a self-test cannot wait for.
- `session-lines.test.ts`: add `part_TakesTheGivenId` — `createSessionLines({ id: 'x', … }).part.id` is `x`. Catches
  two surfaces registering one id.
- `session-line-parts.test.ts` (new), `parts_$case` (it.each) over two `createSessionLines` instances with ids `a`
  and `b` and recording logs: one `redraw` redraws both, and each logs its line once through its own `log`;
  `forget('s1')` forgets s1 in both, so the next draw of s1 logs again in each. Catches a second surface that misses a
  redraw or keeps a removed session.
- `usage/main/start.test.ts`, new `sessionUsage_$case` (it.each): entry with `usage: null` → not resolved; then a
  `usage` event for the id → resolved; entry that already holds usage → resolved at once; another id's usage → not
  resolved. Catches the seed racing the fake turn's usage.
- `usage-tab-line/page/start.test.ts` (new): `start_AddsBarPartDrawnByUsage` — with fake usage and sessions exports,
  start adds one bar part whose id is `usage-tab-line.sessionLine`, built from `sessionLinePart` with a log that writes
  under `usage-tab-line`. Catches the tab line logging under usage or not registering.
- `selftest-script.test.ts`: `open_ConnectsActivatesAndSeedsTheRunSession` becomes
  `open_LaunchesActivatesAndSeedsAfterTheTurnsUsage`: the seed runs only after `sessionUsage` resolves (a deferred
  fake), after `closeSessionsIn` and `launch`; `shownLine` is the line above. Catches the seed racing the fake turn.

Done when: `npm run lint` passes; the tests above pass; usage's self-test groups `details` and `narrow` pass with the
Chat tab shown; no file in `src/plugins/usage/` calls `addBarPart`.
Commit: one commit for the group.

Runtime looks for task 11: the self-test screenshots `usage-details`, `usage-status-line`, `usage-details-narrow` and
`usage-status-line-narrow` show the usage part in the Chat status line and, narrow, dropping spend then cache; in a
drive run with `usage-tab-line` removed from `plugins.disabled`, each tab bar shows the same line, and the Form and
Primer tabs keep it.

## Proof

