# Feature primer in the app

**Contents**

- **Intent** — what the port is for and what a good outcome looks like.
- **Shape** — the shared agent form lifecycle, the primer plugin, and the flow between them.
- **Saved primers** — the file format and why it changed.
- **The Primer tab** — the rail, the card, the review pane, page events and exports.
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
                                           openForms / draft / finish ◀── (rail, card, review)
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
`docs/features/layouts/design.md`): the layout draws the feature, task and item cards and the rail and review panes,
and the app keeps the selection, keys, boxes, split and scrolling. `Space z l p` opens a sample primer for
iterating a layout in place.

- **Rail** (the start pane of a Split with its own `uiState` key): a Feature row first, then the tasks under
  SectionHeaders Primer, Every feature and Extra tasks. Each task row shows its need as a Tag (yes, no, unclear)
  and its included items as a count (included of total). The selected task expands: its items show as rows under
  it, each with its include mark (a ToggleMark), its number and its text. Selecting another task collapses the first.
- **Card** for the selected row, one at a time, as forms shows one card per rail row.
  - The Feature row's card holds the name, slug, spec, summary and notes boxes.
  - A task row's card holds its heading, tags and need; its question, evidence, probes and pointer when not blank;
    an extra task's name box; the add-item box; and the task's own comment box. It lists no items: the rail does.
    The add-item box's text becomes an item when a key leaves the box or the review opens; a click or window switch
    that moves focus leaves the text in the box. A task holding 20 items, the item limit, shows no add-item box.
  - An item row's card holds the header `⌃H ‹ 2 of 3 › ⌃L` (its place among its task's items), the item text as
    heading, its include mark, an Added tag on an item the user added, and the item's comment box.
- **Review pane** before send: every task's need, its items (the left-out ones tagged) and every comment, with the
  tallies; submit from there checks that the slug matches the slug rule and every extra task is named, and shows what
  failed.
- Autosave sends a draft `autosaveDelayMs` (manifest setting, default 400) after the last edit; the deadline
  (`deadlineSeconds`, default 240) is the forms default.
- **Page events:** `primerShown`, `needChanged`, `primerFinished`. **Page export:** `activePrimer`.
- The tab is shown, swapped in over the chat and back, and alerted the same way the Form tab is, through the shared
  session form tab helper in `src/shared/page/`.

## Keys

Scopes `primer.rail`, `primer.card`, `primer.review`, `primer.confirm`. Every bind follows `docs/keymap.md`.

| Keys | Scope | Action |
| --- | --- | --- |
| `j` / `k`, `<C-l>` / `<C-h>` | rail | next / previous row (task rows and the selected task's item rows) |
| `y` / `n` / `u` | rail | set the selected task's need to yes / no / unclear, on its task row or an item row |
| `x` | rail, card | toggle the selected item's include mark (an item row or an item card) |
| `A` | rail | add an extra task |
| `D` | rail | remove the selected extra task |
| `<A-l>` / `<A-h>` | rail / card | focus the card / the rail |
| `<C-l>` / `<C-h>` | card | next / previous row, its card replacing this one |
| `c` | card | edit the item's comment (item card) |
| `C` | card | edit the task's comment (task card; from an item card, its task's card) |
| `a` | card | add an item (task card; from an item card, its task's card) |
| `i` | card | edit the card's first box: the Feature card's name, an extra task's name; on any other task card the add-item box (the comment once the task is full), as `a` (`C`); on an item card its comment, as `c` |
| `<C-n>` / `<C-p>` | card, box | next / previous box |
| `<Esc>` | box | leave the box |
| `<C-j>` / `<C-k>`, `<C-S-j>` / `<C-S-k>` | card, review | scroll a line / half a page |
| `<Leader><Leader>` | rail, card, box | open the review |
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
