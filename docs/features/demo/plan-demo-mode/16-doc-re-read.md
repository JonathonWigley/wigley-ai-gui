# 16 — Doc re-read against the landed code

Status: not started
Type: Task
Rung: standard · doc-only: prose checked against settled code
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15 (it reads every group's landed code)
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/docs/features/demo/design.md` · modify `wigley-ai-gui/AGENTS.md` · modify `wigley-ai-gui/docs/keymap.md`
Consumes:  every group's landed code, the names and exports the docs state ← 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15
Produces:  the three docs true to the code
Decisions: the docs were written ahead in `24dc9d312`; the branch never reached `main` before the code, so they carry no "planned" marks to drop
GIVEN the landed demo code WHEN each doc line about it is read against the code THEN every name, key, setting, default, section title, section order, file path and behaviour it states matches
Tests:     none: docs
Approach:  check line by line —
           `design.md`: keys and their effects; `demo.autoplaySeconds` and its default 5; the dwell rule; autoplay stopping before the real-session step; the section titles and order; the step file names (`page/demo-steps.ts`, `main/demo-steps.ts`); `demoSkip`; the demo harness id and profile; unlisted and ephemeral; the Demo section and `Space d h`; each "Real state stays untouched" bullet against its step's task; `runDisabledForNow`; the Live view step; the step agent's folder and its commands; the real-session prompt; what Stop removes.
           `AGENTS.md`: the Intent bullet "Every feature has a demo step"; the `demo/` entry in the plugin layout (each file and export it names); the `demo.run` slot entry names `realShown`; the demo self-test script entry; the manifest-field list (near line 564 at plan time) names `demoSkip`. Add each new export to the place in `AGENTS.md` that lists that module's exports, in that list's shape:
             - chat: `ephemeral` on `launch` and the `ephemeral` key on chat's event payloads (`sessionOpened`, `sessionClosed`, `sessionCleared`, `processEnded`)
             - sessions: `showOnly` (task 11 adds no recency export; it changes `session-recency.ts` behaviour only, which the sessions layout line need not name)
             - scoped-agents: the host-owned pane (`resizeTarget`, `entersFrom` null), `AgentPane.holdsKeys()`
             - settings: `openSectionById`, `SettingsView.returnToPlace`
             - chat: `showHubForNow` (03)
             - every export, channel method and exported helper in the Produces of tasks 09–15, each in the `AGENTS.md` line that lists its module. Read each task's Produces in full. Among them: unity-pool `showDemoStage`, app-update `showDemoStatus`, session-log `sampleRecentlyClosed`, session-stash `sampleStashRows` and `SessionStashDeps`, agents `sampleRoster` (now exported), live-view `demoStreamPick`, forms `confirmSample`, the shared `src/shared/agent-forms/demo-form.ts`, primer `DEMO_PRIMER_ARGS`, audio-picker `writeSampleSoundsIn`, docs `addSampleDocs`, `SAMPLE_HOME_FOLDER`, `SAMPLE_SOURCE_ID`, scheduling `DEMO_TASK_IDS`, workflow `sampleFlow` and `showSample`, workflow-large `SamplePlan` and `PREVIEW_PLAN`
             - core: `demoSteps`, `pluginSwitch.runDisabledForNow`, `MainServices.cloneDir`, `PluginStatus.demoSkip`, `AgentHarnessInfo.unlisted`, `listedHarnesses` (`src/shared/harness-profiles.ts`), `RightBarOptions.keepsTurn` (`src/contracts/plugin.ts`) and `RightBarStop.keepsTurn` (`src/renderer/pane-targets.ts`)
           Each plugin's layout line in `AGENTS.md` that gains a new part (auto-compact's and agent-commands' page parts, session-log's page part, usage-tab-line's main part) gets that part in its line. The `page/demo-steps.ts` and `main/demo-steps.ts` files every plugin gains may be covered by one general sentence in the Intent bullet instead of one per layout line.
           `docs/keymap.md`: the `d` row against `src/plugins/keymap.ts`, and a line for the Demo panel's keys in scope `demo.panel` (`j`, `k`, `<CR>`, `i`).
Done when: every stale line is fixed; `npm run lint` passes (the docs' formatter included)
Commit:    one commit for the doc fixes

## Proof
