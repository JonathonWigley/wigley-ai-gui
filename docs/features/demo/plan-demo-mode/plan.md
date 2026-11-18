# Demo mode — plan

Feature: demo · Implements: none · Ticket: none
Target: `main` of the `ai` repo (landed from worktree branch `demo-mode`, `~/wigley-agents/WigleyRepos.md` § Landing) · Written: 2026-11-18

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A `demo` plugin that walks through every user-facing feature of wigley-ai-gui in rapid succession,
inside the everyday app, for showing the app to the user's team and for trying any one feature
without building a real case. Every built-in plugin registers its own demo steps (or declares why
it has none), so a new feature lands with its demo. A Demo panel in the right bar holds the step
list over a per-step real Claude conversation for iterating on the feature on screen; a caption
runs along the bottom; the leader `d` keys drive it, with autoplay. Steps run on a scripted demo
harness and sample data, and touch none of the user's real state; one optional last step starts a
real Claude session.

The user's ask names a sample ("unity pool, screen share, audio picker, workflows, sessions
status, wrapups, etc."): the plan covers every built-in plugin — 41 measured at plan time,
re-verify with `find wigley-ai-gui/src/plugins -mindepth 1 -maxdepth 1 -type d | wc -l` — through
the coverage table under File Structure.

## Architecture

Systems touched, all in `wigley-ai-gui/`:

- **Core** (`src/contracts/`, `src/main/`, `src/renderer/`, `src/shared/`): a new demo-step
  registry service in both processes; an optional manifest field `demoSkip`; the plugin switch's
  in-memory start of disabled plugins; an `unlisted` flag on agent harness info.
- **chat**: an `ephemeral` launch that saves nothing.
- **sessions**: a page export that shows one side-bar section alone.
- **scoped-agents**: an agent pane whose host owns resizing and pane moves (the right bar).
- **usage, scheduling**: skip unlisted harness profiles.
- **demo** (new plugin): the run (main), the panel, caption, side-bar section and keys (page), its
  layouts, its self-test script with the coverage check, the real-session step.
- **Every other built-in plugin**: a `page/demo-steps.ts` (and `main/demo-steps.ts` where sample
  data lives in main) registering its steps, or a `demoSkip` in its manifest; safety changes in
  auto-retro, scheduling, unity-pool, chatroom, forms, app-update, notes, docs, backlog, practice and workflow (main's flow guard) so their steps
  never reach real state.

## Preconditions

Run from `/Users/jonathonwigley/Documents/.worktrees/ai-demo-mode` (worktree of the `ai` repo,
branch `demo-mode`):

| Claim | Command | Result at plan time |
|---|---|---|
| The branch holds the docs written ahead on top of `main` | `git log --oneline -2` | `24dc9d312` docs ahead, over `da5a5199a` |
| `<Leader>d` is unbound and has no which-key group | `grep -c "Leader>d" wigley-ai-gui/src/plugins/keymap.ts` | `0` |
| No `demoSteps` or `demoSkip` exists yet | `grep -rn "demoSteps\|demoSkip" wigley-ai-gui/src \| wc -l` | `0` |
| A plugin main part registers a harness at runtime | `sed -n 54p wigley-ai-gui/src/plugins/claude-code/main/start.ts` | `services.agentHarnesses.register(harness)` |
| Built-in plugin folders (measured at plan time, re-verify) | `find wigley-ai-gui/src/plugins -mindepth 1 -maxdepth 1 -type d \| wc -l` | `41` |
| Anchors the contract edits land beside | `grep -n "interface PageServices\|interface MainServices\|interface PluginSwitchService" wigley-ai-gui/src/contracts/plugin.ts; grep -n "interface AgentHarnessInfo\|interface AgentProcessEvents" wigley-ai-gui/src/contracts/agent.ts` | `716`, `1128`, `1168`; `553`, `420` |

## Docs written ahead

Commit `24dc9d312`:

- `wigley-ai-gui/docs/features/demo/design.md` — the design.
- `wigley-ai-gui/AGENTS.md` — Intent bullet "Every feature has a demo step"; the `demo/` entry in
  the plugin layout; the demo self-test script in the self-test list.
- `wigley-ai-gui/docs/keymap.md` — the `d` row of Leader groups.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` (through its last line)
- `wigley-ai-gui/DESIGN.md`
- `wigley-ai-gui/docs/keymap.md`
- `wigley-ai-gui/docs/features/demo/design.md`
- `wigley-ai-gui/docs/features/layouts/design.md` (a new view ships its layout contract and `default`)
- `wigley-ai-gui/.agents/skills/drive/SKILL.md` (for tasks that check a step in a drive run)

No `CLAUDE*.md` or `.claude/rules/` exists in `wigley-ai-gui/`.

## Design Overview

```
                 ┌──────────────── core ────────────────┐
 plugin X page ──┤ services.demoSteps (page registry)   ├──► demo page: panel, caption,
 page/demo-steps │   DemoStep {enter → DemoStage beats} │     autoplay, Space d commands,
                 │                                      │     Demo section + showOnly
 plugin X main ──┤ services.demoSteps (main registry)   ├──► demo main: run, scratch dir,
 main/demo-steps │   DemoMainStep {enter → sessions}    │     demo harness, launchSession,
                 │ services.pluginSwitch.runDisabledForNow   step agents, real session
                 └──────────────────────────────────────┘
 demo page ──channel──► demo main: enter step S → main half (if any) → {sessions}
                         ◄── sessions ─── page half enter(context{sessions}) → beats
 demo main ── chat.launch({profile:'demo', ephemeral:true, projectDir: scratch}) ──► demo harness (unlisted fake)
 demo page ── sessions.addSection('demo' claims harness==='demo') + showOnly('demo')
 demo page ── scoped-agents addAgentPane(host-owned) in the right-bar panel; scope = step id
```

**Run lifecycle.** The page drives the run; main serves what lives in main.

1. Start (first `demo.togglePanel`): main registers the demo harness, makes the scratch folder,
   calls `runDisabledForNow`; page adds the Demo section and holds `showOnly`, contributes the
   panel and caption, enters the first step.
2. Enter step S: page asks main to enter S's main half, if one is registered (it gets the
   sessions map back, `{}` when none); page calls S's page half `enter(context)`, holds the
   `DemoStage`, shows beat 0.
3. Next/previous: within the stage's beats, then leave S (dispose page stage, then main stage,
   then main closes every session in the main stage's `sessions` map; steps never close their
   own) and enter the neighbour. Previous from beat 0 enters the previous step at its last beat.
4. Reset: leave S and enter S again at beat 0.
5. Stop: leave S; close every demo session (`closeSessionsIn(scratchDir)`) and the real-session
   step's session; dispose the plugin-switch hold, the demo harness, `showOnly`, the section,
   the panel and the caption; publish `running: false`.

**Decisions** (interview rounds 1–2 and the design review):

- Runs inside the everyday app; the Demo panel is a right-bar contribution, on screen in every mode (round 2).
- Step by key plus autoplay; `demo.autoplaySeconds` default 5 per beat; a beat's `dwellSeconds` lengthens it: dwell = max(setting, beat's). Autoplay stops before the real-session step (round 1, design review).
- Scripted demo sessions for every step; one optional last step starts a real Claude session (round 1).
- Caption bar only, one high-level caption per step, no highlight ring, no per-element callouts (round 1).
- Each plugin registers its own steps; a self-test check fails on a plugin with no step and no skip reason (round 1). The rule covers every built-in plugin, not a guessed "user-facing" subset: a plugin with nothing to show declares `demoSkip` (design review).
- One step-agent conversation per step, a real Claude session in the app's own clone; it can drive the demo through agent-commands (round 2).
- Keys: `Space d d/n/p/a/r/h/x`, bound in every scope (round 2).
- Real sessions hidden while the demo runs; `Space d h` shows them again (round 2).
- Off-by-default plugins start in memory through the plugin switch, never writing settings.json (round 2).
- The step registry is core (`services.demoSteps`), following `services.agentHarnesses`: no plugin depends on `demo` (design review).
- A step's main half and page half share one id; the page half receives the main half's sessions by key (design review).
- The demo harness is the fake harness under its own identity `{ id: 'demo', profile 'demo' }`, flagged `unlisted`; readers that offer or poll profiles skip it; chat's launch still resolves it (seams map).
- Demo sessions launch `ephemeral`: no `open-sessions.json` row, no recent folder (seams map).
- Steps build their own samples and do not reuse the layout previews' commands (seams map: forms' preview cycles saved rounds; previews have no uniform close).
- The step agent's folder is `services.cloneDir`: the installed app's clone, or in the dev app the repo the dev app runs from (design review).
- No demo command is `risky`: a risky confirm cannot show for the step agent's owner row (lead ruling).
- Step agents persist across runs; Stop leaves them (design review).
- Real-session step prompt, verbatim: `Say hello to the team in one short sentence.`

**Out of scope:** a demo outside the app or in its own window; recording or exporting a demo
video; steps for user-folder plugins (they may register steps; the coverage check covers built-ins
only).

## File Structure

### Shared names (every part uses these word for word)

**`wigley-ai-gui/src/contracts/demo.ts`** (new, task 01):

```ts
export const DEMO_HARNESS_ID = 'demo';
export const DEMO_PROFILE = 'demo';

export type DemoSection = 'shell' | 'sessions' | 'forms' | 'workflows' | 'modes' | 'bars' | 'live';
// Panel order and titles.
export const DEMO_SECTIONS: readonly { id: DemoSection; title: string }[];
//   shell 'Shell' · sessions 'Sessions and chat' · forms 'Agent forms' · workflows 'Workflows'
//   · modes 'Modes' · bars 'Bars' · live 'Live'

export interface DemoBeat {
  name: string;               // short, shown under the step in the panel
  dwellSeconds?: number;      // autoplay dwell = max(demo.autoplaySeconds, dwellSeconds)
  // Sets this beat's whole state, so it may run right after `enter` without the beats before it
  // (previous from beat 0 shows the last beat at once).
  show(): void | Promise<void>;
}
export interface DemoStage extends Disposable { beats: readonly DemoBeat[] } // ≥ 1 beat

// Page half.
export interface DemoStep {
  id: string;                 // `<plugin id>.<name>`; one id per step across both processes
  section: DemoSection;
  order: number;              // within its section, ascending
  title: string;
  caption: string;            // one high-level line for the whole step
  files: readonly string[];   // repo-relative paths (`src/plugins/…`) the step agent is told about
  enter(context: DemoPageContext): Promise<DemoStage>;
}
export interface DemoPageContext {
  scratchDir: string;
  sessions: Readonly<Record<string, string>>; // the main half's sessions by its keys; {} when none
}

// Main half (optional), same id as its page half.
export interface DemoMainStep {
  id: string;
  enter(context: DemoMainContext): Promise<DemoMainStage>;
}
export interface DemoMainStage extends Disposable {
  sessions: Readonly<Record<string, string>>; // key → chat session id
}
export interface DemoMainContext {
  scratchDir: string;
  // A demo session: chat.launch on DEMO_PROFILE, ephemeral, in scratchDir; `text` is the first
  // user message (a fake trigger such as `fake: tool`, or plain text). Resolves to the session id.
  launchSession(text: string): Promise<string>;
  // The fake process events of a demo session this run launched; throws for any other id.
  processEvents(sessionId: string): AgentProcessEvents;   // from contracts/agent.ts
}

export interface DemoStepRegistry<S extends { id: string }> {
  register(step: S): Disposable;  // throws on a duplicate id, or an id not prefixed `<plugin id>.`
  list(): readonly S[];
  onChanged(listener: () => void): Disposable;
}
```

**Core service fields** (task 01): `PageServices.demoSteps: DemoStepRegistry<DemoStep>` and
`MainServices.demoSteps: DemoStepRegistry<DemoMainStep>`, per plugin like
`services.agentHarnesses` (stopping a plugin disposes its registrations; the prefix check uses the
registering plugin's id). `MainServices.cloneDir: string | null` — the clone the app runs from
(main's `inputs.repoDir`, `WIGLEY_CLONE_DIR`); task 06 uses it for the step agent's folder.

**Plugin status** (task 01): `PluginStatus.demoSkip: string | null` on the `core.plugins` slot
(`src/contracts/core-state.ts`), the manifest's `demoSkip` or null; task 08's coverage check reads
built-ins and their skips from it.

**Manifest field** (task 01): `PluginManifest.demoSkip?: string` — one sentence on why the plugin
has no demo step.

**Plugin switch** (task 01): `PluginSwitchService.runDisabledForNow(): Promise<Disposable>` —
starts every built-in plugin the applied list holds disabled, in memory, never writing
settings.json; `dispose` re-applies the config's `plugins.disabled`.

**Harness flag** (task 02): `AgentHarnessInfo.unlisted?: true`; `FakeHarnessIdentity.unlisted?: true`
carried into the fake's info.

**Chat** (task 03): `LaunchRequest.ephemeral?: true`. `ChatPageExports.showHubForNow(sectionId: string): Disposable` —
shows the session hub and expands side part `sectionId`'s section until the dispose, writing no
uiState; holds stack; task 12's hub steps hold it.

**Sessions** (task 04): `SessionsPageExports.showOnly(sectionId: string): Disposable`.

**Scoped agents** (task 05): `AgentPaneSpec.resizeTarget: ResizeTarget | null` and
`AgentPaneSpec.entersFrom: PaneDirection | null`; null = the host owns resizing and pane moves.
`AgentPane.holdsKeys(): boolean`; a host-owned pane is `isAlwaysShown: true`. Core:
`RightBarOptions.keepsTurn?(): boolean` keeps a right-bar stop's turn through base scope changes
while it returns true.

**Demo plugin** (task 06): `src/plugins/demo/contract.ts` exports
`demoRunSlot` (`demo.run`): `{ running: boolean; stepId: string | null; beat: number; autoplay: boolean; realShown: boolean }`.
Page commands declared in `src/plugins/demo/manifest.ts`: `demo.togglePanel`, `demo.next`,
`demo.previous`, `demo.goTo` (arg: step id string), `demo.autoplay`, `demo.reset`,
`demo.showReal`, `demo.stop`. Settings: `{ layout: 'default', autoplaySeconds: 5 }`. The demo's
own step `demo.realSession` (section `live`, last).

Demo-internal names (tasks 06–08; no other plugin uses them): in `src/plugins/demo/contract.ts`
`DemoRunState` (the `demo.run` value), `REAL_SESSION_STEP_ID` (`'demo.realSession'`),
`STEP_AGENT_ID` (`'step'`), `DemoStepBrief`, `DemoChannel`, `DemoRunReport` (task 08); scope
`demo.panel` (`In the Demo panel`) with the panel commands `demo.cursorDown` (`j`), `demo.cursorUp`
(`k`), `demo.goToCursor` (`<CR>`) and `demo.askAgent` (`i`). No demo command is `risky`.

### Per-plugin step files (reference pattern for tasks 09–15)

Each plugin with a step:

- create `src/plugins/<id>/page/demo-steps.ts` — `export function registerDemoSteps(services: PageServices, …deps): Disposable`, registering each `DemoStep`; called from the plugin's `page/start.ts`, its Disposable filed in the part's registrations
- create `src/plugins/<id>/main/demo-steps.ts` only when sample data lives in main, registering each `DemoMainStep` the same way from `main/start.ts`
- a step's samples and their actions never read or write the user's real state (design.md § Real state stays untouched)

Each plugin with no step: `demoSkip` in its `manifest.ts`.

### Coverage table

| Task | Section | Plugins with steps | Plugins with `demoSkip` |
|---|---|---|---|
| 09 | shell | keys, gallery, settings | window, markdown-blocks, claude-code, scoped-agents |
| 10 | bars | unity-pool, system-stats, app-update, auto-retro | — |
| 11 | sessions | sessions, chat, agent-strip, agents, agent-lines, visual, auto-compact | — |
| 12 | sessions, live | session-log, session-stash, agent-skills, context-sources, usage, usage-tab-line; live-view (live) | — |
| 13 | forms | forms, primer, audio-picker, agent-commands, notes | — |
| 14 | workflows | workflow, workflow-small, workflow-medium, workflow-spike, workflow-large | — |
| 15 | modes | docs, backlog, practice, scheduling, chatroom | docs-session-tab (its tab shows in docs' `docs.sessionTab` step) |
| 06/07 | live | demo (`demo.realSession`) | — |

### Files by task

Every task document writes its Files paths from the `ai` repo root (`wigley-ai-gui/src/…`); the
summary below shortens them to `src/…`, under `wigley-ai-gui/`.

- 01 creates `src/contracts/demo.ts` and `src/shared/demo-step-registry.ts`; modifies `src/contracts/plugin.ts` (`demoSteps`, `demoSkip`, `runDisabledForNow`, `MainServices.cloneDir`), `src/contracts/core-state.ts` (`PluginStatus.demoSkip`), `src/shared/define-plugin.ts`, `src/shared/plugin-catalog/validate-manifest.ts`, `src/shared/plugin-catalog/manifest-schema.ts`, `src/main/plugins/plugin-switch.ts`, `src/main/plugins/main-api.ts`, `src/main/main.ts`, `src/renderer/renderer.ts`, `src/renderer/plugins/page-api.ts`, `src/shared/plugin-part-harness.test-support.ts`.
- 02 modifies `src/contracts/agent.ts`, `src/shared/fake-agent-harness.ts`, `src/shared/harness-profiles.ts`, and the profile readers in chat, usage, scheduling and docs.
- 03 modifies `src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/page/side-sections.ts` and `src/plugins/chat/page/start.ts` (the `showHubForNow` export), and session-log's and session-stash's main.
- 04 modifies `src/plugins/sessions/contract.ts` and the sessions page.
- 05 modifies `src/plugins/scoped-agents/contract.ts`, `src/plugins/scoped-agents/page/agent-pane.ts`, `src/renderer/pane-targets.ts`, `src/renderer/shell/shell.ts`, and one comment in `src/contracts/plugin.ts` (after 01).
- 06 creates `src/plugins/demo/{manifest.ts,contract.ts,main/}`; modifies `src/plugins/manifests.ts` and `src/plugins/main.ts` (the demo manifest and main part).
- 07 creates `src/plugins/demo/{page/,layouts/}`; modifies `src/plugins/page.ts` and `src/plugins/main.ts` (the demo page part and every new part tasks 11–13 create: `autoCompactPagePart`, `sessionLogPagePart`, `usageTabLineMainPart`, `agentCommandsPagePart`), `src/plugins/keymap.ts`.
- 08 creates `src/plugins/demo/main/selftest-script.ts` and `src/plugins/demo/page/coverage.ts`; modifies the demo plugin's contract and parts.
- 11 also modifies sessions' `page/session-recency.ts` and `page/pane-sessions.ts` (demo rows never stamped or saved), with their tests.
- 09–15 each touch only the plugin folders in their coverage-table row, except `src/shared/agent-forms/demo-form.ts` and `src/shared/page/demo-form-wait.ts` (13) and `src/shared/page/demo-start-prompt.ts` (12), each with its test; none edits `src/plugins/main.ts`, `page.ts` or `manifests.ts` (07 lists their new parts).

Boundary rules: no plugin imports `src/plugins/demo/`; plugins reach demo only through core
`services.demoSteps` and `src/contracts/demo.ts`. Safety readers detect demo rows by
`row.harness === DEMO_HARNESS_ID`. A listener of chat's session events (`sessionClosed`,
`sessionCleared`) checks the event's `ephemeral` key (03) instead, because a user close removes
the row before chat fires `sessionClosed`; agents' log skip remembers demo ids it saw, for the
same reason (11). `npm run lint` (layer and style checks) passes after every task, with one known
failure: `scripts/check-layers.mts`' composition-root check fails on the parts 11, 12 and 13
create (`autoCompactPagePart`, `sessionLogPagePart`, `usageTabLineMainPart`, the agent-commands
page part) from when each lands until 07 lists them in Wave 3. Those tasks' gates and the Wave 2
gate record that failure as known and pass on the rest; from 07 on, lint passes whole.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 06 → 07 → 08 → 16 → 17

### Wave 1
- [x] [Core demo registry, demoSkip, in-memory plugin start](01-core-demo-registry.md)
- [x] [Unlisted harness](02-unlisted-harness.md)
- [x] [Ephemeral chat launch](03-ephemeral-launch.md)
- [x] [Sessions showOnly](04-sessions-show-only.md)

### Wave 2
- [x] [Host-owned agent pane](05-host-owned-agent-pane.md) — after 01
- [x] [Demo main](06-demo-main.md) — after 01, 02, 03
- [x] [Shell steps and skips](09-shell-steps.md) — after 01
- [x] [Bar steps](10-bar-steps.md) — after 01, 03, 04
- [x] [Session card and chat steps](11-session-chat-steps.md) — after 01, 02, 03, 04
- [x] [Session extras steps](12-session-extras-steps.md) — after 01, 02, 03
- [x] [Agent forms steps](13-forms-steps.md) — after 01
- [x] [Workflow steps](14-workflow-steps.md) — after 01
- [x] [Mode steps](15-mode-steps.md) — after 01, 02

### Wave 3
- [x] [Demo page](07-demo-page.md) — after 04, 05, 06, 11, 12, 13

### Wave 4
- [ ] [Demo self-test and coverage check](08-demo-selftest.md) — after 06, 07, 09–15

### Wave 5
- [ ] [Doc re-read](16-doc-re-read.md)

### Wave 6
- [ ] [Final verification](17-final-verification.md) — after 16

## Run log

Review base: 7811ca8a2

### Groups
- 01 · deep · 42b096917 · diff read against Shared names; Wave 1 typecheck and lint pass (edb28c428 formats) · concerns: oxlint no-useless-spread warning on the listener copy in demo-step-registry.ts (kept: a listener may dispose mid-notify); AGENTS.md § A slot, § A disabled plugin, § An ambient service do not name demoSkip, runDisabledForNow, demoSteps, cloneDir (task 16)
- 02 · hard · 960bf7621 · diff read against Shared names; Wave 1 typecheck and lint pass (edb28c428 formats) · concerns: sessions/main/start.ts and notes/main/start.ts read registeredInfos for label lookups only, left unfiltered; fake harness's literal true typechecked
- 03 · deep · 81ef5cb02 · diff read against Shared names; Wave 1 typecheck and lint pass (edb28c428 formats) · concerns: docs/features/agent-chat/design.md § Saved sessions now stale (every session saved); workflow main's chat.sessionOpened handler still opens a flow for demo rows; chat tests lean on the fake's host-id numbering
- 04 · hard · ab83ff6ed · diff read against Shared names; Wave 1 typecheck and lint pass (edb28c428 formats) · concerns: AGENTS.md's sessions entry does not name showOnly (task 16); the start test sorts claimed ids
- 05 · deep · 06db26107 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: send test checks activeElement at mountChat instead of a focusout (fake DOM has none); holdsKeys added to three AgentPane fakes outside Files; host-owned toggle reads the session twice; stale docs: followups.md:659-668 line cites, scoped-agents/design.md:104-107, AGENTS.md:701 lacks keepsTurn (task 16)
- 06 · deep · 720cf9f14 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: createStepAgentStore copies backlog's createAssistantStore (shared store a follow-up); isRunning is false from a stop's first await
- 09 · hard · 7253d0055 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: gallery transparency checked through toggleTransparency logs, a user override before enter not covered; keys test table rows each carry their own act; returnToPlace row leans on the keymap row key p.saveAll
- 11 · deep · a9815561f · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: picker has close() not cancel; folder step's last row is Choose folder…; auto-compact idle waits have no timeout; page halves read sessions[key] unchecked; visual full-size beat after activate needs the live check (17); agents/visual page tests now fake sessionsPageKey
- 10 · deep · 870ee86ed · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: a stage dispose after a part stop writes to a stopped slot (unity-pool, system-stats, auto-retro not reset at stop); auto-retro keeps the demo row until its queue loads; unity-pool test refactor writeSelfTestPool
- 12 · deep · 9ffeb6167 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: start prompt isOpen reads scope chat.picker, may misread under chat.resume or filter focus (live check 17); live-view reads process.pid directly; Unity title regex; three plugins' page tests reach sessionsPageKey
- 13 · deep · 9d1103678 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: forms/main/demo-steps.test.ts fails 3 tests (no rounds shown; finding origin caused already registered) — for the test gate; popup.ts open() reorder; sample fields stay in the popup store after dispose; cacheImages race; six demo-steps tests needed check-layers entries (8ac2f4304)
- 14 · deep · c0b932931 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: workflow main's guard checks the profile, so a user profile named demo gets no flow; leadingDone copied into 3 tests; level page tests fake workflowPageKey without showSample; workflow-large-main.test.ts edited outside Files
- 15 · deep · 1a22ef0a0 · diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07); one commit per plugin 3d34d2205..1a22ef0a0 · concerns: board feed claims still read the real room during a hold; a real message for the scratch project's room rewrites from the demo service; docs sample split writes the sessionTree width; backlog sample row selections write the backlog place slot; a resumed demo task's nextRun counts from show time; no part disposes its registrations in dispose (the per-plugin view does)
- 07 · deep · 41780f05a · diff read (composition entries, keymap binds, layouts register); typecheck and lint clean; demo tests 77 pass after the panel test moved to installFocusFakeDom · concerns: test areas spread over the fake API may drop a getter-backed member; two tests wait with a real setTimeout(0); blur on a mode change while the step agent holds the keys has no test (live check)
### Contract changes
- 11: main registerDemoSteps of sessions, agent-strip, agent-lines and visual take no deps; agents/main/preview.ts exports sampleRoster; chat page fillComposerOf and setHeadless are locals
- 12: session-extras main registerDemoSteps take no deps where none are needed; SessionStashDeps gains isDemoRunning() and sampleProjectDir; new shared/page/demo-start-prompt.ts (demoStartPrompt); new parts sessionLogPagePart and usageTabLineMainPart for 07
- 10: unity-pool channel showDemoStage(stage) with DemoPoolStage; app-update AppUpdateChannel.invoke.showDemoStatus(kind) with DemoUpdateKind
- 13: shared/agent-forms/demo-form.ts (openSampleForm, sampleFormOwner) and shared/page/demo-form-wait.ts; FormsMainExports.confirmSample; agent-commands exports confirmRequest and gains agentCommandsPagePart (07 lists it); audio-picker exports SAMPLE_SOUNDS and writeSampleSoundsIn; NotePopup.showSample; notes main registerDemoSteps takes no deps
- 14: workflow/contract.ts gains sampleFlow, sampleChecklist, createSampleSequence, sampleSessionStep and WorkflowPageExports.showSample; workflow-large previewFlow takes the plan (default PREVIEW_PLAN)
- 15: createDemoRooms takes DemoRoomsDeps (adds rewriteRoom, released); seedChatroomFixture deps take launch(title) and roomFor(name); ChatroomSelfTestDeps takes fixtureDeps(projectDir); docs exports addSampleDocs, SAMPLE_HOME_FOLDER, SAMPLE_SOURCE_ID, NO_INDEX_MESSAGE; scheduling contract DEMO_TASK_IDS
### Rulings
- 01: runDisabledForNow counts a hold from its call's start and releases it if the apply rejects, so a hold disposed while a second call applies does not switch off what that call starts — literal reading had the race; cost if wrong: none for the cases the plan names · group 01
- 03: prepareLaunch rejects ephemeral before its other checks; toggleHidden still logs the user's uiState choice during a hold · group 03
- 05: host recipe lives in the AgentPaneSpec comment; keepFocusInPane runs for every pane, Practice and Backlog included · group 05 · group 05
- 06: leaveStep closes a stage's sessions in the map's own key order; stop sets the run not-live before teardown · group 06 · group 06
- 09: the keys stage closes only what it opened, so help the user had open stays open · group 09 · group 09
- 11: start-prompt sample check is profile demo alone; agents demoSessionIds never pruned (one id per demo session) · group 11 · group 11
- 10: the app-update seed goes through updaterStatus; install skipped during the demo · group 10 · group 10
- 15: scheduling's channel refuses save, run and remove of any DEMO_TASK_IDS id, and pauses a shown one in memory · group 15 · group 15
- 15: chatroom release rebuilds through the room's chain, deleting the view key only when no saved room has the name · group 15 · group 15
- 16 runs alongside 08 rather than after it, to meet the user's 3:00 deadline: 16 documents 08's self-test from its task document, and the review checks the prose against 08's landed code
### Review rounds
### Test gate
