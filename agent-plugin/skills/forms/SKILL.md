---
name: forms
description: "Asking the user through a forms round in the Auri app: the `auri` server's `ask_round` and `collect_last_round` tools, how each question, finding and notice is worded, what to do on each outcome, headless sessions, and the written fallback. Use when asking the user a question, sending review findings or notices, reading a round's answers, or when the forms tool is missing."
---

**Contents**

- **The round** — what a round holds, the two tools, and the full contract's place.
- **Every item** — plain words for a reader who never saw the run.
- **Questions** — the summary, the rundown in `context`, mocks and visuals, sources, change lists, choices, the rationale and `approves`.
- **Findings** — the text of each finding field.
- **Notices** — the title and context of each badge.
- **Outcomes** — what the caller does on each `outcome`, the wake, and failed calls.
- **Reading answers** — status values, notes, Don't ask me this, and blank items.
- **Headless** — a session that runs to completion with no form.
- **Written fallback** — the same round asked in a reply when no form can be shown.

A **round** is one batch of questions, findings and notices the agent sends to the user. The Auri app shows it in a
popup over the session, the user answers there, and the answers come back as the tool result. A good round reads
like a colleague giving the user the rundown: what is being asked, why, and what the user needs to know to answer,
with a mock of each option when the question decides a look.

## The round

- The `auri` server's `ask_round` tool sends a round and waits for the answers. It takes `heading` (one line naming
  what the round settles), `overview` (one or two short sentences: the work underway, then what this round focuses
  on), an optional `layout`, and the lists `questions`, `findings` and `notices`. A round holds at least one item.
- The `auri` server's `collect_last_round` tool re-attaches to the open round, or returns the last finished round's
  answers again. It takes an optional `wait` boolean.
- The tool rejects a malformed item with an error that names each field at fault. Fix every field it names and send
  again.
- The full contract — every field, limit, layout, the saved-round files and the relay — is
  [`../../scripts/relay/README.md`](../../scripts/relay/README.md). Read it before using a field this skill does not
  name.

Use `questions` for an open decision, `findings` for a review finding or deferred item the user decides, and
`notices` for what is already handled: a fix the agent made, or a decision it took alone.

## Every item

- Write for a reader who never saw the run. Say what a thing is before using its name. Explain or leave out any name
  coined during the run or taken from a source the user may not have read, such as a teammate's branch or another
  team's acronyms. Say who added the thing and what changes for the user or the product's users.
- Each line says what the user gets, in plain words, before any symbol name or term of art. Name the change, never
  only the markup or symbol behind it.
- Say each fact once. The card draws its parts in order, so a fact in the summary is not repeated in the context,
  and a fact in a choice is not repeated in the rationale.

## Questions

A question card draws `summary` as its headline, then `context`, then the choices, with the recommended choice's
`rationale` under it. It draws no section labels. `title` shows as the item's name in the rail and the review, never
on the card. Each field reads naturally after the one above it.

- **`summary`** — one or two plain sentences: what the user is asked to decide, and why it needs deciding now. It
  stands alone: a user who reads only the summary knows what the question is.
- **`context`** — the rundown: what the user needs to know to answer, told the way a colleague would tell it.
  - Write a few short paragraphs of plain prose. Use a bullet list only for points that are truly parallel, such as
    the options' trade-offs side by side. Add no headings and no labelled parts ("Why:", "Risk:").
  - Name what the thing is, why it exists, who uses it, and what the agent already found in the code. A proposal for
    something new says the agent searched for an existing one.
  - A question that decides anything a person will see — a screen, a layout, a placement, a colour, an icon, an
    animation, the copy on a button — shows each option as a **mock** in its `context`, beside the look today when
    one exists. People pick a look by seeing it. Build each mock per the `visuals` skill's Mocking a decision.
  - Any other question adds a visual only when it is about a shape: a flow, or a structure prose would need a
    paragraph to describe.
  - Introduce each mock or visual in a sentence, so the rundown reads without it. Put it in the `context`, never in
    the chat: the open form covers the chat. An image on disk goes in by its absolute path (`visuals` skill, Images).
  - Put the evidence last, in a `:::details Sources` block: paths, lines, quotes, command output. It stays
    collapsed, so the rundown above it names a place in words.
  - A question about concrete changes — a diff to review, edits to approve — opens its rundown with a `:::changes`
    block, or a `:::tree` block grouped by place when the changes span several places.
- **`choices`** — 2 to 9. Each opens with one plain sentence saying what the user would get. A blocking yes or no
  stands as its own question, outside any list of choices.
- **`recommend`** and **`rationale`** — the choice the agent would pick, and why, in a sentence or two. The rationale
  draws under that choice with no label, so it reads on from the choice and does not repeat it.
- **`approves`** — tag each choice whose pick approves an action the harness gates (in Claude Code, an action auto
  mode blocks without the user's own yes) with that exact action in plain words, naming the target as the call will
  ("push `main` to origin past PR protection"), in one line. The card shows the line under the choice. On submit, in
  a session the app started, the app posts it into the running turn as the user's own message. An answer whose
  `approval_posted` is true needs no separate chat yes. One whose `approval_posted` is false posted nothing: ask for
  the yes in a one-line chat message before the gated call.

Every question is as brief as the decision allows.

## Findings

What becomes a finding is the calling skill's decision. The card opens on the tags and the `impact`, then the
`finding` text with no label, so the `finding` carries the whole explanation.

- **`origin`** — `caused` (a defect the change introduced), `pre_existing` (a real defect in code the change read),
  `design` (a decision to weigh), or `nit` (nothing builds on it, and it cannot be shown happening).
- **`title`** — the finding, one line.
- **`impact`** — one plain sentence: what goes wrong, and for whom.
- **`finding`** — up to three bold-headed sections, each a short paragraph:
  - **What's going on** — what the thing is, why it exists and how it works today.
  - **What breaks** — what goes wrong, when, and for whom; on a `design` finding, what is to decide.
  - **Why** — the cause as short bullets, when it takes more than a sentence; left out otherwise.

  Name files and symbols only where the user needs them to follow the explanation. A `design` finding that decides a
  look carries a mock of each choice, as a question does.

- **`severity`** — on `caused` and `pre_existing` only: `critical`, `important` or `minor`.
- **`proof`** — on a `nit`: why it cannot happen, shown under "Why it's safe".
- **Each choice** — its `text` names the fix alone, opening with what the user gets, never with an action's label
  (the card draws the action headers). Its `reason` says what that fix does and why one would pick it. Its `action`
  is `fix_now` (the default), `follow_up` or `leave_it`.
- **`recommend_action`** and **`recommend`** — the recommended action, and the recommended choice's number when a
  choice carries that action.
- **`action_reasons`** — one plain sentence each on why to defer or drop the finding.

## Notices

- **`badge`** — `Applied` (the default: a fix already landed), `Dispatched` (a fix still in flight) or `Decided` (a
  decision the agent took alone).
- **`title`** — one plain line saying what changed, never a commit ref or "already done". On a Decided notice, the
  decision itself.
- **`context` on an Applied or Dispatched notice** — a `:::tree` block and nothing else: a line naming each place,
  the changes under it indented two spaces, each starting `+` added, `~` changed or `x` removed, saying in plain words
  what the user now gets. A notice touching one place may use a `:::changes` block instead. A Dispatched notice's
  lines describe the intended change.

  ```
  title: Card jumps fixed; relay 0.4.0
  context:
  :::tree
  Form
    ~ Card jump opens the answer box, cursor in it
  Relay
    ~ Version 0.4.0
  :::
  ```

- **`context` on a Decided notice** — one plain line: what was decided and why. A comment on it overrides the
  decision.

Notices ride in a round already being sent. With no round to send, they go in the reply.

## Outcomes

| `outcome`           | The caller                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submitted`         | Reads the answers.                                                                                                                                                                                                                          |
| `draft`             | Calls `collect_last_round`, again after every `draft`, however many come back in a row: a draft is the user still writing. A `draft` whose `next` says the round was not opened has no answers: send the same round again with `ask_round`. |
| `cancelled`         | Leaves the round closed and reports what it settled.                                                                                                                                                                                        |
| `needs_manual_open` | Sends the same round again with `ask_round` once. On a second one, tells the user the `summary`'s reason and asks the round in the reply (Written fallback).                                                                                |
| `auto_answered`     | Reads each pick as its own, lists each as a Decided notice in the reply, and sends no more rounds while the session stays headless (Headless).                                                                                              |
| `no_round`          | Sends the same round again with `ask_round`; the user's saved answers fill in.                                                                                                                                                              |

- A result carrying `earlier_heading` holds the answers to that earlier round. Read them as that round's answers,
  then send the current round again.
- **The wake.** In a session the app started, a submit or cancel that no call waits for sends the session a message
  naming the tool to call (`collect_last_round`). Call it.
- A call that fails, or a reply that was lost, is not an absent tool: call `collect_last_round` first and read its
  outcome by the table, since the lost reply may have handed back an earlier round.

## Reading answers

- Each answer's `status` is `answered`, `not_applicable` or `untouched`. Read each as itself; never infer one from a
  blank.
- `notes` is the user's own free text. An `untouched` answer with notes is an answer, not a blank. An item left blank
  throughout is re-asked in a follow-up round.
- `dont_ask: true` means the user says the agent should have settled that kind of item alone. The choice still
  counts. Settle that kind of question without asking for the rest of the session.
- A correction in a note applies to the work already done as well as the work ahead.
- Never answer a round's items with one default for the whole set.

## Headless

A **headless** session runs to completion with no one answering, so the user can leave the run going. Only a session
the app started can be headless. It turns on when the user presses the Headless chip, or when the agent calls the
`auri` server's `set_headless` tool with `headless: true` because the user handed it the rest of the run ("continue
with your own suggestions", "run headless", "stop asking me, finish it"). "Go with your recommendations" said of one
round answers that round only. Call `set_headless` with `headless: false` when the user asks to be asked again.

- The agent learns the session is headless from the app's session note, from a tool result line beginning
  `This session is headless`, or from an `ask_round` result with outcome `auto_answered`. A round result whose `note`
  reads `headless` is a request to turn it on, not a report that it is on.
- While headless, send no round. A round sent anyway comes back `auto_answered`, and is read the same way.
- Each pick that would have gone to the user takes its recommendation and is listed in the reply as a Decided notice,
  so the user can overrule any one afterward.
- An auto-answered pick never approves an action tagged with `approves`: the reply names what the action needs, and
  the turn ends there.
- When the user turns headless off from the chip, the next workflow tool result carries the line
  `This session is no longer headless`, once, and the next round goes to the form again.
- A primer is never auto-answered (`primer` skill).

## Written fallback

When the forms tool is absent, or `needs_manual_open` came back twice, ask the round in the reply with the same
wording as the form. Say once, in one line, that the form was unavailable. Each question takes this shape:

```
❓ **Q1 — <title>**
<summary>

<context: the rundown, with tables or a visual where the form would hold one>

1. <choice>
2. <choice>

**Recommended: 2.** <rationale>
```

A finding takes the same shape, with its severity and `impact` under the title and its `finding` in place of the
context, and a `nit`'s `proof` after it. A notice is one line, its badge and its title (`**Applied:** <title>`); a
Decided notice adds its context line after the title.
