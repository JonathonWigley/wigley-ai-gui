---
name: primer
description: "Showing a checklist pass over a spec's tasks to the user in the Auri app's primer popup and reading back the edited checklist: the `auri` server's `open_primer` and `collect_last_primer` tools, their entries, payload, outcomes and saved files. Use when a skill hands the user a list of candidate tasks to tick, edit and comment on, or when a primer call returns a draft."
---

**Contents**

- **Intent** — the user edits a checklist pass in place instead of answering it question by question.
- **open_primer** — the call's arguments and each entry's fields.
- **What comes back** — the payload and what the user may change.
- **Outcomes** — the form outcomes, with the primer's names.
- **Saved primers** — where the app keeps each primer.

## Intent

A **primer** is a checklist pass over a feature spec: the tasks the feature may need, each with its work items and whether the
agent thinks it is needed. The user ticks the tasks the feature needs, edits the work items, adds tasks, and comments,
then submits. The edited checklist comes back as the tool result. A primer shares the lifecycle of a form, so the
`forms` skill's Outcomes hold for it with the primer's names. A session holds one open primer and one open form at
the same time, each in its own popup.

## open_primer

The `auri` server's `open_primer` tool opens the primer and waits for the user.

- `feature` — `name` and `slug` required (`slug` is lowercase letters, digits and dashes); `spec` and `summary`
  optional.
- `entries` — 1 to 60 objects. Each carries:
  - `id` — the row number as a string, or a standing task's slug, unique in the call
  - `task` — the task's name
  - `need` — `yes`, `no` or `unclear`
  - `items` — 1 to 20 non-empty strings, the work items
  - optional: `group` (`primer`, the default, or `standing`), `number`, `area`, `question`, `evidence`, `probes`,
    `pointer`

A malformed call fails with an error that names the field and what it must hold.

## What comes back

The result holds `outcome`, `summary`, `next`, `feature` and `entries`, and `earlier_heading` on a handed-back
primer.

- `feature` holds `name`, `slug`, `spec`, `summary`, and `notes`: the user's notes on the whole feature.
- Each entry holds the fields sent, its `group` (`extra` for a task the user added), the user's `need` and
  `comment`, and `items`: one `{ text, include, comment, added }` per work item.
- An entry sent with `need` `no` opens with every item's `include` false; one sent `yes` or `unclear` opens with every
  item's `include` true. A later need change leaves `include` as it is.
- The user edits only `need`, the comments, the items (an added item's text too, never a sent item's), the feature's
  fields and the extra tasks. Every other field comes back as sent.

## Outcomes

`outcome` takes the form outcome values (`forms` skill, Outcomes), with three differences:

- A primer is never `auto_answered`: in a headless session it waits on the user like any other.
- `no_primer` takes the place of `no_round`.
- Call the `auri` server's `collect_last_primer` tool where the form outcomes table names `collect_last_round`, and
  `open_primer` where it names `ask_round`. `collect_last_primer` takes an optional `wait` boolean.

A `needs_manual_open` reply carries no `feature` or `entries`.

## Saved primers

The app saves each primer in `~/.agents/wigley-primer/primers/`, in the saved form file format
([`../../scripts/relay/README.md`](../../scripts/relay/README.md), Saved forms): `args` holds the `open_primer`
arguments as sent, and `body` holds `feature` and `entries` as last saved. A re-sent primer opens pre-filled from its
newest file.
