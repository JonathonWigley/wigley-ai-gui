# Feature contributions — design

**Contents**

- **Intent** — what `auri.json` is for and what a good outcome looks like.
- **Terms** — feature, strategy, contribution, section, source.
- **The file** — where `auri.json` sits, how the app finds it, hot reload, validation.
- **The registry** — the `contributions` plugin: its main export, its slot, its problems.
- **Picking a strategy** — single-strategy features, merged features, the workflows on/off list, the setting paths.
- **Section: workflows** — the declarative workflow schema, its trigger rules, actions and templates, and the Large example.
- **Section: planFormat** — the plan reader's knobs.
- **Section: retro** — the auto-retro command, folder and triggers.
- **Section: backlog** — follow-up homes, file name, the assistant.
- **Section: docs** — global folders, the wiki main page, skill link prefixes.
- **Section: liveView** — the playtest command patterns and the crop probe.
- **The Checklist flow** — the engine default, the edit gate, and how `set_workflow_step` lists its steps.
- **Names and types** — every shared name as a TypeScript sketch.

## Intent

Any agent plugin can bind the app's generic features to its own skills, folders and conventions through one JSON file, `auri.json`, at its root. The app names no plugin, skill or personal folder: every such binding comes from a contribution. A feature with no contribution shows its empty state. This document is the contract: the file's schema, the registry that reads it, and the names every feature's code and the user's `wigley` plugin build against.

A good outcome:

- The user's four workflow levels, plan format, retro, backlog, docs and live view run from the `wigley` plugin's `auri.json` exactly as they run today from code.
- A fresh user with no contributing plugin sees each feature's empty state, and no error.
- One bad `auri.json` shows one config problem naming its plugin. Every other plugin's contributions still load.

## Terms

- **Feature** — an app feature a contribution binds: `workflows`, `planFormat`, `retro`, `backlog`, `docs`, `liveView`. Its **feature key** is its top-level key in `auri.json`.
- **Section** — the value under one feature key in one plugin's `auri.json`.
- **Source** — the agent plugin a section came from: its name, key, version and root folder.
- **Strategy** — one source's validated section for one feature. A feature lists its installed strategies.
- **Single-strategy feature** — a feature that runs one strategy at a time (`retro`, `backlog`), picked in Settings.
- **Merged feature** — a feature that runs every installed strategy together (`docs`, `liveView`).
- **Workflow feature** — `workflows`: each declared workflow is switched on or off by itself.

## The file

### Where it sits

`auri.json` sits at an agent plugin's root, beside `.claude-plugin/plugin.json`. The user's file is `wigley-ai-marketplace/plugins/wigley/auri.json`. A plugin needs no other change to contribute: no manifest field names the file.

Each key at the top level is a feature key. The file also holds `"version"`, and may hold `"$schema"`:

```json
{
  "version": 1,
  "workflows": [],
  "planFormat": {},
  "retro": {},
  "backlog": {},
  "docs": {},
  "liveView": {}
}
```

- `version` is the contract version, `1`. A file with another version is a config problem, and none of its sections load.
- `$schema` is optional, and the app ignores its value. The app writes the file's JSON schema to `~/.config/wigley-ai-gui/plugins/_types/auri.schema.json` at start, beside the user-plugin types, and the `auri` plugin's skill on writing `auri.json` names that path.
- A key no registered feature reads is ignored and logged once per load, so a newer plugin works with an older app.

### How the app finds it

The registry builds the list of sources on each scan:

1. **Installed plugins.** `createHarnessFolders(...).installedPlugins()` (`src/shared/harness-folders.ts`) gives every install of every registered harness profile. Each install's `installDir` is a candidate root.
2. **The app's own plugin.** `agentPluginDir(appDir, paths)` gives `<app>/agent-plugin/`, the `auri` plugin the app passes to Claude Code with `--plugin-dir`. It is always a source, with the key `auri@app`.

Each root that holds an `auri.json` file is a source. The registry dedupes the list:

- Two candidates with the same real path are one source (two profiles that share a plugins folder).
- Two candidates with the same plugin name and different roots keep one: the app's own `agent-plugin/` beats an installed `auri`, and between installs the highest `version` wins, then the first in profile order. The registry logs each candidate it drops.

A source's **plugin name** is its key before `@` (`wigley` from `wigley@wigley-ai-marketplace`). It is the prefix Claude Code gives the plugin's skills, and it qualifies the plugin's workflow ids.

### Hot reload

The registry scans again, and re-runs every feature reader, when one of these changes:

- any registered profile's installed-plugins list (Claude Code: `<configDir>/plugins/installed_plugins.json`), through `services.files.watch`;
- any `auri.json` the last scan found, through the same watch;
- the `core.agentHarnesses` slot (a profile added or removed).

Changes settle for 300 ms before a scan. A scan that gives every feature the same strategies as before writes nothing.

### Validation

The registry parses the file and checks `version`. Each feature's reader validates its own section (The registry). A failure is a **contribution problem**:

- An unreadable file, a file that is not JSON, or a wrong `version`: one problem for the file, and no section of it loads.
- A section its reader refuses: one problem per refused section, naming the feature key and the reader's reasons. The plugin's other sections still load.

Each problem is served as a config problem whose `file` is the full path of the `auri.json` and whose `message` starts with the plugin name: `wigley: workflows[2].stages[4].enter[0]: "from" names no stage or group: featureRn`. The title bar badge and toast show it as they show any config problem (`ConfigProblemsService`, Names and types). A fixed file clears its problems on the next scan.

## The registry

The registry is a built-in plugin, id `contributions`, in `src/plugins/contributions/`. It is a plugin, not core, because the core holds only what every plugin needs before it starts; a feature that reads contributions lists `contributions` in its `dependsOn.main`, and a page part that reads strategies lists it in `reads.page`. The registry names no feature: each feature plugin registers its own reader.

### Main export

```ts
contributionsMainKey = { id: 'contributions', process: 'main' }

interface ContributionsMainExports {
  registerFeature<V>(key: FeatureKey, reader: FeatureReader<V> & JsonSlot<V>): Disposable;
  strategies<V>(key: FeatureKey): readonly Strategy<V>[];
  onChanged(key: FeatureKey, listener: (strategies: readonly Strategy<unknown>[]) => void): Disposable;
  ready: Promise<void>;
}
```

- `registerFeature` throws on a key already registered. The registry runs the reader over every source's section for that key at once, and again on every scan.
- A reader gets the raw section and the source. It returns the validated value or its reasons. A reader is pure: it reads no file. A reader that needs a file under the plugin (the live-view probe) resolves the path against `source.root` and leaves the read to the feature.
- The value is JSON, because it travels in a slot. `JsonSlot<V>` makes the call compile only when `V` is JSON-safe; `V` is not bound to `JsonValue` itself, since an interface value such as `WorkflowDecl[]` does not extend that recursive type.
- `ready` resolves after the first scan settles. A feature reads `strategies` after `ready`, or hears `onChanged`.
- Dispose of the registration removes the feature's strategies from the slot and its problems from the served config.

### Slot

```ts
contributionsFeaturesSlot: KeyedSlotKey<FeatureStrategies, 'main', 'contributions'>
  = { id: 'contributions.features', process: 'main', kind: 'keyed' }
```

Keyed by feature key. Each value lists the feature's strategies in source order: the app's own plugin first, then installs in profile order. A page part reads it to draw Settings choices, empty states and declared workflows.

### How a feature lists its installed strategies

`strategies(key)` in main, or `contributionsFeaturesSlot` keyed by `key` in either process. Each `Strategy` carries its `id` (the source's plugin name), its `label` (the section's `label`, else the plugin name), its `source` and its `value`.

## Picking a strategy

### Single-strategy features

`retro` and `backlog` each run one strategy at a time. Each owning plugin declares one setting, `strategy`, with default `''`:

| Feature | Setting path | Control kind |
|---|---|---|
| `retro` | `auto-retro.strategy` | `strategy:retro` |
| `backlog` | `backlog.strategy` | `strategy:backlog` |

`''` means automatic. `pickStrategy(strategies, setting)` (in the registry's `contract.ts`) resolves the pick:

- a setting that names an installed strategy picks it;
- `''` with exactly one strategy installed picks it;
- `''` with none installed → `{ kind: 'none' }`;
- `''` with two or more installed → `{ kind: 'choose', ids }`;
- a setting that names no installed strategy → `{ kind: 'missing', id }`.

Each result other than a pick shows the feature's empty state, worded for the case: no plugin binds the feature; pick one in Settings; the picked plugin is not installed. The feature runs nothing in its empty state. Auto-retro queues no retro, and Backlog lists no home.

The `contributions` page part registers one control kind per feature key in its slot, through `SettingsPageExports.addControlKind`, with the id `strategy:<featureKey>`. The control lists `Automatic` (`''`) and each installed strategy by label.

### Merged features

`docs` and `liveView` run every installed strategy together: docs takes the union of every strategy's global folders and link prefixes, and live view watches every strategy's command patterns. They have no pick setting. Two strategies that map one link prefix to different plugins keep the first in source order, and the registry logs the clash.

### planFormat

`planFormat` is read per workflow: a workflow reads plans in its own plugin's `planFormat`. A plugin with no `planFormat` gets the plain-checklist defaults (Section: planFormat). It has no pick setting.

### Workflows

Every installed declared workflow is on unless the user switches it off. The `workflow` plugin declares:

| Setting path | Default | Control kind |
|---|---|---|
| `workflow.off` | `[]` | `strategy-list:workflows` |
| `workflow.autoStart` | `[]` | `json` |
| `workflow.layout` | `'default'` | `layout` |

- `workflow.off` lists qualified workflow ids (`wigley:large`). The `contributions` page part registers the `strategy-list:workflows` control kind: one row per declared workflow, each with an on/off switch.
- `workflow.autoStart` lists `{ workflow: string; seconds: number }` records. A listed workflow runs its stages' `auto` action after the countdown; `seconds` is at least 1. An unlisted workflow starts no countdown. It replaces `workflow-large.autoClearAndMake` and `workflow-large.autoStartSeconds`.
- `workflow.layout` is the one layout every declared workflow draws with, from `layouts/workflow/`.

## Section: workflows

`workflows` is an array of workflow declarations. The `workflow` plugin's reader validates each one, qualifies its id as `<plugin name>:<id>`, and calls the engine's `addWorkflow` with a main and a page workflow built from it. The engine keeps `MainWorkflow` and `PageWorkflow` as its internal seam; the declaration is the only public way to add a workflow.

### Workflow fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique in the plugin. Qualified as `<plugin name>:<id>`. |
| `label` | string | The workflow's word: `Small`. |
| `badge` | string | The row's letter: `S`. |
| `badgeColor` | string | A CSS color or theme token for the badge. Default `var(--wg-accent)`. |
| `order` | number | The lowest order's claim wins a skill two workflows claim. |
| `claims` | string[] | The skill names that start this workflow (`wigley:small`). |
| `flagsUnclaimedWork` | `true` | While this workflow is on, a live turn with agent work that ends on the Checklist flow shows the session's `No workflow` tag: the plugin expects every working session to claim one of its workflows. Left out: no tag. |
| `groups` | object | Named stage lists for `from`: `{ "featureRun": ["explore", …] }`. |
| `counters` | object | Counters the engine keeps for the flow (Counters). |
| `fixCycles` | object | The run log's fix cycles: `{ "counter": "fix" }` or `{ "planCounter": "reviewRounds" }`. Left out: 0. |
| `sidePane` | object | `{ "kind": "checklist" \| "plan", "title": "Plan" }`. |
| `actions` | object | Actions by action id (Actions). |
| `stages` | array | Stage declarations in stage order (Stage fields). |

Every skill in `claims` appears in exactly one stage's `skill` trigger: that trigger is where the claim enters, so it carries no `from` and no `when`. A group name equal to a stage id is refused.

### Stage fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique in the workflow. |
| `label` | string | The step's word: `Build`. |
| `step` | string | The value `set_workflow_step` names this stage by. Left out, no report enters it. |
| `inStepper` | boolean | Default `true`. |
| `slot` | string | Stages that share a slot take one place in the stepper. |
| `runsTasks` | boolean | The current group's open items draw the stage's status. |
| `status` | string | `busy` (running while busy, else paused), `finishing` (running while busy, else done), `ready`, `none`. |
| `finishes` | boolean | Entering it finishes the run and writes the run log line. |
| `reopens` | boolean | A finishing stage only: a `planChanged` while the flow is here and busy returns the flow to the stage it entered this one from. |
| `records` | string[] | Plan counters to snapshot when the flow enters this stage, for `counterRose`. A reopen does not snapshot. |
| `enter` | array | Triggers, in order (Triggers). |
| `progress` | template | What follows the status text and the stepper label: `" {plan.build}"`. |
| `chipProgress` | template | What follows the word on the row chip. Default: `progress`. |
| `detail` | template[] | The side pane's detail parts, joined by ` · `. |
| `rowActivity` | object | `{ "word", "tone", "emphasis"? }`, shown while the stage waits and the flow is not busy. |
| `unseenActivity` | object | The same shape, shown in place of a finished turn's done until the user views the session. |
| `actions` | string[] | Action ids in order, the main action first. |
| `auto` | string | An action id the countdown runs on entry, when `workflow.autoStart` lists the workflow. |

Every activity takes rank `STAGE_ACTIVITY_RANK` (15). `tone` is a sessions `ActivityTone`, and `emphasis` is `raised` or `urgent`.

### Triggers

A trigger is one of three kinds. Each kind takes the optional `from` and `when`:

```ts
{ "skill": "wigley:make", "from"?: [...], "when"?: [...], "clearsPlan"?: true, "planFromArgs"?: true }
{ "step": "fix",          "from"?: [...], "when"?: [...] }
{ "event": "planGone",    "from"?: [...], "when"?: [...], "clearsPlan"?: true }
```

- `from` lists stage ids and group names. The trigger matches only while the flow is in one of them. Left out: any stage.
- `when` lists predicates. All must hold.
- `clearsPlan` drops the flow's plan folder and progress when the trigger matches.
- `planFromArgs` takes the plan folder from the skill's argument, when it names a plan file or a plan folder as `planFormat` defines them.

The engine folds a signal in today's order: the running state, the claim, the checklist, the counters and plan bookkeeping, then the stage triggers. Stages are tried in array order and each stage's triggers in order; the first match wins.

Three rules make re-entry predictable:

- A `skill` trigger matches while the flow is already in its stage. This re-enters the stage, and its `clearsPlan` applies again. It replaces every level's "own skill → first stage" rule.
- A `step` or `event` trigger does not match while the flow is already in its stage, so it never blocks a later stage's trigger.
- A claim from another workflow enters the stage whose `skill` trigger names the claimed skill. A claim from a stage that `finishes` starts a new run. The flow's checklist empties on every claim.

Events:

| Event | From |
|---|---|
| `turnEnded` | the engine, on every main-agent turn end |
| `planChanged` | the plan capability, when the read plan changes |
| `planGone` | the plan capability, when the plan folder holds no plan file |
| any other name | an action of kind `event`, or a `launch` action's `then` |

Predicates:

| Predicate | Holds when |
|---|---|
| `idle` | no turn and no subagent runs |
| `busy` | a turn or a subagent runs |
| `planRead` | the plan was read at least once |
| `planHasTasks` | the read plan has at least one box |
| `planOpen` | the read plan has an open box |
| `{ "counterRose": "<plan counter>" }` | the plan counter is above its snapshot from the last stage that `records` it |

Every plan predicate is false until the plan is read; only `idle` and `busy` hold without one.

### Counters

`counters` maps a name to `{ "counts": "<stage id>", "resetOn": "claim" }`. The counter adds one each time the flow enters the stage from another stage, and goes to 0 when the workflow's own skill claims the flow. Medium's fix cycles are `{ "fix": { "counts": "fix", "resetOn": "claim" } }`.

### Actions

```ts
{ "kind": "send" | "clearAndSend" | "launch" | "openPlan" | "event",
  "label": "Clear & make",
  "text"?: "/wigley:make {plan}",   // send, clearAndSend, launch
  "event"?: "dismissed",            // event
  "then"?: "handedOff",             // launch: the event the flow takes once the launch resolves
  "keyOnly"?: true,
  "risky"?: true,
  "key"?: "<Leader>wn",
  "available"?: [predicates],
  "enabled"?: [predicates] }
```

- `send` sends `text` to the session. `clearAndSend` clears it first. `launch` starts a new session in the flow's project and profile with `text`, headless as the source session is. `openPlan` opens the plan file in Docs mode. `event` folds the named event into the flow.
- `available` decides whether the action shows; `enabled` decides whether a shown action runs. Left out: always. The countdown's Cancel action is built in and shows while a countdown runs.
- The engine registers each action as a runtime command through `api.commands.register`, under the short id `actionCommandShortId(workflowId, actionId)`, for example `workflow.wigley-large-clearAndMake`. Its declaration takes the action's `label`, `group: 'workflow'`, `runsIn: 'page'`, `targets: true` and `risky`.
- `key` binds the command through `api.keys.bind` with scope `any`. The user's `keymap.json` overrides it as usual. `<Leader>ww` stays the engine's `workflow.mainAction`.

### Templates

A template is a string with `{variable}` slots:

| Variable | Value |
|---|---|
| `{plan}` | the plan folder's full path |
| `{plan.title}` | the plan's title |
| `{plan.checked}`, `{plan.total}` | ticked and total boxes |
| `{plan.build}` | `<checked>/<total>` over every box but the verification task |
| `{plan.wave}` | the first group with an open box |
| `{plan.counter.<name>}` | a `planFormat` counter |
| `{counter.<name>}` | a workflow counter |
| `{checklist}` | `<checked>/<total>` of the agent's checklist |

Every `{plan.…}` variable is empty until the plan is read, and `{checklist}` until a checklist arrives; a `0/0` count is empty. A template whose every variable is empty, null or 0 renders `''`. A `detail` part that renders `''` is left out. A command `text` with an empty `{plan}` does not run, and the engine logs `no plan to make`.

### Example: the user's workflows

These four declarations are the user's workflows as today's level plugins run them, read from their stage files. The
`wigley` plugin's `auri.json` holds them and is their truth; the app's sample,
`src/plugins/workflow/declared/fixtures/sample-auri.json`, is a fixture copy of its `workflows` and `planFormat`, changed
with it. Small, Medium and Spike follow one shape. Small:

```json
{
  "id": "small", "label": "Small", "badge": "S", "badgeColor": "var(--wg-status-info)", "order": 10,
  "claims": ["wigley:small"],
  "sidePane": { "kind": "checklist", "title": "Checklist" },
  "stages": [
    { "id": "scope", "label": "Scope", "status": "busy", "enter": [{ "skill": "wigley:small" }] },
    { "id": "build", "label": "Build", "step": "build", "runsTasks": true, "status": "busy", "progress": " {checklist}",
      "enter": [{ "step": "build" }] },
    { "id": "check", "label": "Check", "step": "check", "status": "busy", "enter": [{ "step": "check" }] },
    { "id": "land", "label": "Land", "step": "land", "slot": "land", "status": "busy", "enter": [{ "step": "land" }] },
    { "id": "done", "label": "Land", "step": "done", "slot": "land", "status": "finishing", "finishes": true,
      "enter": [{ "step": "done" }] },
    { "id": "answered", "label": "Answered", "step": "answered", "inStepper": false, "status": "none",
      "finishes": true, "unseenActivity": { "word": "answered", "tone": "success" },
      "enter": [{ "step": "answered" }] }
  ]
}
```

Medium adds its counter, and its fix stage shows it:

```json
{
  "id": "medium", "label": "Medium", "badge": "M", "badgeColor": "var(--wg-accent)", "order": 20,
  "claims": ["wigley:medium"],
  "counters": { "fix": { "counts": "fix", "resetOn": "claim" } },
  "fixCycles": { "counter": "fix" },
  "sidePane": { "kind": "checklist", "title": "Checklist" },
  "stages": [
    { "id": "interview", "label": "Interview", "status": "busy", "enter": [{ "skill": "wigley:medium" }] },
    { "id": "build", "label": "Build", "step": "build", "runsTasks": true, "status": "busy", "progress": " {checklist}",
      "enter": [{ "step": "build" }] },
    { "id": "review", "label": "Review", "step": "review", "status": "busy", "enter": [{ "step": "review" }] },
    { "id": "fix", "label": "Fix", "step": "fix", "status": "busy", "progress": " · cycle {counter.fix}",
      "enter": [{ "step": "fix" }] },
    { "id": "land", "label": "Land", "step": "land", "slot": "land", "status": "busy", "enter": [{ "step": "land" }] },
    { "id": "done", "label": "Land", "step": "done", "slot": "land", "status": "finishing", "finishes": true,
      "enter": [{ "step": "done" }] }
  ]
}
```

Spike's interview takes both triggers, so a new ask returns the flow to it:

```json
{
  "id": "spike", "label": "Spike", "badge": "X", "badgeColor": "var(--wg-fg-secondary)", "order": 40,
  "claims": ["wigley:spike"],
  "sidePane": { "kind": "checklist", "title": "Checklist" },
  "stages": [
    { "id": "interview", "label": "Interview", "step": "interview", "status": "busy",
      "enter": [{ "skill": "wigley:spike" }, { "step": "interview" }] },
    { "id": "build", "label": "Build", "step": "build", "runsTasks": true, "status": "busy", "progress": " {checklist}",
      "enter": [{ "step": "build" }] },
    { "id": "check", "label": "Check", "step": "check", "status": "busy", "enter": [{ "step": "check" }] },
    { "id": "land", "label": "Land", "step": "land", "slot": "land", "status": "busy", "enter": [{ "step": "land" }] },
    { "id": "done", "label": "Land", "step": "done", "slot": "land", "status": "finishing", "finishes": true,
      "enter": [{ "step": "done" }] }
  ]
}
```

Large uses every part of the schema:

```json
{
  "id": "large", "label": "Large", "badge": "L", "badgeColor": "var(--wg-status-warning)", "order": 30,
  "claims": ["wigley:feature", "wigley:feature-primer", "wigley:make"],
  "groups": { "featureRun": ["explore", "interview", "plan", "coldRead", "planReady"] },
  "fixCycles": { "planCounter": "reviewRounds" },
  "sidePane": { "kind": "plan", "title": "Plan" },
  "actions": {
    "clearAndMake": { "kind": "clearAndSend", "label": "Clear & make", "text": "/wigley:make {plan}",
                      "risky": true, "enabled": ["idle"] },
    "makeInNewSession": { "kind": "launch", "label": "Make in new session", "text": "/wigley:make {plan}",
                          "then": "handedOff", "key": "<Leader>wn" },
    "resumeMake": { "kind": "clearAndSend", "label": "Resume make", "text": "/wigley:make {plan}",
                    "risky": true, "keyOnly": true, "available": ["idle", "planOpen"], "enabled": ["idle"],
                    "key": "<Leader>wr" },
    "openPlan": { "kind": "openPlan", "label": "Open plan", "keyOnly": true, "key": "<Leader>wo" },
    "retro": { "kind": "send", "label": "Retro", "text": "/wigley:retro", "enabled": ["idle"], "key": "<Leader>wt" },
    "dismiss": { "kind": "event", "label": "Dismiss", "event": "dismissed", "keyOnly": true, "key": "<Leader>wd" }
  },
  "stages": [
    { "id": "idle", "label": "Idle", "inStepper": false, "status": "none",
      "enter": [{ "event": "handedOff", "clearsPlan": true },
                { "event": "dismissed", "from": ["closed"], "clearsPlan": true }] },
    { "id": "primer", "label": "Primer", "slot": "start", "status": "busy",
      "enter": [{ "skill": "wigley:feature-primer", "clearsPlan": true }] },
    { "id": "explore", "label": "Explore", "step": "explore", "slot": "start", "status": "busy",
      "detail": ["{plan.title}"], "actions": ["openPlan"],
      "enter": [{ "skill": "wigley:feature", "clearsPlan": true }, { "step": "explore", "from": ["featureRun"] }] },
    { "id": "interview", "label": "Interview", "step": "interview", "status": "busy",
      "detail": ["{plan.title}"], "actions": ["openPlan"],
      "enter": [{ "step": "interview", "from": ["featureRun"] }] },
    { "id": "plan", "label": "Plan", "step": "plan", "status": "busy",
      "detail": ["{plan.title}"], "actions": ["openPlan"],
      "enter": [{ "step": "plan", "from": ["featureRun"] }] },
    { "id": "coldRead", "label": "Cold read", "step": "cold_read", "status": "busy",
      "detail": ["{plan.title}"], "actions": ["openPlan"],
      "enter": [{ "step": "cold_read", "from": ["featureRun"] }] },
    { "id": "planReady", "label": "Make", "slot": "make", "status": "ready",
      "detail": ["{plan.title}", "{plan.total} tasks"],
      "rowActivity": { "word": "ready to make", "tone": "attention", "emphasis": "raised" },
      "actions": ["clearAndMake", "makeInNewSession", "openPlan"], "auto": "clearAndMake",
      "enter": [{ "event": "turnEnded", "from": ["featureRun"], "when": ["idle", "planHasTasks"] },
                { "event": "planChanged", "from": ["featureRun"], "when": ["idle", "planHasTasks"] }] },
    { "id": "make", "label": "Make", "slot": "make", "runsTasks": true, "status": "busy",
      "records": ["reviewRounds"], "progress": " {plan.build}",
      "detail": ["{plan.build}", "wave {plan.wave}", "{plan.title}"], "actions": ["resumeMake", "openPlan"],
      "enter": [{ "skill": "wigley:make", "planFromArgs": true }] },
    { "id": "review", "label": "Review", "status": "busy", "progress": " · round {plan.counter.reviewRounds}",
      "detail": ["round {plan.counter.reviewRounds}", "{plan.checked}/{plan.total}", "{plan.title}"],
      "actions": ["resumeMake", "openPlan"],
      "enter": [{ "skill": "wigley:review", "from": ["make", "fix"] },
                { "event": "planChanged", "from": ["make"], "when": [{ "counterRose": "reviewRounds" }] }] },
    { "id": "fix", "label": "Fix", "step": "fix", "status": "busy", "progress": " · cycle {plan.counter.reviewRounds}",
      "detail": ["cycle {plan.counter.reviewRounds}", "{plan.checked}/{plan.total}", "{plan.title}"],
      "actions": ["resumeMake", "openPlan"], "enter": [{ "step": "fix", "from": ["make", "review"] }] },
    { "id": "closed", "label": "Close", "status": "finishing", "finishes": true, "reopens": true,
      "progress": " · {plan.checked}/{plan.total}", "detail": ["{plan.title} · done"],
      "rowActivity": { "word": "closed", "tone": "success", "emphasis": "raised" },
      "actions": ["retro", "dismiss"],
      "enter": [{ "event": "planGone", "from": ["make", "review", "fix"], "when": ["planRead"] }] }
  ]
}
```

`openPlan` is `keyOnly`, so a stage that lists it draws no button for it; its key opens the plan in every listed
stage. The closed stage leaves it out, as today. The sample's fixture tests pin every label, detail and action list;
a change to one changes the sample, this example and the `wigley` plugin's `auri.json` together.

### The plan capability

A workflow gets the plan capability (`usesPlan`) when any of these appears in its declaration: `sidePane.kind` `plan`;
a trigger with `clearsPlan` or `planFromArgs`, or an `event` trigger on `planChanged` or `planGone`; a plan predicate
(`planRead`, `planHasTasks`, `planOpen`, `counterRose`) in any `when`, `available` or `enabled`; a stage with
`records`; `fixCycles.planCounter`; an `openPlan` action; a template holding `{plan}` or `{plan.…}`. It lives in the `workflow` plugin, in `src/plugins/workflow/plan/`. It is generic code, and its only parameter is the workflow's `planFormat`. It owns:

- the plan folder: from a write of a plan file (`planFormat.folder` + `planFormat.file`), from a `planFromArgs` skill argument, and from reports through `set_workflow_plan` and `<endpoint dir>/plan-runs/<row id>.json`; cleared by `clearsPlan`;
- the plan watch over every git-worktree copy of the folder (`plan-watch.ts` and `plan-copies.ts`, in `src/plugins/workflow/plan/`);
- the reader `readPlan(text, taskDocs, format)` (`read-plan.ts`), which takes the format as a parameter;
- the `planChanged` and `planGone` events, the `records` snapshots, and the `reopens` rule;
- the plan side pane, grouped by `planFormat.groupHeading`, with a task drawn as running while its task document's status is `taskDocs.running`.

`set_workflow_plan` is contributed only while some enabled workflow uses the plan capability.

## Section: planFormat

Every knob is optional. Left out, the reader reads a plain checklist: every box in the file, no groups, the title from the first `# ` heading.

| Knob | Meaning |
|---|---|
| `folder` | Glob for a plan folder's name: `plan-*`. A write of `<folder>/<file>`, or a `planFromArgs` argument naming that folder or file, sets the plan. Default: no plan from writes or arguments, reports only. |
| `file` | The plan file in the folder. Default `plan.md`. |
| `tasksSection` | The H2 heading whose boxes count, exact text: `## Tasks`. Default: the whole file. |
| `groupHeading` | `{ "pattern": "^### Wave (\\d+)$", "title": "Wave {1}" }`. A heading matching `pattern` starts a group; capture 1 is the group number for `{plan.wave}`. Boxes before any group go under `Tasks`. |
| `titleSuffix` | Text dropped from the end of the title: ` — plan`. |
| `counters` | Named counts of list lines: `{ "reviewRounds": { "section": "## Run log", "heading": "### Review rounds", "itemPrefix": "- " } }`. |
| `taskDocs` | `{ "link": "bareMd", "statusField": "Status", "statusLines": 15, "statuses": ["not started", "in progress", "done"], "running": "in progress" }`. A task's document is its first link target when that target is a bare `*.md` in the plan folder. Its status is the first `Status:` or `**Status:**` line in its first `statusLines` lines outside fences. `statuses` ranks the statuses, lowest first, for the worktree-copy rule. |
| `verificationTask` | `{ "lastTaskDocLacking": "Rung" }`. The last box whose task document was read and has no `Rung:` or `Rung (…):` field is the verification task. `{plan.build}` leaves it out. |

Fenced code never counts, and `read-plan.ts` holds the checkbox and link-stripping rules.

The user's:

```json
"planFormat": {
  "folder": "plan-*",
  "file": "plan.md",
  "tasksSection": "## Tasks",
  "groupHeading": { "pattern": "^### Wave (\\d+)", "title": "Wave {1}" },
  "titleSuffix": " — plan",
  "counters": { "reviewRounds": { "section": "## Run log", "heading": "### Review rounds", "itemPrefix": "- " } },
  "taskDocs": { "link": "bareMd", "statusField": "Status", "statusLines": 15,
                "statuses": ["not started", "in progress", "done"], "running": "in progress" },
  "verificationTask": { "lastTaskDocLacking": "Rung" }
}
```

## Section: retro

| Field | Meaning |
|---|---|
| `label` | The Settings choice's text. Default: the plugin name. |
| `command` | The retro row's first message. `{sessions}` is the ended conversation's host session ids, joined by spaces. |
| `folder` | The folder each retro row runs in. `~` is the home folder. |
| `on` | Which endings queue a retro: `close` (a user close after a sent message), `clear` (a `/clear` after a sent message). |

A row whose first message starts with the command's text before `{sessions}` is a retro row and queues no retro, as `opensWithRetroCommand` does today. `auto-retro.folder` is removed: the folder comes from the strategy.

```json
"retro": { "command": "/wigley:retro auto {sessions}", "folder": "~/wigley-agents", "on": ["close", "clear"] }
```

## Section: backlog

| Field | Meaning |
|---|---|
| `label` | The Settings choice's text. |
| `homes` | Folder templates for a repo's features home, in order: `{repo}` is the repo's clone root, `{name}` its origin repo name. The first that exists is the home. |
| `file` | The follow-ups file in a home: `followups.md`. |
| `areaFolder` | A folder in a home holding per-area follow-up files: `followups`. Optional. |
| `assistant` | `{ "instructions": "…" }` added after the Backlog assistant's own instructions. Optional. |

The follow-up file format is documented once, in the `auri` plugin's backlog skill, and the assistant's own instructions point at that skill. The docs index reads `homes`, `file` and `areaFolder` from the contributions file (Section: docs).

```json
"backlog": {
  "homes": ["{repo}/docs/features", "~/wigley-features/{name}"],
  "file": "followups.md",
  "areaFolder": "followups"
}
```

## Section: docs

| Field | Meaning |
|---|---|
| `globalFolders` | `[{ "path", "referenceFiles"?, "subfolders"?, "skip"? }]`. The index walks `path`'s top level as instructions, `referenceFiles` as reference, each of `subfolders` in full, and leaves out `skip`. A global folder is also a create place for instructions. |
| `wikiMain` | The wiki's main page. The first strategy in source order that names one wins. |
| `linkPrefixes` | `{ "wigley:": "wigley@wigley-ai-marketplace" }`. A wiki link `wigley:<skill>` resolves to the skill of that name in the install with that plugin key. |

The docs index script moves into the app at `agent-plugin/scripts/docs-index/`, and docs finds it through `agentPluginDir`. `docs.scriptPath` still overrides it. The script reads no personal folder: docs writes `contributions.json` in its plugin data folder (`api.data`) with the merged docs strategies and the picked backlog strategy, and passes its full path as `--contributions <file>` on every run. The index file and its config keep their paths under `~/.agents/wigley-docs/`.

```json
"docs": {
  "globalFolders": [{ "path": "~/wigley-agents", "referenceFiles": ["decisions.md"],
                      "subfolders": ["learning", "wiki"], "skip": ["archive", "learning/archive"] }],
  "wikiMain": "~/wigley-agents/wiki/Main.md",
  "linkPrefixes": { "wigley:": "wigley@wigley-ai-marketplace" }
}
```

## Section: liveView

| Field | Meaning |
|---|---|
| `open` | Command patterns whose successful Bash call opens the session's Live view. |
| `close` | Command patterns whose successful Bash call closes it. |
| `probe` | `{ "file": "<path from the plugin root>", "entry": "<C# entry>", "runner": "unityScript" }`. Optional. Crops an opened view to the Game View. |

A command pattern is `{ "program", "words", "valueFlags"?, "projectPathFlag"?, "projectPathVariable"? }`:

- `program` matches the base name of a segment's first word; `python` before it is skipped for a `*.py` program.
- `words` must follow, in order, once flags and their values are skipped. `valueFlags` names the flags that take a value.
- `projectPathFlag` and `projectPathVariable` give the project folder, read as `playtest-command.ts` reads it today.

`runner: "unityScript"` runs the file with `unity command script run` (`run_script` below com.unity.pipeline 0.9), as `game-view-probe.ts` does. A missing probe file reads as no probe, and the view streams the whole editor window. The first strategy with a probe wins.

The user's, as today's `playtest-command.ts` reads the commands. `<unity flags>` stands for `["--timeout", "--port",
"--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"]`, written out in full in the
file (so the block below is not literal JSON):

```
"liveView": {
  "open": [
    { "program": "unity", "words": ["command", "editor.playmode", "start"], "valueFlags": <unity flags>,
      "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
    { "program": "unity", "words": ["command", "editor_play"], "valueFlags": <unity flags>,
      "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
    { "program": "capture.py", "words": ["start"], "valueFlags": ["--fps", "--backend"],
      "projectPathFlag": "--project-path" }
  ],
  "close": [
    { "program": "unity", "words": ["command", "editor.playmode", "stop"], "valueFlags": <unity flags>,
      "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
    { "program": "unity", "words": ["command", "editor_stop"], "valueFlags": <unity flags>,
      "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" }
  ],
  "probe": { "file": "skills/unity-playtest/unity/WigleyCapture.cs", "entry": "Wigley.WigleyCapture.Run",
             "runner": "unityScript" }
}
```

`capture.py stop` has no close row: today it does not close the view. The project folder falls back to the line's
`cd` folder only for a pattern with `projectPathVariable`. Task 10 of shareable-app holds the same table, and its
tests pin it.

## The Checklist flow

Every app session keeps a task list. The engine ships one built-in workflow, `CHECKLIST_WORKFLOW`, declared in the same `WorkflowDecl` shape as a contribution, with the id `checklist`:

- one stage, `work`, label `Checklist`, `status: "busy"`, `progress: " {checklist}"`, no `step`;
- `claims: []`, and an `order` above every declared workflow's;
- `sidePane: { "kind": "checklist", "title": "Checklist" }`.

`newFlow` starts every flow on it. A declared workflow's claimed skill replaces it as any other claim does; `movedUpFrom` stays null for a move up from the Checklist flow. The flow's `unclaimedWork` means: a live turn with agent work ended while the flow was on the Checklist flow and a registered workflow sets `flagsUnclaimedWork`; with none, a working session on the Checklist flow is never tagged. A saved flow whose workflow no plugin declares any more (a retired id, an uninstalled plugin) opens on the Checklist flow with its checklist; one `workflow.off` switched off keeps its workflow.

The agent sends its list with `set_workflow_checklist`, which the engine contributes to every session at all times. The `auri` plugin's checklist hook asks the app, over the relay's hook protocol, whether the session's row ever reported a checklist: the engine answers from the flow's `checklistReported` field, which the first `checklistReported` signal sets and no claim resets. A checklist report folds whatever the flow's workflow id, a workflow not registered (switched off, uninstalled, not loaded yet) included, so the gate never sticks shut. The hook denies an edit until then, reminds the agent at a turn end while items are open, and shows the step and the list again after a compaction. It recognises an app session by `WIGLEY_SESSION_ROW`.

`set_workflow_step` lists the union of the `step` values of every enabled declared workflow, each once, in workflow order then stage order. The Checklist flow adds none. With no enabled workflow declaring a step, no step tool is contributed. The engine contributes the tool again whenever a workflow is added, removed, switched on or switched off. A step the flow's own workflow does not declare succeeds with text saying so, as today. The tool's description names no plugin: "Set this session's step in its workflow, so the app shows it."

## Names and types

Sketches only: names, fields and signatures. `JsonValue` is defined in `src/contracts/contributions.ts`.

### The agent plugin (`src/shared/agent-plugin.ts`)

```ts
export const AGENT_PLUGIN_NAME = 'auri';
export const AGENT_SERVER_NAME = 'auri';
export const AGENT_PLUGIN_FOLDER = 'agent-plugin';
export const APP_PLUGIN_KEY = 'auri@app';
export const CONTRIBUTIONS_FILE = 'auri.json';
export const CONTRIBUTIONS_VERSION = 1;
// `mcp__plugin_<plugin>_<server>__<tool>`
export function claudePluginToolName(plugin: string, server: string, tool: string): string;
// <appDir>/agent-plugin
export function agentPluginDir(appDir: string, paths: Paths): string;
```

`RELAY_SERVER_NAME` (`src/shared/platform.ts`) becomes `AGENT_SERVER_NAME`, and `CLAUDE_PERMISSION_TOOL` becomes `claudePluginToolName(AGENT_PLUGIN_NAME, AGENT_SERVER_NAME, PERMISSION_TOOL_NAME)`.

### The file (`src/contracts/contributions.ts`)

```ts
type FeatureKey = 'workflows' | 'planFormat' | 'retro' | 'backlog' | 'docs' | 'liveView';

interface AuriFile {
  $schema?: string;
  version: 1;
  workflows?: WorkflowDecl[];
  planFormat?: PlanFormat;
  retro?: RetroContribution;
  backlog?: BacklogContribution;
  docs?: DocsContribution;
  liveView?: LiveViewContribution;
}

interface WorkflowDecl {
  id: string; label: string; badge: string; badgeColor?: string; order: number;
  claims: string[];
  groups?: Record<string, string[]>;
  counters?: Record<string, CounterDecl>;
  fixCycles?: { counter: string } | { planCounter: string };
  sidePane: { kind: 'checklist' | 'plan'; title: string };
  actions?: Record<string, ActionDecl>;
  stages: StageDecl[];
}
interface StageDecl {
  id: string; label: string; step?: string;
  inStepper?: boolean; slot?: string; runsTasks?: boolean;
  status: 'busy' | 'finishing' | 'ready' | 'none';
  finishes?: boolean; reopens?: boolean; records?: string[];
  enter: TriggerDecl[];
  progress?: string; chipProgress?: string; detail?: string[];
  rowActivity?: ActivityDecl; unseenActivity?: ActivityDecl;
  actions?: string[]; auto?: string;
}
type TriggerDecl =
  | { skill: string; from?: string[]; when?: PredicateDecl[]; clearsPlan?: true; planFromArgs?: true }
  | { step: string; from?: string[]; when?: PredicateDecl[] }
  | { event: string; from?: string[]; when?: PredicateDecl[]; clearsPlan?: true };
type PredicateDecl = 'idle' | 'busy' | 'planRead' | 'planHasTasks' | 'planOpen' | { counterRose: string };
interface CounterDecl { counts: string; resetOn: 'claim' }
interface ActivityDecl { word: string; tone: ActivityTone; emphasis?: RowEmphasis }
interface ActionDecl {
  kind: 'send' | 'clearAndSend' | 'launch' | 'openPlan' | 'event';
  label: string; text?: string; event?: string; then?: string;
  keyOnly?: true; risky?: true; key?: string;
  available?: PredicateDecl[]; enabled?: PredicateDecl[];
}

interface PlanFormat {
  folder?: string; file?: string; tasksSection?: string;
  groupHeading?: { pattern: string; title: string };
  titleSuffix?: string;
  counters?: Record<string, { section?: string; heading: string; itemPrefix: string }>;
  taskDocs?: { link: 'bareMd'; statusField: string; statusLines: number; statuses: string[]; running: string };
  verificationTask?: { lastTaskDocLacking: string };
}
interface RetroContribution { label?: string; command: string; folder: string; on: ('close' | 'clear')[] }
interface BacklogContribution {
  label?: string; homes: string[]; file: string; areaFolder?: string; assistant?: { instructions: string };
}
interface DocsContribution {
  globalFolders?: { path: string; referenceFiles?: string[]; subfolders?: string[]; skip?: string[] }[];
  wikiMain?: string;
  linkPrefixes?: Record<string, string>;
}
interface CommandPattern {
  program: string; words: string[]; valueFlags?: string[];
  projectPathFlag?: string; projectPathVariable?: string;
}
interface LiveViewContribution {
  open: CommandPattern[]; close: CommandPattern[];
  probe?: { file: string; entry: string; runner: 'unityScript' };
}
```

These are the file's types. A reader's output may add resolved fields (an absolute probe path, a qualified workflow id) in its own plugin's `contract.ts`.

### The registry (`src/plugins/contributions/contract.ts`)

```ts
interface ContributionSource {
  pluginName: string;     // 'wigley'
  pluginKey: string;      // 'wigley@wigley-ai-marketplace', or APP_PLUGIN_KEY
  version: string | null;
  root: string;           // the plugin's root folder, real path
  harnessId: string | null; // null for the app's own plugin
}
type ReadResult<V> = { ok: true; value: V } | { ok: false; reasons: string[] };
interface FeatureReader<V> {
  label: string;          // 'Retro', as Settings shows the feature
  read(section: unknown, source: ContributionSource): ReadResult<V>;
}
interface Strategy<V> { id: string; label: string; source: ContributionSource; value: V }
interface FeatureStrategies { key: FeatureKey; label: string; strategies: Strategy<JsonValue>[] }

interface ContributionsMainExports {
  registerFeature<V>(key: FeatureKey, reader: FeatureReader<V> & JsonSlot<V>): Disposable;
  strategies<V>(key: FeatureKey): readonly Strategy<V>[];
  onChanged(key: FeatureKey, listener: (strategies: readonly Strategy<unknown>[]) => void): Disposable;
  ready: Promise<void>;
}
const contributionsMainKey: DependencyKey<ContributionsMainExports, 'main', 'contributions'>;
const contributionsFeaturesSlot: KeyedSlotKey<FeatureStrategies, 'main', 'contributions'>;

type StrategyPick<V> =
  | { kind: 'picked'; strategy: Strategy<V> }
  | { kind: 'none' }
  | { kind: 'choose'; ids: string[] }
  | { kind: 'missing'; id: string };
function pickStrategy<V>(strategies: readonly Strategy<V>[], setting: string): StrategyPick<V>;
function strategyControlKind(key: FeatureKey): string;      // 'strategy:retro'
const WORKFLOW_LIST_CONTROL_KIND = 'strategy-list:workflows';
```

### Config problems (main service)

```ts
// services.configProblems, main only, a per-plugin view: a stop clears the plugin's problems.
interface ConfigProblemsService {
  set(problems: readonly ConfigProblem[]): void;   // replaces this plugin's problems
}
```

The ConfigStore serves them after the plugin catalog's problems.

### The workflow engine (`src/plugins/workflow/contract.ts`)

```ts
const CHECKLIST_WORKFLOW_ID = 'checklist';
const CHECKLIST_WORKFLOW: WorkflowDecl;
function qualifiedWorkflowId(pluginName: string, id: string): string;          // 'wigley:large'
function actionCommandShortId(workflowId: string, actionId: string): string;  // 'wigley-large-clearAndMake'

interface DeclaredWorkflow {      // the workflows reader's value, one per declaration
  id: string;                     // qualified
  pluginName: string;
  decl: WorkflowDecl;
  planFormat: PlanFormat | null;  // the same plugin's planFormat
}

interface SessionFlow {           // fields added to today's
  checklistReported: boolean;
  plan: PlanState | null;
  counters: Record<string, number>;
  enteredFrom: StageId | null;    // the stage a finishing stage was entered from
  countdownEndsAt: number | null;
}
interface PlanState {
  dir: string | null;
  reported: boolean;
  unreportedDir: string | null;
  progress: PlanProgress | null;
  snapshots: Record<string, number>;  // plan counter → value at the last `records` stage
}
interface PlanProgress {
  title: string; checked: number; total: number; wave: number | null;
  counters: Record<string, number>;
  tasks: PlanTaskLine[];
}
interface PlanTaskLine {
  group: number | null; text: string; done: boolean;
  file: string | null; status: string | null; verification: boolean;
}
function readPlan(text: string, taskDocs: ReadonlyMap<string, string>, format: PlanFormat): PlanProgress;
```

`WorkflowMainExports.addWorkflow` and `WorkflowPageExports.addWorkflow` stay as the engine's internal seam, called by the workflows reader for each `DeclaredWorkflow`. `LargeState` and `MediumState` go: their fields move to `SessionFlow.plan`, `SessionFlow.counters`, `enteredFrom` and `countdownEndsAt`.

### Setting paths

| Path | Default | Control kind |
|---|---|---|
| `auto-retro.strategy` | `''` | `strategy:retro` |
| `backlog.strategy` | `''` | `strategy:backlog` |
| `workflow.off` | `[]` | `strategy-list:workflows` |
| `workflow.autoStart` | `[]` | `json` |
| `workflow.layout` | `'default'` | `layout` |

Removed: `auto-retro.folder`, `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds`, and the four `workflow-*.layout` settings. The change that removes them edits `~/.config/wigley-ai-gui/settings.json` to match and names each orphaned user layout under `layouts/workflow-*/`.
