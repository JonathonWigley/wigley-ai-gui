# Layouts everywhere

**Contents**

- **Intent** — every surface of the app draws through a user-editable layout.
- **Shape** — the core layout service, the page host, and what each adopter supplies.
- **Folder and settings** — where layout files live and how one is picked.
- **What a layout draws** — the parts a layout owns and the pieces the app keeps.
- **Adopters** — every surface, its setting and its parts.
- **Previews** — the `Space z l` samples for views that need agent data.
- **The primer's columns** — the tasks and items parts and the card per row.
- **Decisions** — why the layout system has this shape.
- **Out of scope** — what this work leaves alone.

## Intent

The user changes any part of the app's look by editing a layout file, and the running app redraws without a rebuild
or restart. Forms and chat had layouts; every other view was a fixed view built in code. Now every surface draws
through a layout: each plugin's views, the overlays and dialogs, and the shell chrome. A good outcome: a new look for
any surface is a `layout.js` (and an optional `layout.css`) in `~/.config/wigley-ai-gui/layouts/`, written in the dev
app and shown in the stable app with no copy.

## Shape

```
 ~/.config/wigley-ai-gui/layouts/<owner>/<name>/layout.js (+ layout.css, data, images)
              │ watched
   main: core LayoutService ── announces each owner's layout set (name → revision)
              │ served to the page on its own URL scheme, revision in the path
   page: layout host per owner
         pick (<owner>.layout setting → default) · validate (owner's reader) · draw
         · fall back to default on a throw · data-layout root · stylesheet link · redraw on reload
              │
   owner (a plugin, or the shell) supplies: contract text (layout.d.ts), default layout, reader, kit
```

- **One core service.** The layouts folder is core-owned, like `settings.json` and `themes/`, so main's
  `LayoutService` watches it and a plugin registers with `api.layouts`. The shell registers with the core directly.
  The registry and loader that forms and chat used over their own plugin data folders move behind this service.
- **One page host.** Everything forms and chat each held a copy of — serving and showing layouts, the reader
  skeleton (`readLayoutParts`), the pick chain, the parts factory (`createLayoutParts`), the app-element slot,
  rolling back a part that throws and drawing it with `default`, the command runner and the head kit's generic half —
  is one module, `src/shared/page/layout-host/`. An owner adds only its contract, its `default` layout, its reader
  and its kit parts. Every owner's kit extends the host's `BaseKit` (`kit.d.ts`), whose
  members every layout can use.
- **The owner's contract** is its `layouts/layout.d.ts`; its built-in `default` is `layouts/default/layout.js`,
  plain JS under `// @ts-check`. A user layout defines only the parts it changes.

## Folder and settings

- Layouts live in `~/.config/wigley-ai-gui/layouts/<owner>/<name>/`, shared by the stable and dev apps. `<owner>` is
  a plugin id or `shell`. The self-test and a drive run use the config folder in their own temp home.
- Each app writes `layouts/kit.d.ts` (the shared kit types) and `layouts/<owner>/layout.d.ts` at start; the app
  started last wins. A layout that breaks under the
  other app's contract falls back to `default` there, as any throwing part does.
- Each owner has its own setting naming its layout: `<plugin>.layout` for a plugin, the core setting `shell.layout`
  for the shell, `default` when unset. Forms keeps its per-round and per-item `layout` fields over its setting.
- The old plugin data `layouts/` folders are not read. They held only generated `layout.d.ts` files.

## What a layout draws

A layout draws every pane, and every repeated row, card or entry of its owner's views. The app keeps:

- selection and the cursor (`is-selected`, `is-cursor`, `is-pane-inactive`)
- keys, scopes and key anchors, which a layout places through its kit (`keyHint`, `keysFor`)
- scrolling and split widths
- text boxes and editors, which a layout places through `kit.textBox`; the app appends any box a layout leaves out
- dialogs' and prompts' lifecycle, the status lines and the saved state

A layout's CSS restyles only under its own root: every part root carries `data-layout="<name>"` and
`data-layout-owner="<owner>"`, so two owners' layouts of one name never share selectors. The shell's frames are
CSS-only: the five chrome areas (`CHROME_AREAS`: title bar, activity bar, side bar, right bar, status bar) carry the
shell layout's attributes, and its JS parts draw only what the core puts in them. The app-wide look of the primitives
stays in themes.

## Adopters

| Owner | Setting | Surfaces |
| --- | --- | --- |
| `shell` | `shell.layout` | the title bar's context, dev tag and config problems; each mode's activity bar item; the five chrome frames take the layout's CSS |
| `forms` | `forms.layout` | question, finding and notice cards; head, rail and review panes |
| `chat` | `chat.layout` | chat entries; the activity line (a run of the agent's steps); the composer and its status line, the attachments, the picker rows (start prompt and pickers), the sign-in, deny-reason and end-session dialogs, the image viewer |
| `primer` | `primer.layout` | feature, task and item cards; tasks, items and review panes |
| `docs` | `docs.layout` | the tree and its rows, the rendered doc, its header, disk banner and editor frame, the box and confirm dialogs, the create dialog's completion and picker rows |
| `backlog` | `backlog.layout` | the repo and home side bar, the follow-up list and its rows, the detail and editor panes, plans and features, the picker rows and the confirm body |
| `settings` | `settings.layout` | the section list, the setting, key, leader and advanced rows, the problem line, the picker rows |
| `notes` | `notes.layout` | the note popup: fields, tags, images, target, session, actions, markup toolbar, the confirm and picker rows |
| `sessions` | `sessions.layout` | the session rows in the side bar, each session's tab strip, where other plugins' row and bar parts sit, the rename dialog |
| `agent-lines` | `agent-lines.layout` | the running subagent and task lines under each session row |
| `agent-strip` | `agent-strip.layout` | the agent strip above the Chat composer's box: subagent and task boxes, a box opened in place |
| `gallery` | `gallery.layout` | each primitive's sample block |
| `usage` | `usage.layout` | the status-bar line (plan rows), each session's usage in the Chat status line (context bar, cache countdown, spend) and the right-bar details |
| `usage-tab-line` | `usage-tab-line.layout` | each session's line in its tab bar (context bar, cache countdown, spend) |
| `keys` | `keys.layout` | the help overlay, the which-key panel, the title bar's Keys button |
| `workflow` | `workflow.layout` | the stage chip under each session row, the strip above the Chat composer (stepper and actions), the Flow tab (stepper, plan checklist by wave, actions) |
| `visual` | `visual.layout` | the "drawing visual…" card of an open html block, each closed block's visual around its frame with its expand control, and the full-size overlay |

Each owner's `layout.d.ts` names its parts exactly.

## Previews

A view that needs agent or session data has a built-in sample, opened under `Space z l` with no agent, so a layout
can be iterated in place. The sample sends nothing and raises no notification or badge.

| Keys | Sample |
| --- | --- |
| `Space z l o` | forms: the preview round, then each saved real round |
| `Space z l p` | primer: a sample primer holding every field and need |
| `Space z l c` | chat: a session of every entry kind, its steps grouped into finished activity lines |
| `Space z l s` | sessions: rows in every state |
| `Space z l a` | agents: a sample session with two running subagents |
| `Space z l w` | workflow: a sample session in every stage, the plan-ready countdown included |

## The primer's columns

- **Tasks part** (`tasks`): the Feature row, then the tasks under their group headers, with the `A add` prompt;
  `TasksKit.taskRow` gives each row. `j` / `k` walk these rows only.
- **Items part** (`items`): the selected task's items, each with its include mark, its number and its text, or the
  empty state when the Feature row or a task with no items is selected; `ItemsKit.itemRow` gives each row. `j` / `k`
  walk these rows only. `x` on an item row toggles its include mark; `y` / `n` / `u` set its task's need.
- The app keeps the two nested splits, their widths and their handles' resize prompt, each column's header strip and
  the card's edge strip.
- **Task card** (the tasks column focused on a task row): heading, tags and need; Question, Evidence, Probes and Pointer when not
  blank; an extra task's name box; the add-item box; the task comment. It lists no items.
- **Item card** (the items column focused on an item row): the header `⌃H ‹ 2 of 3 › ⌃L`, the item text as heading, the include mark,
  an Added tag on an item the user added, and the item's comment box.
- The review pane does not change.

## Decisions

- **Core, not per plugin.** The layouts folder is core-owned and the shell is an owner with no plugin data folder, so
  layouts load on their own `wigley-layout:` scheme, not as a host on `wigley-data:`. A plugin never reaches the folder
  through `api.data`.
- **One setting per owner, no app-wide layout.** A user mixes looks: a chat layout beside the default primer. Only
  forms resolves a longer chain, `item layout → round layout → setting → default`, because an agent names layouts per
  round and per item; its resolver stays in forms. Every other owner's chain is `setting → default`.
- **One kit source.** The core writes `layouts/kit.d.ts`, and each owner's contract imports the shared types from it.
  A member an owner adds must not clash with `BaseKit`; `layout-contracts.test.ts` type-checks every contract against
  it.
- **A dialog follows its opener.** A dialog or prompt draws with the layout of the owner that opens it. The shared
  list picker and confirm prompt expose hooks (`drawRow`, `drawBody`) that each owner fills, so shared code names no
  owner.
- **CSS stays inside the layout's root.** Restyling a primitive app-wide from a layout is out of scope: themes carry
  the app-wide look, and a layout rule selects under its own `data-layout` root.

## Out of scope

- Restyling or replacing primitives app-wide from a layout; themes carry the app-wide look.
- Reading layouts from the old plugin data folders.
