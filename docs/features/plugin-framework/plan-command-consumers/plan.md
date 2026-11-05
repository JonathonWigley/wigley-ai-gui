# Command consumers — plan

Feature: plugin framework, Wave 3 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what Wave 3 lands.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, and the boundary rules.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Land Wave 3 of the intent-alignment master plan on the signatures `plan-commands-and-state/` landed:

1. Every click that changes anything runs a command.
2. Workflow stage actions as commands.
3. Sessions queries and row decorations, and Sessions stops knowing forms.
4. The user's work and place survive a page reload in every plugin.
5. The standing rule in the AGENTS.md Intent.

## Architecture

Systems touched:

- **Layout host and kits** (`src/shared/page/layout-host/`, `src/shared/page/ui/`, each plugin's kit and `layout.d.ts`).
- **Shared page modules** (`src/shared/page/list-picker.ts`, `confirm-prompt.ts`, `session-form-tabs.ts`).
- **Shell chrome** (`src/renderer/shell/shell-chrome.ts`).
- **Plugins**: forms, primer, chat, sessions, agent-strip, visual, keys, settings, docs, notes, backlog, workflow, unity-pool.

Every change is in wigley-ai-gui.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. `<gui>` is `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`.

- `plan-commands-and-state` is closed, and its signatures are in the tree: `test ! -d <gui>/docs/features/plugin-framework/plan-commands-and-state`, `grep -q 'checkCommandArg' <gui>/src/shared/command-args.ts`. If either fails, stop and tell the user.
- The task documents were written against that plan's File Structure, before its code landed. Before the first dispatch, `wigley:make` compares each Consumes line with the tree, and reports a difference as a stale precondition.
- Lane L's and the forms chain of Lane E's items are not running: they rewrite the forms files (`master-plan.md`). Check `git -C <gui> worktree list` and ask the user about any branch named for them.
- `<gui>` is up to date with origin: `git -C <gui> fetch origin && git -C <gui> status -sb`.
- No user layout exists: `find ~/.config/wigley-ai-gui/layouts -name layout.js` prints nothing (measured at plan time, re-verify). A layout found here is updated in place when `kit.button` changes, and the report names it.

## Docs written ahead

The commit `Document the settled design for commands and state (Waves 0, 2, 3)` holds `docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3). The task re-reading the docs checks it against the landed code. The standing rule goes into `AGENTS.md` in its own task, since it must be true when it lands.

## Mandatory Reads

- `<gui>/AGENTS.md`, every section.
- `<gui>/DESIGN.md`, for a task that changes what a view draws.
- `<gui>/docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3).
- `<gui>/docs/features/layouts/design.md`, for a task that changes a layout contract.
- The session's machine and agent rules: `~/wigley-agents/AGENTS.md`, `~/wigley-agents/MacMachine.md`, `~/.agents/AGENTS.local.md`.

## Design Overview

### After-state flow

```
 click ─► kit.button(parent, label, commandId, { arg })  or  kit.command(id, arg)
       ─► commands.run ─► intercept chain ─► handler(context with arg) ─► onDidRun

 Settings / help / palette ─► served commands, minus any with a declared arg and no bind;
                              one row per bound arg

 page state: plugin ─► api.state.publish(page slot key) ─► written on each change
             next page load ─► writer.get() restores drafts, focus, view, selection
             forms, primer, notes autosave to main ─► flushed on pagehide

 close: page asks tab beforeClose (chat's confirm, docs' unsaved edits)
        ─► main's addCloseGuard (forms' and primer's open round) refuses with a reason ─► sessions toasts it
```

### Decisions

From the interview rounds of 2026-11-04 (the user took every recommendation). The reasons are in `plugin-framework/design.md` § Commands and state.

- Every click that changes anything runs a command, cursor moves and section collapses included. Drags, focus guards and `stopPropagation` stay out.
- `kit.button` takes a command id and an optional argument, and takes no function. `kit.run` goes: its actions become commands.
- A command with a declared `arg` lists in Settings, help and the palette only when a key binds it, once per bound argument.
- A page reload keeps the user's work and place in chat, forms, primer, docs (unsaved edits included), notes, backlog and settings.
- Main's guard refuses with a reason, and holds forms' and primer's open round alone. A tab's `beforeClose` stays for what the page knows or must ask.
- Decided by the agent and shown to the user:
  - `setStatus` gives way to a row part with the same look. `setBadge` is not added.
  - `rows` and `sessions` are the slots task 11 of `plan-commands-and-state` landed.
  - Page slots write on each change. Forms', primer's and notes' autosaves flush on `pagehide`.

### Out of scope

- Wave 4, the command palette and every other side lane.
- Survival across an app restart.
- Commands for drags.

## File Structure

### Shared names and signatures

Every task uses these names exactly. This plan consumes the names in `plan-commands-and-state/plan.md` § File Structure: `commands.run`, `CommandKey`, `CommandDecl.arg`, `api.state.publish`, `api.state.read`, `kit.state.read`. That folder is gone once the run starts, so each task document copies the signature it consumes.

`BaseKit` (task 01): `button(parent: HTMLElement, label: string, command: CommandId, options?: { arg?: CommandArg; variant?: string; keys?: string }): HTMLElement`, and `command(id: CommandId, arg?: CommandArg): () => void`.

`plugin-framework` page reload slots (task 08): each plugin's page slot is a `SlotKey<…, 'page', '<id>'>` named `<id>PlaceSlot`, declared in that plugin's `contract.ts`.

Close guard (task 07): `addCloseGuard(mayClose: (sessionId: string) => string | null): Disposable`: a string refuses, and it is the toast sessions shows.

Each sweep task lists the commands it adds under Produces, each as `<plugin>.<short>` with its `arg` shape and the site it serves.

### Boundary rules

- A command with an `arg` that a click runs needs no key and no anchor. A key added for one follows `docs/keymap.md`.
- Two tasks in one wave touch no file in common.
- A sweep keeps what the user sees and what a key does. A change the sweep cannot avoid reports as a concern.
- Self-test `expect` lines move with any log line that changes.
- The whole self-test runs only when the user asks in the current turn. Filtered runs name the plugins the task touched.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Kit buttons run commands, and listing rules](01-kit-commands.md)

### Wave 2
- [ ] [Sweep: forms and primer](02-sweep-forms-primer.md) — after 01
- [ ] [Sweep: chat](03-sweep-chat.md) — after 01
- [ ] [Sweep: agent-strip, visual, keys, shell](04-sweep-small.md) — after 01
- [ ] [Sweep: docs, notes, backlog, settings, unity-pool](05-sweep-views.md) — after 01

### Wave 3
- [ ] [Workflow stage actions as commands](06-workflow-actions.md) — after 05

### Wave 4
- [ ] [Sessions queries, close seams and forms knowledge](07-sessions.md) — after 02, 03, 04

### Wave 5
- [ ] [Work and place survive a page reload](08-page-state.md) — after 06, 07

### Wave 6
- [ ] [Standing rule in AGENTS.md](09-standing-rule.md) — after 08

### Wave 7
- [ ] [Doc re-read](10-doc-re-read.md) — after 09

### Wave 8
- [ ] [Final verification](11-final-verification.md) — after 10

## Run log

Review base:

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
