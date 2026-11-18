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
  auto-retro, scheduling, unity-pool, chatroom, forms, app-update, notes and docs so their steps
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

**Chat** (task 03): `LaunchRequest.ephemeral?: true`.

**Sessions** (task 04): `SessionsPageExports.showOnly(sectionId: string): Disposable`.

**Scoped agents** (task 05): `AgentPaneSpec.resizeTarget: ResizeTarget | null` and
`AgentPaneSpec.entersFrom: PaneDirection | null`; null = the host owns resizing and pane moves.

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
- 03 modifies `src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts`, and session-log's and session-stash's main.
- 04 modifies `src/plugins/sessions/contract.ts` and the sessions page.
- 05 modifies `src/plugins/scoped-agents/contract.ts`, `src/plugins/scoped-agents/page/agent-pane.ts`, `src/renderer/pane-targets.ts`, `src/renderer/shell/shell.ts`, and one comment in `src/contracts/plugin.ts` (after 01).
- 06 creates `src/plugins/demo/{manifest.ts,contract.ts,main/}`; modifies `src/plugins/manifests.ts` and `src/plugins/main.ts` (the demo manifest and main part).
- 07 creates `src/plugins/demo/{page/,layouts/}`; modifies `src/plugins/page.ts` and `src/plugins/main.ts` (the demo page part and every new part tasks 11–13 create: `autoCompactPagePart`, `sessionLogPagePart`, `usageTabLineMainPart`, `agentCommandsPagePart`), `src/plugins/keymap.ts`.
- 08 creates `src/plugins/demo/main/selftest-script.ts` and `src/plugins/demo/page/coverage.ts`; modifies the demo plugin's contract and parts.
- 11 also modifies sessions' `page/session-recency.ts` and `page/pane-sessions.ts` (demo rows never stamped or saved), with their tests.
- 09–15 each touch only the plugin folders in their coverage-table row; none edits `src/plugins/main.ts`, `page.ts` or `manifests.ts` (07 lists their new parts).

Boundary rules: no plugin imports `src/plugins/demo/`; plugins reach demo only through core
`services.demoSteps` and `src/contracts/demo.ts`. Safety readers detect demo rows by
`row.harness === DEMO_HARNESS_ID`. `npm run lint` (layer and style checks) passes after every task, with one known
failure: `scripts/check-layers.mts`' composition-root check fails on the parts 11, 12 and 13
create (`autoCompactPagePart`, `sessionLogPagePart`, `usageTabLineMainPart`, the agent-commands
page part) from when each lands until 07 lists them in Wave 3. Those tasks' gates and the Wave 2
gate record that failure as known and pass on the rest; from 07 on, lint passes whole.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 06 → 07 → 08 → 16 → 17

### Wave 1
- [ ] [Core demo registry, demoSkip, in-memory plugin start](01-core-demo-registry.md)
- [ ] [Unlisted harness](02-unlisted-harness.md)
- [ ] [Ephemeral chat launch](03-ephemeral-launch.md)
- [ ] [Sessions showOnly](04-sessions-show-only.md)

### Wave 2
- [ ] [Host-owned agent pane](05-host-owned-agent-pane.md) — after 01
- [ ] [Demo main](06-demo-main.md) — after 01, 02, 03
- [ ] [Shell steps and skips](09-shell-steps.md) — after 01
- [ ] [Bar steps](10-bar-steps.md) — after 01, 04
- [ ] [Session card and chat steps](11-session-chat-steps.md) — after 01, 02, 04
- [ ] [Session extras steps](12-session-extras-steps.md) — after 01, 02, 03
- [ ] [Agent forms steps](13-forms-steps.md) — after 01
- [ ] [Workflow steps](14-workflow-steps.md) — after 01
- [ ] [Mode steps](15-mode-steps.md) — after 01, 02

### Wave 3
- [ ] [Demo page](07-demo-page.md) — after 04, 05, 06, 11, 12, 13

### Wave 4
- [ ] [Demo self-test and coverage check](08-demo-selftest.md) — after 06, 07, 09–15

### Wave 5
- [ ] [Doc re-read](16-doc-re-read.md)

### Wave 6
- [ ] [Final verification](17-final-verification.md) — after 16

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
