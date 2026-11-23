# Layouts everywhere

**Contents**

- **Intent** — every surface of the app draws through a user-editable layout.
- **Shape** — the core layout service, the page host, and what each adopter supplies.
- **Folder and settings** — where layout files live and how one is picked.
- **Live defaults** — each built-in `default` read from the repo clone and reloaded live, the bundled copy as fallback.
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

 <repo clone>/src/plugins/<id>/layouts/default/   (the shell: src/renderer/shell/layouts/default/)
              │ watched beside the user folder; served as `<owner>/default/` on the same scheme
              └─▶ the live default, drawn over the bundled default, which stays the fallback
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
  plain JS under `// @ts-check`, with its look in `layouts/default/layout.css`. A user layout defines only the parts
  it changes.

## Folder and settings

- Layouts live in `~/.config/wigley-ai-gui/layouts/<owner>/<name>/`, shared by the stable and dev apps. `<owner>` is
  a plugin id or `shell`. The self-test and a drive run use the config folder in their own temp home.
- Each app writes `layouts/kit.d.ts` (the shared kit types) and `layouts/<owner>/layout.d.ts` at start; the app
  started last wins. A layout that breaks under the
  other app's contract falls back to `default` there, as any throwing part does.
- Each owner has its own setting naming its layout: `<plugin>.layout` for a plugin, the core setting `shell.layout`
  for the shell, `default` when unset. Forms keeps its per-round and per-item `layout` fields over its setting.
- The old plugin data `layouts/` folders are not read. They held only generated `layout.d.ts` files.

## Live defaults

The user changes a built-in `default` the same way as a user layout: edit its files, and the running app redraws.
Both the stable and the dev app read each owner's `default` from the repo clone's working tree, so an uncommitted
edit shows at once, and the committed edit ships as the next build's bundled copy.

- **The clone.** `npm run install-app` bakes the clone's path into the stable build; the dev app reads its own repo.
  Whatever branch the clone has checked out is what shows, so the stable app can run a `layout.js` that uses kit
  members its installed build lacks; a part that calls one throws and draws the bundled part until the next install.
- **The folder.** A plugin's default is `src/plugins/<id>/layouts/default/` in the clone, derived from its plugin id;
  the shell names `src/renderer/shell/layouts/default/` when it registers. A user folder named `default` stays
  ignored.
- **Reload.** Main watches each owner's default folder beside its user folder, only when the folder exists at start,
  and a saved `layout.js` raises the default's revision and a saved `layout.css` its style revision, like any layout's; a folder that gains
  `layout.js` after start goes live at revision 2. The page loads it on the same `wigley-layout:` scheme, as
  `<owner>/default/`, and redraws. The renderer dev server ignores `**/layouts/default/**`, so this path is the only
  redraw of a default in either app.
- **CSS.** A default's `layout.css` holds the rules for what that layout draws. It loads through one stylesheet link
  of its own, kept whichever layout is picked (a user layout draws its missing parts from the default), and placed
  before the user layouts' links. The loader appends the link to the document head after all page and kit CSS, which
  load with the page's bundle, so a page-CSS rule that overrides a default-look rule at equal specificity loses to the
  default's rule; win it by raising the override's specificity or by putting the override in the default's
  `layout.css`. The link carries the live `layout.css` while a live default is loaded, else the bundled copy, which
  ships as a file the loader links and the build never inlines; the link is attached only while it has an href, so a
  rule deleted live is gone. CSS for parts the app draws itself (slots, panes, editors, text boxes) stays in the
  plugin's page CSS and still needs a rebuild. Chat's side parts holder is the one exception: the width at which it
  hides sits in chat's default `layout.css`, editable live.
- **Fallback.** A missing clone draws the bundled default; a default that fails to load or read keeps its last good
  live version, else the bundled default. A live default must define every function part the bundled default
  defines; a missing part fails the load with `layout default has no <part>`. A load, read or missing-part failure
  raises the toast a failed user layout raises; a part that throws while drawing logs and draws the bundled part, as a
  user layout's part does.

## What a layout draws

A layout draws every pane, and every repeated row, card or entry of its owner's views. The app keeps:

- selection and the cursor (`is-selected`, `is-cursor`, `is-pane-inactive`)
- keys, scopes and key anchors, which a layout places through its kit (`keyHint`, `keysFor`)
- scrolling and split widths
- text boxes and editors, which a layout places through `kit.textBox`; the app appends any box a layout leaves out
- the lifecycle of dialogs, prompts and toasts: the scrim, showing and hiding, keys, focus, timing and removal; the
  layout draws their frames and bodies (each owner's `dialogFrame` and `confirmBody`, and the shell's `toast`)
- the saved state a status line shows, which a layout places through its kit (`saveStatus`)
- which keys a cursor row's prompt shows; the layout draws each one from its input through `kit.keyHint`: the row's
  `prompt`, or, where the row is kept across a cursor move (settings, notes), the `cursorPrompt` part's `actions`; and forms' review row and notice line carry their prompts inside the kit's part

A layout's CSS restyles only under its own root: every part root carries `data-layout="<name>"` and
`data-layout-owner="<owner>"`, so two owners' layouts of one name never share selectors. The default's
`layout.css` is the exception: it keeps the page CSS's unscoped selectors and is linked whichever layout is picked,
so it also styles a user layout's parts that carry its classes. The shell's frames are
CSS-only: the five chrome areas (`CHROME_AREAS`: title bar, activity bar, side bar, right bar, status bar) carry the
shell layout's attributes, and its JS parts draw only what the core puts in them. The app-wide look of the primitives
stays in themes.

Chat's entries take one source between a user layout and `default`: the renderers plugins add through chat's
`addEntryRenderer`. An entry draws with the user's layout when it names the entry's kind, else with the latest-added
renderer whose `kind` matches and whose `match` passes, else with `default`, which draws a harness kind
(`<harness id>:<kind>`) with its `raw` builder. A renderer that throws draws with `default`, as a user layout's builder
does.

## Adopters

| Owner | Setting | Surfaces |
| --- | --- | --- |
| `shell` | `shell.layout` | the title bar's context, dev tag and config problems; each mode's activity bar item; each toast; the five chrome frames take the layout's CSS |
| `forms` | `forms.layout` | question, finding and notice cards, `cards.kinds` (a card per plugin kind id) and `cards.other` (the card of a plugin kind with no `kinds` builder); head, rail, review and notices panes; the rail's head and foot strips (`railHead`, `railFoot`) and the item pager (`pager`); the cancel prompt's frame (`dialogFrame`) and body (`confirmBody`), picked by the setting alone |
| `chat` | `chat.layout` | chat entries; the activity line (a run of the agent's steps, drawn only under a layout that sets `activityInTranscript`); the activity dock (the running turn, then its finished line) and its one-line `workingLine`; the session hub's section frame and its Session header; the composer and its status line, a `/` completion row's description (`completionDescription`), the attachments, the picker rows and section headings (start prompt and pickers), the sign-in, deny-reason and end-session dialogs, the image viewer, each session's run time and profile on its side-bar row (`rowClock`, `rowProfile`) |
| `primer` | `primer.layout` | feature, task and item cards; tasks, items and review panes; the column strips (`tasksHead`, `itemsHead`, `tasksFoot`, `cardEdge`, `reviewFooter`); the cancel confirm's frame (`dialogFrame`) and body (`confirmBody`) |
| `audio-picker` | `audio-picker.layout` | the head, moment, candidate, None of these and notes parts; the cancel prompt's frame (`dialogFrame`) and body (`confirmBody`) |
| `docs` | `docs.layout` | the tree, its rows and its Wiki and All pages switch; the rendered doc, its page frame and right column, header, disk banner, section edit control and editor frame; Recent changes and the missing Main page's empty state; the list pages and their rows; the box and confirm dialogs, the create dialog's completion and picker rows |
| `backlog` | `backlog.layout` | the table and its filters, rows and empty text, the review pane with its item and commits, the chunk strip with its chunk and New chunk cards, and the picker rows |
| `work-inbox` | `work-inbox.layout` | the side bar (its pane and a row per section, `sideBar` and `sectionRow`), the main pane's head (`main`), the job status line and its problem line (`status`, `problem`), the ticket filter chip (`filter`), the cards with the draft box slot (`card`) and the empty text (`empty`) |
| `work-board` | `work-board.layout` | the board's head and status line (`board`, `status`), the columns (`column`), the Jira and local cards with their suggestion and moving lines (`card`), and the empty text (`empty`) |
| `practice` | `practice.layout` | the problem list (its pane, header, rows and empty state) in the side bar; the problem column's three stacked panes (problem, editor, console) and the no-problem state; the problem pane's tabs (description, submissions with their rows and a submission's code, notes, solution), the console's Testcase and Result tabs, a case's result, the Solution confirm body (`confirmBody`), the import dialog's body (`importBox`), and the frame of both dialogs (`dialogFrame`) |
| `scoped-agents` | `scoped-agents.layout` | the agent pane's ask box (`askBox`), drawn for Practice's interviewer and Backlog's assistant |
| `scheduling` | `scheduling.layout` | Schedules mode: the task list in the side bar (the "+ New task" row, a row per task), the details sheet (its notices, the task's details and buttons or the empty state, its history rows), the task editor and its field rows, the picker rows, and the confirm's frame (`dialogFrame`) and body (`confirmBody`). The Scheduled runs section in the Sessions side bar draws through `sessions.layout` |
| `settings` | `settings.layout` | the section list, the setting, plugin, key, leader and advanced rows, the Leader menu's panes, group, item and add rows, the Keybindings section's filter chips, the problem line, the picker rows; a setting row's `control` is the string id of its kind, which a layout may ignore, as the app draws the row's box or picker |
| `notes` | `notes.layout` | the note popup: fields, tags, images, target, session, actions, markup toolbar, the confirm and picker rows |
| `sessions` | `sessions.layout` | the side bar's Favorites and Recent sections and every plugin's section (`addSection`), their project groups and the session rows in them, each session's tab strip, the session popup (`popup`) and its hidden bar (`popupBar`), where other plugins' row and bar parts sit, the rename dialog's frame (`dialogFrame`) and body (`renameDialog`), the split picker's rows |
| `agent-lines` | `agent-lines.layout` | the working line under each session row while it runs a subagent or task |
| `session-stash` | `session-stash.layout` | the stash dialog's frame (`dialogFrame`) and body (`noteDialog`): the session's name, the note box and the hint |
| `auto-retro` | `auto-retro.layout` | the Retro section's header part: the count of closes still queued |
| `unity-pool` | `unity-pool.layout` | the clone badge under each session row that holds a clone or waits for one; the right-bar pool panel |
| `chatroom` | `chatroom.layout` | Chatroom mode's side bar (`sideBar`: the rooms and their threads), the room's board with the shown thread's heading (`board`), each message of the log (`message`) and the composer (`composer`); the unread badge under each session row (`rowBadge`) |
| `system-stats` | `system-stats.layout` | the right-bar system stats panel: its section header, the five meter rows with their sparklines, and the process list's group and process rows |
| `agent-strip` | `agent-strip.layout` | the agent strip above the Chat composer's box: subagent cards and task rows, a box opened in place |
| `live-view` | `live-view.layout` | the session hub's Live section: its line and button above the stream, and the place the stream's video goes |
| `agent-skills` | `agent-skills.layout` | the session hub's Skills section: a chip per skill, grouped by namespace |
| `context-sources` | `context-sources.layout` | the session hub's Context section: the sources' bar, the window's fill and a row per source with its items, the largest five until the more line shows them all |
| `gallery` | `gallery.layout` | each primitive's sample block |
| `usage` | `usage.layout` | the status-bar line (plan rows), each session's context meter and cache mark on its row, each session's context line (context bar, cache countdown) above the Chat box and its spend in the Chat status line; its whole usage line in each tab bar, through the optional `usage-tab-line` plugin; the right-bar details |
| `keys` | `keys.layout` | the help overlay, the which-key shelf, the leader search's rows, the title bar's Keys button |
| `workflow` | `workflow.layout` | one layout every declared workflow draws with: the status chip under each session row (the level's badge and the stage), the strip above the Chat composer (the stepper's trail and the main action), the side pane beside the transcript (a plan workflow's status, plan checklist by wave and actions; any other's status, count and flat checklist) |
| `visual` | `visual.layout` | the "drawing visual…" card of an open html block, each closed block's visual around its frame with its widen and expand controls, and the full-size overlay |

Each owner's `layout.d.ts` names its parts exactly.

## Previews

A view that needs agent or session data has a built-in sample, opened under `Space z l` with no agent, so a layout
can be iterated in place. The sample sends nothing and raises no notification or badge.

| Keys | Sample |
| --- | --- |
| `Space z l o` | forms: the preview round, then each saved real round |
| `Space z l p` | primer: a sample primer holding every field and need |
| `Space z l c` | chat: a session of every entry kind, idle after a finished turn, so the activity dock shows that turn's finished line (the preview holds a `result` entry); its result entry as a turn divider; its steps, grouped into finished activity lines, show in the transcript only under a layout that sets `activityInTranscript`; the agent strip above the composer; the session hub's Live section, streaming a sample test card; the session hub's Skills section, one skill by `main` and one by a subagent; and a paused run time on its row |
| `Space z l s` | sessions: rows in every state |
| `Space z l a` | agents: a sample session with two running subagents and two tasks; with the default `plugins.disabled` the row opens with no working line, and `agent-lines` on draws it |
| `Space z l w` | workflow: Large's sample session in every stage, the plan-ready countdown included |
| `Space z l m` | audio picker: a sample picker of three moments, every play format, and a file that will not decode |
| `Space z l r` | chatroom: a sample room in Chatroom mode, its board of two sessions and a claim, and a thread holding a message of every post and entry kind, one question to the user still open; the composer posts nothing |

## The primer's columns

- **Tasks part** (`tasks`): the Feature row, then the tasks under their group headers, with the `A add` prompt;
  `TasksKit.taskRow` gives each row. `j` / `k` walk these rows only.
- **Items part** (`items`): the selected task's items, each with its include mark, its number and its text, or the
  empty state when the Feature row or a task with no items is selected; `ItemsKit.itemRow` gives each row. `j` / `k`
  walk these rows only. `x` on an item row toggles its include mark; `y` / `n` / `u` set its task's need.
- The app keeps the two nested splits, their widths and their handles' resize prompt. Each column's header strip
  (`tasksHead`, `itemsHead`), the tasks column's foot (`tasksFoot`), the card's edge strip (`cardEdge`) and the review
  pane's footer (`reviewFooter`) are parts of their own.
- **Task card** (the tasks column focused on a task row): heading, tags and need; Question, Evidence, Probes and Pointer when not
  blank; an extra task's name box; the add-item box; the task comment. It lists no items.
- **Item card** (the items column focused on an item row): the header `⌃H ‹ 2 of 3 › ⌃L`, the item text as heading (on an item
  the user added, its text box, `ItemKit.textBox(parent, 'text')`, in the heading's place), the include mark, an Added tag on
  an item the user added, and the item's comment box.
- The review pane does not change.

## Decisions

- **A reload keeps the user's place.** A layout reload keeps every text box alive and moves it into the redrawn part,
  so its text, cursor, vim mode and undo survive, as chat's composer box always has.
  `src/shared/page/editor-boxes.ts` holds each box's frame and editor: a redraw releases the boxes the old draw placed
  and places them again, and destroys a box it does not place again. Forms, the primer and the audio picker redraw only
  the cards, panes and strips whose picked layout changed; the primer's and audio picker's cancel prompts draw again
  on every reload, and forms' only when its pick changed. A save that changes only a layout's `.css` files raises its style revision
  alone, which re-links `layout.css` with no redraw; a stylesheet the layout's own JS loads follows the module's
  revision, so a save of it shows only after a code file is saved too. A page reload restores chat's draft and the attached images from chat's page slots
  (`chatPlaceSlot`, `chatDraftImagesSlot`). Boxes are kept, not snapshotted: a snapshot through `TextEditor` would
  lose undo and add two members every editor fake carries.
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
  list picker, the confirm prompt and the dialog expose hooks (`drawRow`, `drawBody`, `drawFrame`) that each owner
  fills, so shared code names no owner. `drawFrame` is required, so the compiler finds a dialog opened with no
  layout.
- **CSS stays inside the layout's root.** Restyling a primitive app-wide from a layout is out of scope: themes carry
  the app-wide look, and a layout rule selects under its own `data-layout` root; the default's `layout.css` keeps
  the page CSS's unscoped selectors and is linked under every pick.
- **Defaults load live from the repo clone, not a config override.** The user is the app's only user and wants every
  look change in the shipped app, so the repo edit is the live edit and the shipped edit, with no second copy to
  carry over. The bundled copy keeps the app drawing when the clone is missing or broken.
- **Only a layout's own look reloads live.** App-drawn parts keep their CSS in the page bundle, chat's side parts
  holder's hide width aside: a part that needs a live look becomes a layout part, rather than gaining a second live
  path for plugin CSS.

## Out of scope

- Restyling or replacing primitives app-wide from a layout; themes carry the app-wide look.
- Reading layouts from the old plugin data folders.
