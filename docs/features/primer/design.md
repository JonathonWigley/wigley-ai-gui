# Feature primer in the app

**Contents**

- **Intent** — what the port is for and what a good outcome looks like.
- **Shape** — the shared agent form lifecycle, the primer plugin, and the flow between them.
- **Saved primers** — the file format and why it changed.
- **The Primer tab** — the tasks, items and card columns, the review pane, page events and exports.
- **Keys** — every primer bind and its scope.
- **Alerts** — the per-source open count.
- **Out of scope** — what this work leaves alone.

## Intent

The `wigley:feature-primer` skill sends the user a primer: the feature's name, slug, spec and summary, and a list of
task entries the user marks as needed or not and edits. It used to be a separate Python MCP server (`wigley-primer`)
with a browser form. It now runs in the app as the `primer` plugin, behind the `wigley-forms` server's
`open_primer` and `collect_last_primer` tools, and its tab follows `DESIGN.md` and the plugin structure like every
other view. A good outcome: the primer behaves like a round in every lifecycle respect (one open per session,
deadline to draft, re-attach, hand-back, pre-fill, close guard), because it runs on the same code, and the Primer tab
reads and keys like the Form tab.

The tool contract, the payload and the outcomes are stated once, in wigley-ai-marketplace
`plugins/wigley/scripts/forms/README.md` § The feature primer.

## Shape

```
 agent ──open_primer / collect_last_primer──▶ relay.py ──▶ sessions (tool routing)
                                                               │
                                                     primer main: tool session
                                                               │
                                     src/shared/agent-forms: AgentFormService(primerType)
                                       │ one open form per session, deadline, re-attach,
                                       │ hand-back, pre-fill, saved files
                         ┌─────────────┴──────────────┐
                folder store                    channel presenter
     ~/.agents/wigley-primer/primers/      formShown / formClosed ──▶ primer page: Primer tab
                                           openForms / draft / finish ◀── (tasks, items, card, review)
```

- **One lifecycle.** Forms' session lifecycle, record store and presenter move from `src/plugins/forms/main/` into
  `src/shared/agent-forms/`, generic over an `AgentFormType` declared in `src/contracts/agent-forms.ts`. The type
  supplies what differs: parse the agent's args, fingerprint them, the heading, read the page's body back, pre-fill
  a new form from a saved one, and build each reply payload. Forms becomes the round type; the primer is the second
  type. The two adapters make the seam real.
- **Independent per session.** A session may hold one open round and one open primer at once; each service keeps
  its own open form. A second `open_primer` while one is open waits behind it, as a second round does, rather than
  closing the first.
- **The primer plugin** (`src/plugins/primer/`) holds the port of the old `primer.py` rules (parse, read the body back,
  the summary and next texts), its two tool definitions, fixtures, the words its drive actions take and its self-test
  script, and its page. Its main part wires the shared tool session and the shared drive actions
  (`src/shared/agent-forms/drive-actions.ts`) to its form type. It reaches sessions only through the sessions
  contract, as forms does.
- **The old server retires.** wigley-ai-marketplace deletes `scripts/primer/` and `scripts/dashboard/` and the
  `wigley-primer` server entries; the relay's built-in tool list gains the two primer tools so the agent sees them
  while the app is away.

## Saved primers

A saved primer uses the saved-round format (`id`, `fingerprint`, `args`, `body`, `outcome`, `returned`,
`session_id`, `project_dir`, `tool_use_id`, `created`, `updated`) in `~/.agents/wigley-primer/primers/`: `args` is the
`open_primer` arguments and `body` is the feature and entries the page sends back. The old primer files carried
`heading`, `sent` and `data` instead. The format changed because the shared store needs `fingerprint`, `returned`,
`args` and `body` for re-attach, hand-back and pre-fill; the `retro` skill's readers move to the new fields with it.
Old files are not migrated: the app reads only files in the new format and reports an unreadable one once, as forms
does.

## The Primer tab

The tab draws through the primer's layout (`src/plugins/primer/layouts/`, the `primer.layout` setting;
`docs/features/layouts/design.md`): the layout draws the feature, task and item cards and the tasks, items and review panes,
and the app keeps the selection, keys, boxes, splits and scrolling. `Space z l p` opens a sample primer for
iterating a layout in place.

- **Three columns**, tasks | items | card, built as two nested Splits: tasks | (items | card). The tasks and items
  columns open `240px` wide and keep their widths in `uiState` (`primer.tasks-width`, `primer.items-width`; the
  tasks column opens from the old `primer.primer-rail-width` when only that is stored). Each column's least width
  is `160px`, the card's `320px`, so the outer split's end pane holds at least `480px`. A tab narrower than
  `640px` (about a `950px` window with the side bar beside it) stacks the tasks column over the items and card; an
  end pane narrower than `480px` stacks the items column over the card. There is no other narrow layout. Each
  split's handle shows the resize prompt `⌥⇧H ◂ ▸ ⌥⇧L` while the pointer is over it, while a drag runs and for a
  short moment after each resize key. The focused column's selected row reads as selected; each column without
  focus marks itself `is-pane-inactive`. A click on a row selects it and focuses its column.
- **Tasks column**: a Feature row first, then the tasks under SectionHeaders Primer, Every feature and Extra tasks,
  with the `A add` prompt in the Extra tasks header. Each task row shows its need as a Tag (yes, no, unclear) and
  its included items as a count (included of total). Its header holds the save state, `⌃H ▲ ▼ ⌃L` and
  `⌥L items ›`; its foot holds the Review button.
- **Items column**: the selected task's items as rows, each with its include mark (a ToggleMark), its number and
  its text. Its header holds `‹ tasks ⌥H`, `⌃H ▲ ▼ ⌃L` and `⌥L card ›`. On the Feature row it shows the empty
  state "Select a task to see its items."; on a task with no items, "No items. Press `a` on the task card to add
  one." Selecting another task selects that task's first item.
- **Card** for the focused column's selection, one at a time: the task card (the feature card on the Feature row)
  while the tasks column has focus, the selected item's card while the items column has focus. An items column with
  no item to select keeps the task card (the feature card on the Feature row). Focusing the card keeps the card of the column it came from, and the
  card's edge strip shows `‹ items ⌥H`.
  - The Feature row's card holds the name, slug, spec, summary and notes boxes.
  - A task row's card holds its heading, tags and need; its question, evidence, probes and pointer when not blank;
    an extra task's name box; the add-item box; and the task's own comment box. It lists no items: the items
    column does.
    The add-item box's text becomes an item when a key leaves the box or the review opens; a click or window switch
    that moves focus leaves the text in the box. A task holding 20 items, the item limit, shows no add-item box.
  - An item row's card holds the header `⌃H ‹ 2 of 3 › ⌃L` (its place among its task's items), the item text as
    heading, its include mark, an Added tag on an item the user added, and the item's comment box. The header's
    step keys follow the focused pane: the items column binds `k`/`⌃H` and `j`/`⌃L`, the card `⌃H` and `⌃L`.
- **Review pane** before send: every task's need, its items (the left-out ones tagged) and every comment, with the
  tallies; submit from there checks that the slug matches the slug rule and every extra task is named, and shows what
  failed.
- Autosave sends a draft `autosaveDelayMs` (manifest setting, default 400) after the last edit; the deadline
  (`deadlineSeconds`, default 240) is the forms default.
- **Page events:** `primerShown`, `needChanged`, `primerFinished`. **Page export:** `activePrimer`.
- The tab is shown, swapped in over the chat and back, and alerted the same way the Form tab is, through the shared
  session form tab helper in `src/shared/page/`.

## Keys

Scopes `primer.tasks`, `primer.items`, `primer.card`, `primer.review`, `primer.confirm`. Every bind follows
`docs/keymap.md`; `Alt+Shift+h`/`Alt+Shift+l` resize the columns there (tasks moves its right divider, items its
right divider, the card its left one).

| Keys | Scope | Action |
| --- | --- | --- |
| `j` / `k`, `<C-l>` / `<C-h>` | tasks | next / previous row of the tasks column (the Feature row and the tasks) |
| `j` / `k`, `<C-l>` / `<C-h>` | items | next / previous item of the selected task |
| `y` / `n` / `u` | tasks, items | set the selected task's need to yes / no / unclear |
| `x` | items, card | toggle the selected item's include mark (an item row or an item card) |
| `A` | tasks | add an extra task |
| `D` | tasks | remove the selected extra task |
| `<A-l>` | tasks / items | focus the items column / the card |
| `<A-h>` | items / card | focus the tasks column / the items column |
| `<C-l>` / `<C-h>` | card | next / previous row of the column the card came from, its card replacing this one |
| `c` | card | edit the item's comment (item card) |
| `C` | card | edit the task's comment (task card; from an item card, its task's card) |
| `a` | card | add an item (task card; from an item card, its task's card) |
| `i` | card | edit the card's first box: the Feature card's name, an extra task's name; on any other task card the add-item box (the comment once the task is full), as `a` (`C`); on an item card its comment, as `c` |
| `<C-n>` / `<C-p>` | card, box | next / previous box |
| `<Esc>` | box | leave the box |
| `<C-j>` / `<C-k>`, `<C-S-j>` / `<C-S-k>` | card, review | scroll a line / half a page |
| `<Leader><Leader>` | tasks, items, card, box | open the review |
| `<D-Enter>` | review | submit |
| `<Esc>` | review | close the review |
| `C` | review | ask to cancel the primer |
| `y` / `n`, `<Esc>` | confirm | confirm / dismiss the cancel |

`<Space>` stays the leader in every primer scope, so `x` alone toggles an item, as `x` toggles not applicable in
forms.

## Alerts

`Alerts.setOpenCount(source, count)` takes a source id; the adapter sums every source's count for the badge, so the
forms and primer presenters do not overwrite each other. The announcement for a new primer reads "Feature primer
ready".

## Out of scope

- Migrating old primer files.
- The other copies of the key-hint helper in chat, sessions and keys, which stay with their tracked follow-up.
