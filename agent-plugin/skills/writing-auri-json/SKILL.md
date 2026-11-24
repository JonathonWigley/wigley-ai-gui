---
name: writing-auri-json
description: "Writing an agent plugin's `auri.json`, the file that binds the Auri app's generic features — workflows, plan format, retro, backlog, docs and live view — to a plugin's own skills, folders and commands. Use when creating or changing an `auri.json`, declaring a workflow, when the app shows a config problem naming a plugin, or when a feature shows its empty state though a plugin should bind it."
---

**Contents**

- **Intent** — one data file, read by the app, that names everything personal.
- **The file** — where it sits, `version`, `$schema`, and the top-level keys.
- **How the app reads it** — sources, hot reload, problems, and strategy picks.
- **workflows** — workflow, stage, trigger, predicate, counter, action and template fields.
- **planFormat** — the plan reader's knobs.
- **retro** — the auto-retro command, folder and triggers.
- **backlog** — features homes, the follow-ups file, the assistant's extra instructions.
- **docs** — global folders, the wiki main page, skill link prefixes.
- **liveView** — command patterns and the probe.
- **Checking it** — what done looks like.

## Intent

The Auri app names no plugin, skill or personal folder. Each generic feature reads its bindings from the `auri.json`
files of the installed agent plugins, and shows an empty state when none binds it. A good `auri.json` is plain data —
no code — that makes the plugin's workflow run in the app exactly as the plugin's skills expect, and loads with no
config problem.

## The file

- It sits at the plugin's root, beside `.claude-plugin/plugin.json`. No manifest field names it.
- `"version": 1` is required. A file with another version loads none of its sections.
- `"$schema"` is optional, and the app ignores its value. The app writes the file's JSON schema at each start to
  `~/.config/wigley-ai-gui/plugins/_types/auri.schema.json`: point `$schema` there for editor checks.
- Every other top-level key is a **feature key**: `workflows`, `planFormat`, `retro`, `backlog`, `docs`, `liveView`.
  A key no feature reads is ignored and logged.
- No path field resolves against the working folder: a path starts with `/` or `~`, or is relative to the plugin's
  root where its field says so.

## How the app reads it

- **Sources.** The app reads every install in each Claude Code profile's `plugins/installed_plugins.json`, and its own
  `auri` plugin. A plugin's **name** is its key before `@` (`acme` from `acme@acme-marketplace`). It prefixes the
  plugin's skills and qualifies its workflow ids (`acme:large`). Two installs of one name keep the highest version.
- **Hot reload.** A change to an `auri.json`, or to an installed-plugins list, reloads every feature within a second.
  A plugin installed from a marketplace is read from its install folder, so an edit in the source clone reaches the
  app only after the plugin updates.
- **Problems.** A file that is not JSON, or has a wrong `version`, shows one config problem in the title bar. A
  section its feature refuses shows one problem per section, naming the path to the bad field, such as
  `acme: workflows[2].stages[4].enter[0]: "from" names no stage or group: featureRun`. The plugin's other sections
  still load.
- **Picks.** `retro` and `backlog` run one plugin's section at a time: with one installed it runs; with several, the
  user picks one in Settings (`auto-retro.strategy`, `backlog.strategy`). `docs` and `liveView` merge every
  plugin's section. Each declared workflow runs unless the user switches it off in Settings (`workflow.off`).
  `planFormat` is read per workflow, from the workflow's own plugin.

## workflows

An array of workflow declarations. Each replaces the app's built-in Checklist flow for a session once one of its
claimed skills loads (`workflows-and-checklist` skill).

| Workflow field                 | Meaning                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | Unique in the plugin; qualified as `<plugin name>:<id>`.                                                                                                                    |
| `label`, `badge`, `badgeColor` | The workflow's word, the row's letter, and a CSS colour or theme token (default `var(--wg-accent)`).                                                                        |
| `order`                        | The lowest order wins a skill two workflows claim.                                                                                                                          |
| `claims`                       | The skills that start this workflow (`acme:small`). Each appears in exactly one stage's `skill` trigger.                                                                    |
| `groups`                       | Named stage lists for `from`: `{ "planning": ["explore", "plan"] }`. A group name may not equal a stage id.                                                                 |
| `counters`                     | `{ "<name>": { "counts": "<stage id>", "resetOn": "claim" } }`: adds one each time the flow enters the stage from another; 0 when the workflow's own skill claims the flow. |
| `fixCycles`                    | `{ "counter": "<name>" }` or `{ "planCounter": "<name>" }`: the run log's fix cycles.                                                                                       |
| `sidePane`                     | `{ "kind": "checklist" \| "plan", "title": "…" }`.                                                                                                                          |
| `actions`                      | Actions by id (below).                                                                                                                                                      |
| `stages`                       | Stage declarations, in stage order.                                                                                                                                         |

| Stage field                          | Meaning                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `id`, `label`                        | Unique id; the step's word.                                                                                         |
| `step`                               | The value `set_workflow_step` enters this stage by. Left out, no report enters it.                                  |
| `inStepper`, `slot`                  | Default `true`; stages sharing a slot take one place in the stepper.                                                |
| `status`                             | `busy`, `finishing`, `ready` or `none`.                                                                             |
| `runsTasks`                          | The plan's current group draws the stage's status.                                                                  |
| `finishes`, `reopens`                | Entering it ends the run; a `planChanged` while busy returns the flow to the stage it came from.                    |
| `records`                            | Plan counters to snapshot on entry, for `counterRose`.                                                              |
| `enter`                              | Triggers, in order.                                                                                                 |
| `progress`, `chipProgress`, `detail` | Templates after the status text, on the row chip, and in the side pane (joined by `·`).                             |
| `rowActivity`, `unseenActivity`      | `{ "word", "tone", "emphasis"? }` shown on the row while the stage waits, or until the user views a finished turn.  |
| `actions`, `auto`                    | Action ids, the main one first; an action the countdown runs on entry when `workflow.autoStart` lists the workflow. |

**Triggers** — `{ "skill": "<skill>" }`, `{ "step": "<step>" }` or `{ "event": "<event>" }`, each with optional `from`
(stage ids and group names the flow must be in) and `when` (predicates that must all hold). A `skill` trigger may add
`clearsPlan` and `planFromArgs`; an `event` trigger may add `clearsPlan`. Stages are tried in order, and the first
match wins. A `skill` trigger matches while the flow is already in its stage, which re-enters it; a `step` or `event`
trigger does not.

**Events** — `turnEnded`, `planChanged`, `planGone`, or any name an `event` action or a `launch` action's `then` sends.

**Predicates** — `idle`, `busy`, `planRead`, `planHasTasks`, `planOpen`, `{ "counterRose": "<plan counter>" }`.

**Actions** — `{ "kind", "label", "text"?, "event"?, "then"?, "keyOnly"?, "risky"?, "key"?, "available"?, "enabled"? }`.
`send` sends `text`; `clearAndSend` clears the session first; `launch` starts a new session with `text`; `openPlan`
opens the plan file; `event` folds `event` into the flow. `available` decides whether it shows and `enabled` whether
it runs. Each action becomes an app command, `workflow.<plugin>-<id>-<action>`, and `key` binds it
(`"<Leader>wn"`).

**Templates** — `{plan}`, `{plan.title}`, `{plan.checked}`, `{plan.total}`, `{plan.build}`, `{plan.wave}`,
`{plan.counter.<name>}`, `{counter.<name>}`, `{checklist}`. A template whose every variable is empty renders `''`,
and a command whose `{plan}` is empty does not run.

A minimal workflow:

```json
{
  "id": "small",
  "label": "Small",
  "badge": "S",
  "order": 10,
  "claims": ["acme:small"],
  "sidePane": { "kind": "checklist", "title": "Checklist" },
  "stages": [
    {
      "id": "scope",
      "label": "Scope",
      "status": "busy",
      "enter": [{ "skill": "acme:small" }]
    },
    {
      "id": "build",
      "label": "Build",
      "step": "build",
      "status": "busy",
      "progress": " {checklist}",
      "enter": [{ "step": "build" }]
    },
    {
      "id": "done",
      "label": "Done",
      "step": "done",
      "status": "finishing",
      "finishes": true,
      "enter": [{ "step": "done" }]
    }
  ]
}
```

## planFormat

How a workflow with the plan capability reads its plan. Every knob is optional; with none, the reader reads a plain
checklist: every box in the file, no groups, the title from the first `# ` heading.

| Knob               | Meaning                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`           | Glob for a plan folder's name (`plan-*`). A write of `<folder>/<file>`, or a `planFromArgs` argument naming it, sets the plan. Default: reports only. |
| `file`             | The plan file in the folder. Default `plan.md`.                                                                                                       |
| `tasksSection`     | The H2 heading whose boxes count, exact text. Default: the whole file.                                                                                |
| `groupHeading`     | `{ "pattern": "^### Wave (\\d+)", "title": "Wave {1}" }`; capture 1 is the group number.                                                              |
| `titleSuffix`      | Text dropped from the end of the title.                                                                                                               |
| `counters`         | `{ "<name>": { "section"?, "heading", "itemPrefix" } }`: counts of list lines under a heading.                                                        |
| `taskDocs`         | `{ "link": "bareMd", "statusField", "statusLines", "statuses", "running" }`: a box's linked task document and the status read from it.                |
| `verificationTask` | `{ "lastTaskDocLacking": "<field>" }`: the last box whose task document lacks that field; `{plan.build}` leaves it out.                               |

## retro

| Field     | Meaning                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `label`   | The Settings choice's text. Default: the plugin name.                                                  |
| `command` | The retro row's first message. `{sessions}` is the ended conversation's session ids, joined by spaces. |
| `folder`  | The folder each retro row runs in; `~` is the home folder.                                             |
| `on`      | Which endings queue a retro: `close`, `clear`, or both.                                                |

## backlog

| Field        | Meaning                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `label`      | The Settings choice's text.                                                                                    |
| `homes`      | Folder templates for a repo's features home, in order: `{repo}` the clone root, `{name}` the origin repo name. |
| `file`       | The follow-ups file in a home.                                                                                 |
| `areaFolder` | Optional: a folder in a home holding per-area follow-up files.                                                 |
| `assistant`  | Optional `{ "instructions": "…" }`, added after the Backlog assistant's own instructions.                      |

The file format is the `backlog-format` skill's.

## docs

| Field           | Meaning                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globalFolders` | `[{ "path", "referenceFiles"?, "subfolders"?, "skip"? }]`: the docs index walks `path`'s top level as instructions, `referenceFiles` as reference, each subfolder in full, and leaves out `skip`. |
| `wikiMain`      | The wiki's main page. The first plugin that names one wins.                                                                                                                                       |
| `linkPrefixes`  | `{ "acme:": "acme@acme-marketplace" }`: a wiki link `acme:<skill>` opens that skill in the install with that key.                                                                                 |

## liveView

| Field           | Meaning                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `open`, `close` | Command patterns whose successful Bash call opens or closes the session's Live view.                                                 |
| `probe`         | Optional `{ "file": "<path from the plugin root>", "entry": "<C# entry>", "runner": "unityScript" }` (`live-view` skill, The probe). |

A command pattern is `{ "program", "words", "valueFlags"?, "projectPathFlag"?, "projectPathVariable"? }`. `program`
matches the base name of a command segment's first word (a `python` before a `*.py` program is skipped). `words` must
follow in order, once flags and the values of `valueFlags` are skipped. `projectPathFlag` and `projectPathVariable`
give the project folder.

## Checking it

The file is done when:

- it parses as JSON and holds `"version": 1`
- the app's title bar shows no config problem naming the plugin, after the plugin is installed or updated
- each feature it binds leaves its empty state: a declared workflow lists in Settings, a retro or backlog strategy
  shows as a choice, docs folders show in Docs mode
- a session that loads each claimed skill shows that workflow on its row
