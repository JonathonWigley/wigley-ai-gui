# 02 — Engine: workflows on the page

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/workflow/page/layout/workflow-draw.ts` · `src/plugins/workflow/page/preview-steps.ts` · `src/plugins/workflow/stages/heavy-page-workflow.ts`
- modify `src/plugins/workflow/contract.ts` · `src/plugins/workflow/manifest.ts`
- modify `src/plugins/workflow/page/start.ts` · `src/plugins/workflow/page/workflow-view.ts` · `src/plugins/workflow/page/preview.ts` · `src/plugins/workflow/page/workflow.css` · `src/plugins/workflow/page/layout/workflow-kit.ts` · `src/plugins/workflow/page/layout/workflow-parts.ts`
- modify `src/plugins/workflow/stages/stage-parts.ts` · `src/plugins/workflow/stages/{plan-ready,closed}/page.ts`
- modify `src/plugins/workflow/layouts/layout.d.ts` · `src/plugins/workflow/layouts/default/layout.js`
- modify `scripts/check-layers.mts`
- test: create `src/plugins/workflow/page/layout/workflow-draw.test.ts` · `src/plugins/workflow/page/preview-steps.test.ts` · `src/plugins/workflow/stages/heavy-page-workflow.test.ts`
- test: modify `src/plugins/workflow/page/{start,workflow-view,preview}.test.ts` · `src/plugins/workflow/layouts/default/layout.test.ts` · `src/plugins/workflow/stages/page-stages.test.ts`

Consumes:
- `SessionFlow`, `WorkflowId`, `ChecklistItem` ← 01
- `heavyStateOf`, `HEAVY_WORKFLOW_ID` in `src/plugins/workflow/stages/heavy-contract.ts` ← 01
- `createLayoutParts` in `src/shared/page/layout-host/layout-parts.ts`, `ownerBaseKitDeps` in `src/shared/page/layout-host/base-kit.ts`, `qualify` in `src/shared/plugin-manifests.ts`, `tag` in `src/shared/page/ui/tag.ts`, `ShowLayoutOptions` and `PageApi` in `src/contracts/plugin.ts` (tree members)
- `BUILT_IN_PAGE_STAGES` in `src/plugins/workflow/stages/index.ts`, `readWorkflowLayout` in `src/plugins/workflow/page/layout/read-workflow-layout.ts`, `countdownText` in `src/plugins/workflow/page/countdown.ts`, `ChatPageExports.addSidePart` and `ChatSidePart` in `src/plugins/chat/contract.ts` (tree members)

Produces:

In `src/plugins/workflow/contract.ts`, word for word from plan.md: `ChecklistGroup`, `ChecklistView`. Plan.md's `PageWorkflow` and `WorkflowPageExports` with the members added for task 05, and the names plan.md uses and does not define:

```ts
export interface PageWorkflow {
  id: WorkflowId;
  label: string;
  badge: string;
  stages: readonly PageStage[];
  draw: WorkflowDraw;
  checklist?(flow: SessionFlow): ChecklistView | null;
  runAction(sessionId: string, command: string): Promise<void>;
  countdownText?(flow: SessionFlow, now: number): string | null;
  progressText?(flow: SessionFlow): string | null;
  hasPlan?(flow: SessionFlow): boolean;     // left out: checklist(flow) !== null
  previewFlows?(sessionId: string, now: number): readonly SessionFlow[];
}
export interface WorkflowPageExports {
  addWorkflow(workflow: PageWorkflow): Disposable;
  createWorkflowDraw(api: PagePluginApi, options: WorkflowDrawOptions): WorkflowDraw;
  runCommand(sessionId: string, command: string): Promise<void>;  // the view's runFor
}
export type PagePluginApi = Pick<PageApi<PluginManifest, ChannelShape>, 'layouts'>;
export interface WorkflowDrawOptions {
  manifest: Pick<PluginManifest, 'id' | 'commands'>;  // see Decisions
  defaultLayout: CompleteLayout;
  defaultStylesheet: string;
  userLayout(): string;
  sideTitle: string;                                  // the side part's section title
}
export interface Drawn { element: HTMLElement; dispose(): void }
export type RunCommand = (command: string) => void;
export interface WorkflowDraw {
  sideTitle: string;
  chip(parent: HTMLElement, input: ChipInput, run: RunCommand): Drawn;
  strip(parent: HTMLElement, input: StripInput, run: RunCommand): Drawn;
  sidePane(parent: HTMLElement, input: SidePaneInput, run: RunCommand): Drawn;
}
export function defaultChecklist(flow: SessionFlow): ChecklistView | null;
// StageActionSpec: `side` is removed; `command` is the owner's short id.
// Type re-exports from layouts/layout.d.ts: Layout, CompleteLayout, ChipInput, StripInput, SidePaneInput,
// SideGroupInput, SideItemInput, StepInput, ActionInput, MarkState, WorkflowKit, WorkflowPart
```

`addStage` of the page is gone.

In `src/plugins/workflow/layouts/layout.d.ts`:
- `ChipInput` adds `badge: string` and `workflowLabel: string`
- `StripInput` renames `hasPlan` to `hasChecklist`
- `SideTaskInput` becomes `SideItemInput { text: string; state: MarkState }`
- `SideWaveInput` becomes `SideGroupInput { title: string; items: readonly SideItemInput[] }`
- `SidePaneInput` renames `planTitle` to `checklistTitle`, `finishedWaves` to `finishedGroups`, `currentWave` to `currentGroup`, `laterWaves` to `laterGroups`, and keeps `checked`, `total`, `finishedOpen`
- `WorkflowKit` adds `badge(parent: HTMLElement, letter: string, label: string): HTMLElement`

In `src/plugins/workflow/page/layout/workflow-draw.ts`: `createWorkflowDraw(deps: WorkflowDrawDeps, api: PagePluginApi, options: WorkflowDrawOptions): WorkflowDraw`, with `interface WorkflowDrawDeps { kit: OwnerKitServices; log: PluginLog; clock: Clock; redraw(): void }`.

In `src/plugins/workflow/stages/heavy-page-workflow.ts`: `heavyPageWorkflow(deps: HeavyPageDeps): PageWorkflow` and `planChecklist(flow: SessionFlow): ChecklistView | null`, with `interface HeavyPageDeps { draw: WorkflowDraw; runMainAction(sessionId: string, command: string): Promise<void>; openDoc(path: string): void; join(a: string, b: string): string; autoStartSeconds(): number }`. Task 05 replaces this file with `workflow-heavy/page/checklist.ts` and `workflow-heavy/page/start.ts`.

In `src/plugins/workflow/page/preview-steps.ts`: `createPreview(deps: PreviewDeps): Preview`, moved from `page/preview.ts`. `PreviewDeps` replaces `autoStartSeconds` with `samples(sessionId: string, now: number): readonly SessionFlow[]`. `page/preview.ts` keeps `PREVIEW_SAMPLES` and `previewFlow`, for task 05 to move.

In `src/plugins/workflow/page/workflow-view.ts`: `WorkflowViewDeps.workflows: { all(): readonly PageWorkflow[] }` replaces `stages`; `kit`, `paths`, `openDoc` and `runAction` leave the deps. `WorkflowView` loses `setLayouts` and `sidePart`, and adds `sidePartFor(workflow: PageWorkflow): ChatSidePart`.

In `src/plugins/workflow/manifest.ts`: the temporary theme token `badge`, `{ kind: 'color', default: 'var(--wg-status-warning)' }`. Only until Heavy's manifest id draws: see The badge.

Decisions:

A plugin's layouts reach the engine's parts. One owner's view cannot draw through another's layout, because `api.layouts.show` binds to the calling plugin. So each plugin calls the show, and the engine keeps one set of parts per plugin:
1. A workflow plugin's page `start` calls `workflow.createWorkflowDraw(api, options)` with its own `api`, and puts the result in `PageWorkflow.draw`.
2. `createWorkflowDraw` makes one `createLayoutParts` with `owner` `options.manifest.id` and `defaultLayout` `options.defaultLayout`. It then calls `api.layouts.show<Layout>` with `defaultLayout`, `defaultStylesheet`, `read: readWorkflowLayout`, `userLayout`, and `setLayouts` that stores the set and calls `deps.redraw()`.
3. So the show loads that plugin's `layouts/<owner>/` folder through that plugin's API, and each part root carries `data-layout-owner="<owner>"`. A plugin's folder hot reloads alone.
4. The plugin's `api` owns the show's life, so the engine does not dispose it. `consumer.track` tracks only `addWorkflow`.

`WorkflowDrawOptions.manifest` is required: `PageApi` has no plugin id and no manifest, while `createLayoutParts` needs `owner` when it is made, and `ownerBaseKitDeps` needs `id` and `commands`. Task 05 passes `manifest: workflowHeavyManifest`.

Reader and contract text. `readWorkflowLayout` stays in the engine, and `createWorkflowDraw` passes it, so a plugin cannot pass a different reader. A plugin's main calls `api.layouts.register({ layoutTypes: workflow.layoutTypes })` (task 01), so each plugin registers the same contract. `scripts/check-layers.mts` adds `src/plugins/workflow/layouts` to the `layers` of the `workflow` entry's `contract` rule, for the type re-exports.

Surfaces. `chipPart` and `stripPart` stay single parts, under the ids `workflow.chip` and `workflow.strip`. Each draw finds the flow's `PageWorkflow` and calls its `draw`. `ChatSidePart.title` is fixed per part, so each workflow gets its own side part:
- `addWorkflow` calls `chat.addSidePart(view.sidePartFor(workflow))`. The part has `id` `<workflow.id>.sidePane`, `title` `workflow.draw.sideTitle`, `order` 20. Disposing the workflow disposes the part.
- The part's held entry records the workflow id. It draws only a flow of that workflow. For any other flow it draws no child, and its section's summary is null. `ChatSidePart`'s contract says a part with no child hides its section.
- So a session shows one section at most: Heavy's reads `Plan` at order 20, as today. Light's and Medium's titles are theirs to choose.

The kit. `createWorkflowKit(services, rollback, run, clock, manifest)` builds its base from `manifest`. The main action's hint and the fold's hint stay `qualify('workflow', ...)` because those commands stay in the engine. Every other action's hint is `qualify(manifest.id, action.command)`. `run` still takes the short name.

Heavy until task 05. `page/start.ts` makes `createWorkflowDraw(api, { manifest: workflowManifest, defaultLayout, defaultStylesheet, userLayout: () => api.settings().layout, sideTitle: 'Plan' })` and adds `heavyPageWorkflow(...)`. The manifest is the engine's because no `workflow-heavy` plugin exists until task 05: its layouts folder and key hints would name nothing. So the owner, the hints and the token stay `workflow`, as today. The side part's id is built from `workflow.id`, so it is `workflow-heavy.sidePane` from this task on. Only `page/workflow-view.ts` names today's id `workflow.sidePane`, so nothing else changes with it. `heavyPageWorkflow` holds `id` `HEAVY_WORKFLOW_ID`, `label` `'Heavy'`, `badge` `'H'`, `stages` `BUILT_IN_PAGE_STAGES`, `draw`, `checklist` `planChecklist`, and:
- `runAction`: `openPlan` calls `openDoc(join(planDir, 'plan.md'))`, and with no plan it throws `the session has no plan`. Every other command calls `runMainAction`, which is `api.channel.invoke('runAction', { sessionId, command })`.
- `countdownText`: null when `countdownEndsAt` is null, else `countdownText(endsAt, now)` from `page/countdown.ts`.
- `progressText`: null when `progress` is null, else today's text, `<checked>/<total>`, then ` wave <n>` while a wave is open, then ` review <r>` when `reviewRounds` is above 0.
- `hasPlan`: `heavyStateOf(flow).progress !== null`.
- `previewFlows`: `PREVIEW_SAMPLES.map` through `previewFlow`, with `autoStartSeconds()`.

The view holds no plan word after this task. No `heavyStateOf` remains in `workflow-view.ts`. `StageActionSpec.side` is gone from every action.

Lookup per flow. These all use the flow's `PageWorkflow`:
- `pageStageOf(flow)` finds the workflow with the id `flow.workflow`, then the stage with the id `flow.stage`. It returns null when `flow.workflow` is null, when no plugin holds it, or when no stage has that id.
- A non-null `flow.workflow` with no match logs once per name: `no page workflow <id>`, or `no page stage <id>`.
- `availableActions`, `buttonActions`, `mainAction`, `steps`, `chipInput`, `stripInput`, `sidePaneInput` and `showRowActivity` read only that stage. With a null stage, `availableActions` is `[]`, `mainAction` is null, and `showRowActivity` sets null. `runFor` then logs `nothing to run for <command> in <name>`.
- `stepperStages` takes `workflow.stages`, not a global list. The rule of one place per `stepSlot` stays.
- `runSpec` becomes `workflow.runAction(sessionId, spec.command)`. Its log and toast on a reject stay.
- `addWorkflow` adds to one `Map` keyed by `id`, and throws `<id> is already added` on a held id. It stores a copy whose `stages` is sorted by `order`, equal orders keeping array order. Add and dispose call `view.redraw()`. `PageWorkflow` has no `order`, and no draw depends on the order of workflows.
- `exports.runCommand` is `view.runFor`.

Countdown and logs, generic.
- `countdown(flow)` is `workflow.countdownText?.(flow, clock.now()) ?? null`, so the chip and the strip tick each second while it is not null, and the pane does not tick.
- `logFlow` logs `<name> progress <text>` from `workflow.progressText?.(flow) ?? null`, when the text changes and is not null. It logs `countdown shown in <name>` and `countdown stopped in <name>` when `countdown(flow)` changes between null and not null. All lines stay under `[workflow]`, since the view logs them.

The preview. `workflow.openPreview` stays in the engine. `samples(sessionId, now)` joins every workflow's `previewFlows?.(sessionId, now)`, in the order workflows were added. `showStep` calls it once per step and takes entry `index`, so a sample's countdown runs down as today. The total in `workflow preview step <n> of <m>: <stage>` is that list's length. `isPreview` and `flowOf` do not change. A preview flow's `workflow` finds its draw like any flow.

What draws while `flow.workflow` is null:
- `chip`: nothing, unless `flow.missedLevel` is true.
- `strip`: nothing.
- Side parts: nothing, and each section's summary is null.
- Row activity: null.

The `No workflow` tag. The engine draws it, with no layout, because no workflow owns such a flow. In the chip case: when `flow.workflow === null && flow.missedLevel`, append `tag('No workflow', 'error')` from `src/shared/page/ui/tag.ts` to the wrapper. `.ui-tag--error` reads `--wg-status-error`. It returns no countdown.

The badge.
- `kit.badge` draws `span.workflow-badge` reading `letter`, with `title` set to `label`.
- It sets the custom property `--workflow-badge-color` to `var(--wg-<manifest id>-badge)`. `page/workflow.css` holds `.workflow-badge { color: var(--workflow-badge-color); }`.
- So each plugin's token `<plugin id>.badge` colours its badge in any layout. plan.md's tokens `workflow-light.badge`, `workflow-medium.badge` and `workflow-heavy.badge` fit this rule.
- Until task 05, Heavy draws under `workflowManifest`, so this task declares a token `workflow.badge`. Task 05 removes it and declares `workflow-heavy.badge`.
- `chipInput` fills `badge` and `workflowLabel` from the `PageWorkflow`. The default `chip` calls `kit.badge(chip, input.badge, input.workflowLabel)` first, then today's tag and countdown.
- The chip of an idle stage still draws nothing, so an idle Heavy flow shows no badge.
- Adding the badge is the one visible change for Heavy. plan.md's goal asks for it.

Checklist inputs.
- `checklistOf(flow)` calls `workflow.checklist(flow)` when present, else `defaultChecklist(flow)`.
- `defaultChecklist` returns null for a null `flow.checklist`. Otherwise `title` is `''`, `checked` counts done items, `total` is the length, and `groups` is `[{ title: 'Tasks', items }]`, or `[]` for an empty list.
- `stripInput.hasChecklist` is `workflow.hasPlan?.(flow) ?? checklistOf(flow) !== null`.
- `sidePaneInput` is null for a null stage, `IDLE_STAGE`, a null view or a hidden pane.
- It groups `view.groups` by today's rule: a group with every item done is finished, the first other is current, the rest are later. An open item of the current group shows `stage.status(flow) ?? 'pending'` when `stage.runsTasks` is true. Every other open item shows `pending`. A done item shows `done`.
- The engine reads `view.checked` and `view.total` as given. It does not count them.

`planChecklist`. It returns null when `heavyStateOf(flow).progress` is null. Otherwise `title` is `progress.title`, `checked` and `total` come from `progress`, and `groups` come from today's `waves` function, which moves here with `TASKS_GROUP_TITLE`: `Wave <n>`, or `Tasks` for no wave, in first-seen order.

`toggleFinishedWaves` keeps its name. It reads `finishedGroups`.

`layouts/default/layout.js`: rename only (`drawWave` to `drawGroup`, `drawLaterWave` to `drawLaterGroup`, the field renames), plus the badge. The texts `<n> waves · <m> done`, `1 wave`, `<n> tasks` and `Up next` stay. Task 05 moves this file to Heavy. `layout.d.ts`'s header comment describes the chip with its badge, and a checklist in place of a plan and waves; its `Layout` comment names "the owning plugin's `layout` setting" in place of `workflow.layout`.

Heavy keeps, each pinned by its existing row:
- The chip's tag, countdown and `onRowLabel`, and no draw at idle.
- The strip's rule: the status line unless the stepper shows the stage, the stepper while the stage shows or no plan is read.
- The main action first, `keyOnly` actions as keys only, Clear & make disabled while busy.
- The `planReady` and `closed` row activities, hidden while busy.
- The side pane only with a read plan, its fold, its current wave's running marks, its later lines, its scroll, its summary `<checked>/<total>`, and a null summary at `total` 0.
- The section title `Plan` at order 20.
- Hiding the pane through `toggleSidePane`.
- The one-second tick for chip and strip, none for the pane.
- The log lines `<name> shows <stage>`, `<name> progress <text>`, `countdown shown in <name>`, `countdown stopped in <name>`, on which the self-test depends.
- The stepper's slots: Primer or Explore, then Make or plan ready.
- `openPlan` opening `<planDir>/plan.md`, and its error with no plan.
- The preview through all thirteen samples.
- The fallback draw: today an unregistered stage draws as idle, which draws nothing and logs `no page stage <id>`. The null stage does the same.

GIVEN a flow with a null workflow and `missedLevel` false WHEN parts draw THEN chip, strip and pane are empty.
GIVEN a flow with a null workflow and `missedLevel` true WHEN the chip draws THEN it holds one `.ui-tag--error` reading `No workflow`, and strip and pane are empty.
GIVEN two page workflows holding a stage `build` with labels `Build L` and `Build M` WHEN a flow of the second draws THEN its steps come from the second alone.
GIVEN a plugin with its own `createWorkflowDraw` WHEN its flow draws THEN each root carries that plugin's `data-layout-owner`, and its layout drew it.
GIVEN that plugin's show calls `setLayouts` WHEN it fires THEN held parts draw again.
GIVEN a flow of `workflow` `'light'` with `checklist` `[{text:'a',done:true},{text:'b',done:false}]` WHEN the pane draws THEN `checked` is 1, `total` is 2, `currentGroup.title` is `Tasks`, and its items' states are `done`, `pending`.
GIVEN two workflows with `sideTitle` `Plan` and `List` WHEN a flow of the first draws THEN the first part's wrapper has a child and the second's has none.

Tests:
- `page/layout/workflow-draw.test.ts`:
  - `CreateWorkflowDraw_ShowsThroughTheCallersApi`: a fake `api.layouts.show` records the options; `read` is `readWorkflowLayout`; `userLayout()` returns the option's value.
  - `CreateWorkflowDraw_SetLayouts_StoresAndRedraws`: calling the recorded `setLayouts` with a layout whose `chip` draws `div.x` calls `redraw` once, and the next `chip` call draws `.x`.
  - `Draw_Root_CarriesOwner`: `data-layout-owner` reads the manifest id `workflow-light`.
  - `SideTitle_ComesFromOptions`: `sideTitle` reads `List`.
- `page/workflow-view.test.ts`, new rows; every existing row keeps its values with flows of `workflow` `'workflow-heavy'` and field renames:
  - `Draw_NullWorkflow` table: `missedLevel` false gives 0 children in each wrapper; `missedLevel` true gives chip text `No workflow`, class `ui-tag--error`, and 0 children in strip and pane.
  - `Steps_PerWorkflow`: workflows A and B, each with `build` of a different label, give `steps.map(s => s.label)` `['Build B']` for a flow of B.
  - `Actions_PerWorkflow`: A's `build` has an action `a`, B's has `b`; `mainAction(flowOfB).command` is `'b'`.
  - `RunFor_CallsTheFlowsRunAction`: `runFor('s1','b')` on a flow of B calls B's `runAction('s1','b')` once and A's 0 times; a reject logs `b not run in <name>: <error>` and toasts `Workflow: <error>`.
  - `Draw_UsesTheFlowsDraw`: a flow of A calls A's `draw.chip` once, and B's 0 times.
  - `Draw_UnknownWorkflow`: `workflow` `'gone'` draws nothing and logs `no page workflow gone` once in two draws.
  - `Chip_Input_CarriesBadge`: `badge` `'L'`, `workflowLabel` `'Light'`.
  - `SidePane_DefaultChecklist`: the GIVEN's values; `hasChecklist` true; empty `checklist` `[]` gives `total` 0, `currentGroup` null, summary null; null `checklist` gives no pane and `hasChecklist` false.
  - `HasChecklist_ReadsHasPlan`: `hasPlan` returning false with a non-null `checklist` gives `hasChecklist` false.
  - `SidePart_PerWorkflow`: the last GIVEN's values; the parts' ids are `a.sidePane` and `b.sidePane`, and their titles `Plan` and `List`.
  - `Countdown_Generic`: a stub `countdownText` returning `5s`, then null, gives the log `countdown shown in <name>`, then `countdown stopped in <name>`, and the tick redraws the chip while it is not null.
  - `ProgressText_Generic`: a stub returning `1/2`, then `1/2`, then `2/2` gives two `progress` log lines; returning null gives none.
  - `AddWorkflow_Sorts`: stages given with orders 20, 10 draw steps in the order 10, 20.
  - Kit rows: `kit.badge` under a manifest `workflow-light` sets `--workflow-badge-color` to `var(--wg-workflow-light-badge)`; `actionButton` for a non-main action anchors `workflow-light.go`; the main action anchors `workflow.mainAction`.
- `page/preview-steps.test.ts`: the `createPreview` rows of `page/preview.test.ts` move here with their values. New row: two samples from each of two stub workflows give `workflow preview step 3 of 4: <stage>` on the third press, and the fifth press closes.
- `page/preview.test.ts`: `previewFlow_EachIndex_ShowsItsSample` keeps its thirteen rows, reading `state` through `heavyStateOf`.
- `stages/heavy-page-workflow.test.ts`:
  - `planChecklist` of progress `{checked:3,total:7,wave:2,reviewRounds:0,title:'P',tasks:[wave 1 two done, wave 2 one done one open, wave null one open]}` gives `title` `'P'`, `checked` 3, `total` 7, group titles `['Wave 1','Wave 2','Tasks']`. A null progress gives null.
  - `heavyPageWorkflow` has `badge` `'H'`.
  - `runAction` table: `openPlan` with `planDir` `/r/plan-a` opens `/r/plan-a/plan.md`; `openPlan` with no plan rejects with `the session has no plan`; `clearAndMake` calls `runMainAction('s1','clearAndMake')`.
  - `progressText` table: null progress gives null; `{checked:3,total:7,wave:2,reviewRounds:1}` gives `3/7 wave 2 review 1`.
  - `hasPlan`: a null progress gives false; a progress with `total` 0 gives true.
- `page/start.test.ts`: `exports(consumer).addWorkflow` draws a stub workflow's chip and adds its side part; `consumer` dispose removes both, and the id can be added again; `addStage` is not on the exports; `createWorkflowDraw` and `runCommand` are.
- `stages/page-stages.test.ts`: rows keep their values; no action has `side`.
- `layouts/default/layout.test.ts`: rows keep their values under the new field names. New row: `chip` draws `.workflow-badge` reading `H` with `title` `Heavy` before the tag, and draws it while `onRowLabel` is true.

Done when: compiles; `scripts/check-layers.mts` passes; `grep -n "heavyStateOf\|PlanProgress" src/plugins/workflow/page/workflow-view.ts` prints nothing; the test gate runs the tests above. How the badge and tag look goes to task 12.
Commit: one commit for the group.

## Proof

