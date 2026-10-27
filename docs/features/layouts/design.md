# Layouts everywhere

**Contents**

- **Intent** — every surface of the app draws through a user-editable layout.
- **Shape** — the core layout service, the page host, and what each adopter supplies.
- **Folder and settings** — where layout files live and how one is picked.
- **What a layout draws** — the parts a layout owns and the pieces the app keeps.
- **Adopters** — every surface, its setting and its parts.
- **Previews** — the `Space z l` samples for views that need agent data.
- **The primer's item cards** — the nested rail and the card per item.
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
  skeleton, the pick chain, rolling back a part that throws and drawing it with `default`, the command runner and the
  head kit's generic half — is one module in `src/shared/page/`. An owner adds only its contract, its `default`
  layout, its reader and its kit parts.
- **The owner's contract** is its `layouts/layout.d.ts`; its built-in `default` is `layouts/default/layout.js`,
  plain JS under `// @ts-check`. A user layout defines only the parts it changes.

## Folder and settings

- Layouts live in `~/.config/wigley-ai-gui/layouts/<owner>/<name>/`, shared by the stable and dev apps. `<owner>` is
  a plugin id or `shell`. The self-test and a drive run use the config folder in their own temp home.
- Each app writes `layouts/<owner>/layout.d.ts` at start; the app started last wins. A layout that breaks under the
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
CSS-only: the four chrome areas carry the shell layout's attributes, and its JS parts draw only what the core puts in
them. The app-wide look of the primitives stays in themes.

## Adopters

| Owner | Setting | Surfaces |
| --- | --- | --- |
| `shell` | `shell.layout` | title bar, activity bar, side bar frame, status bar |
| `forms` | `forms.layout` | question, finding and notice cards; head, rail and review panes |
| `chat` | `chat.layout` | chat entries; the composer, the start prompt, the pickers, the sign-in, deny-reason and end-session dialogs, the image viewer |
| `primer` | `primer.layout` | feature, task and item cards; rail and review panes |
| `docs` | `docs.layout` | the tree and its rows, the rendered doc and its status chips, the create dialog |
| `backlog` | `backlog.layout` | the repo and home side bar, the follow-up list and rows, the editor pane, plans and features |
| `settings` | `settings.layout` | the section list, the setting rows, the key rows |
| `notes` | `notes.layout` | the note popup: fields, images, target and pickers |
| `sessions` | `sessions.layout` | the session rows in the side bar, each session's tab strip |
| `gallery` | `gallery.layout` | each primitive's sample block |
| `keys` | `keys.layout` | the help overlay, the which-key panel, the title bar's Keys button |

Each owner's `layout.d.ts` names its parts exactly.

## Previews

A view that needs agent or session data has a built-in sample, opened under `Space z l` with no agent, so a layout
can be iterated in place. The sample sends nothing and raises no notification or badge.

| Keys | Sample |
| --- | --- |
| `Space z l o` | forms: the preview round, then each saved real round |
| `Space z l p` | primer: a sample primer holding every field and need |
| `Space z l c` | chat: a session of every entry kind |
| `Space z l s` | sessions: rows in every state |

## The primer's item cards

- **Rail:** the Feature row, then the tasks under their group headers. The selected task expands: its items show as
  rows under it, each with its include mark, its number and its text. `j` / `k` walk the task row, then its items,
  then the next task, which then expands. `x` on an item row toggles its include mark; `y` / `n` / `u` on an item
  row set its task's need.
- **Task card** (the task row selected): heading, tags and need; Question, Evidence, Probes and Pointer when not
  blank; an extra task's name box; the add-item box; the task comment. It lists no items.
- **Item card** (an item row selected): the header `⌃H ‹ 2 of 3 › ⌃L`, the item text as heading, the include mark,
  an Added tag on an item the user added, and the item's comment box.
- The review pane does not change.

## Out of scope

- Restyling or replacing primitives app-wide from a layout; themes carry the app-wide look.
- Reading layouts from the old plugin data folders.
