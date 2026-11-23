---
name: workflows-and-checklist
description: "Reporting a session's checklist, workflow step and plan to the Auri app: the `auri` server's `set_workflow_checklist`, `set_workflow_step`, `set_workflow_plan` and `set_session_title` tools, the built-in Checklist flow, the edit gate that waits on the first checklist, and workflows a plugin declares. Use at the start of every task in a session the app started, when the work moves to another step, when a run knows its plan folder, or when an edit is denied for want of a checklist."
---

**Contents**

- **Intent** — the user follows each session's work in the app.
- **Session title** — naming the session in the side bar.
- **The checklist** — sending the task list, keeping it current, and the edit gate.
- **The Checklist flow** — the workflow every session starts on.
- **Declared workflows** — workflows a plugin's `auri.json` declares, and how a session enters one.
- **Steps** — `set_workflow_step` and the values it takes.
- **Plans** — `set_workflow_plan` and the plan side pane.
- **Tool result lines** — the headless lines that ride on these results.

## Intent

The user runs several sessions at once and follows each one from the Auri app: its title in the side bar, its
workflow and step on its row, and its checklist in a side pane. Only the agent knows when a task starts, which items
it holds, and when the work moves on, so the agent reports each of these as it happens. A good session's row and
pane always match the work in hand.

## Session title

Call the `auri` server's `set_session_title` tool as the first thing in the first turn, with a title of 2 to 4 words
and at most 30 characters that names the topic like a heading ("Forms Crash on Resume"). Call it again only when the
work's focus clearly changes.

## The checklist

- Before the first edit of a task, send its checklist with the `auri` server's `set_workflow_checklist` tool: every
  step of the work as concrete items. Each item is `{ text, done, running? }`.
- Send the whole list each time: a call replaces the list before it. Add items as new steps appear, tick each as it
  finishes, and mark the item in hand `running: true`. With none marked, the app shows the first open item as running.
- A separate ask from the user is a new task: send its own checklist in place of the last one.
- **The edit gate.** In a session the app started, the `auri` plugin's checklist hook denies the main agent's Edit,
  Write, MultiEdit and NotebookEdit calls until the session has sent a checklist. The denial says so. Send the
  checklist, then make the edit again. A subagent's edits pass, and so does every edit when the app is not reachable.
- **Turn end.** While the checklist holds open items, the hook reminds the agent once at the end of a turn: tick what
  finished, or leave the list as it is when the work waits on the user or a later turn.
- **After a compaction**, the hook shows the last step and checklist again. Report the step and checklist that match
  the work in hand in the same message as the next call.

The hook recognises an app session by the `WIGLEY_SESSION_ROW` environment variable the app sets. A terminal session
has no gate.

## The Checklist flow

Every app session starts on the built-in Checklist flow: one stage, labelled Checklist, whose progress is the
checklist's `<checked>/<total>`. It takes no step reports. It stays the session's workflow until a declared workflow
claims the session (Declared workflows).

## Declared workflows

An agent plugin may declare workflows in its `auri.json` (the `writing-auri-json` skill). Each declared workflow
names the skills that start it (`claims`) and its stages. When a session loads a claimed skill, the app moves the
session onto that workflow, at the stage whose trigger names the skill, and empties the checklist. Loading the skill
again re-enters that stage, so a new ask shows a fresh step and checklist rather than the last run's.

The user switches each declared workflow on or off in Settings. A switched-off workflow claims no session.

## Steps

- Call the `auri` server's `set_workflow_step` tool each time the work moves to another step that the running skill
  names, in the same message as the step's first call.
- The tool's `step` values are the union of the steps every enabled declared workflow names. With no such workflow,
  the tool is not offered.
- A step no enabled workflow names is an error listing the accepted steps. A step the session's own workflow does not
  take at its place succeeds with text saying it was ignored, and changes nothing.

## Plans

A declared workflow may track a plan folder. While one is enabled, the `auri` server's `set_workflow_plan` tool is
offered: call it with the plan folder's absolute path once the run knows its folder, and again when the run moves to
another copy, such as a git worktree's. The app also finds the plan from a write of the plan file or the skill's
argument, as the workflow's `planFormat` defines them, and reads its progress into the plan side pane.

## Tool result lines

A `set_workflow_step` or `set_workflow_checklist` result may carry a line about headless mode:
`This session is headless` or `This session is no longer headless`. Act on it per the `forms` skill's Headless.
