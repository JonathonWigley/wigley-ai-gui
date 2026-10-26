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
- **The primer plugin** (`src/plugins/primer/`) holds the port of the old `primer.py` rules (parse, read the body
  back, the summary and next texts), its two tool definitions, its tool session, fixtures, its drive actions and its
  self-test script, and its page. It reaches sessions only through the sessions contract, as forms does.
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

The tab is a fixed view built from the `DESIGN.md` primitives; the user does not edit its layout.

- **Rail** (the start pane of a Split with its own `uiState` key): a Feature row first, then the tasks under
  SectionHeaders Primer, Every feature and Extra tasks. Each task row shows its need as a Tag (yes, no, unclear)
  and its included items as a count (included of total).
- **Card** for the selected row. The Feature row's card holds the name, slug, spec, summary and notes boxes. A
  task's card holds its question, its items as rows each with a ToggleMark (included) and a comment box, an add-item
  box, and the task's own comment box. An extra task's card also holds its name box.
- **Review pane** before send: every task's need, its included items and every comment, with the tallies; submit
  from there checks that the slug matches the slug rule and every extra task is named, and shows what failed.
- Autosave sends a draft `autosaveDelayMs` (manifest setting, default 400) after the last edit; the deadline
  (`deadlineSeconds`, default 240) is the forms default.
- **Page events:** `primerShown`, `needChanged`, `primerFinished`. **Page export:** `activePrimer`.
- The tab is shown, swapped in over the chat and back, and alerted the same way the Form tab is, through the shared
  session form tab helper in `src/shared/page/`.

## Keys

Scopes `primer.rail`, `primer.card`, `primer.review`, `primer.confirm`. Every bind follows `docs/keymap.md`.

| Keys | Scope | Action |
| --- | --- | --- |
| `j` / `k`, `<C-l>` / `<C-h>` | rail | next / previous row |
| `y` / `n` / `u` | rail | set the task's need to yes / no / unclear |
| `A` | rail | add an extra task |
| `D` | rail | remove the selected extra task |
| `<A-l>` / `<A-h>` | rail / card | focus the card / the rail |
| `j` / `k` | card | next / previous item |
| `x` | card | toggle the item's include mark |
| `c` | card | edit the item's comment |
| `C` | card | edit the task's comment |
| `a` | card | add an item |
| `i` | card | edit the first field (Feature card: name; extra task: its name) |
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

- A user-editable primer layout (forms layouts stay forms-only).
- Migrating old primer files.
- The other copies of the key-hint helper in the forms kinds, which stay with their tracked follow-up.
