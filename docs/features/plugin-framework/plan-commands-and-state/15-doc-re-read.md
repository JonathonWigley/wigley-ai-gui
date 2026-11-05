# 15 — Doc re-read

Status: in progress
Type: Task
Wave: 13 · Depends on: 14
Plan: [plan.md](plan.md)

Files:
- modify `AGENTS.md`
- modify `docs/features/plugin-framework/design.md`
- modify `docs/features/intent-alignment/master-plan.md`
- modify `docs/features/followups.md`
- modify `docs/features/ui-design/design.md` (line 159 names the Platform record as a follow-up, measured at plan time, re-verify)
- modify any other file the title grep below finds

Consumes: every task's landed code, 01 to 14. Read the Run log's Contract changes and Rulings first: they name what moved from the plan.

Produces: docs true to the tree. No code changes. A line a doc states that the code contradicts is a doc fix when the code matches `plan.md`. When the code departs from `plan.md` with no ruling in the Run log, stop and report it.

Decisions:

**Re-read line by line.** Read each passage below whole, once, and check each claim against the code. Load `wigley:writing-for-agents` for the edits: each file here is one an agent reads.

| Doc | Passage |
|---|---|
| `AGENTS.md` | § Architecture, the "A slot" and "A command" entries (lines 344 and 352, measured at plan time, re-verify), and "An event" just below them |
| `docs/features/plugin-framework/design.md` | § Commands and state (Waves 2 and 3), the bullets on what Wave 2 landed |
| `docs/features/intent-alignment/master-plan.md` | § Wave 0, § Wave 2, § Order |
| `docs/features/followups.md` | the items named below, and any item that points at them |

Bullets in design.md that describe Wave 3 (`Every click`, `kit.button`, `A command that needs an argument`, `A page reload keeps`, the close seams, row decoration) stay as written: `plan-command-consumers/` lands them. Check only that nothing in them now contradicts the tree.

**Check these claims first, since drafts moved them:**
- The "A slot" entry says slots come as values, keyed values and keyed lists, and that `kit.state.read(id)` reads them: check `src/contracts/state.ts` and the kit.
- The "A slot" entry says a value outlives an owner's stop and a page reload. `sessions.activity` clears itself at a page start (task 14). Add that exception only if the entry's wording makes the clear false.
- The "A command" entry names `commands.register`, `keys.bind`, `commands.intercept`, `commands.onDidRun`, `run` and the keymap's `arg`: check `src/contracts/plugin.ts`.
- "An event" says a payload type lives in the publisher's `contract.ts`. Core events live in `src/contracts/core-state.ts`: name that.
- design.md's "Chat entries stay whole" and "replaces twelve hand-written race rules": check against tasks 11 to 13. Replace "twelve" with what landed, if it differs.

**Drop the tags.** Remove from `AGENTS.md`, in both entries: `(landing with \`docs/features/plugin-framework/plan-commands-and-state/\`; until its doc re-read drops this tag, this entry describes the plan, not the tree)`. Then `grep -n "landing with" AGENTS.md` must print nothing.

**AGENTS.md's tree.** Add an entry per new folder and file, in the shape of its neighbours (§ Architecture's tree, lines 76 to 300, measured at plan time, re-verify), each saying what the code holds:
- `src/contracts/`: `state.ts` and `core-state.ts` in the folder's line.
- `src/shared/`: `state/` (`slot-store.ts`) and `command-args.ts`.
- `src/main/`: `state/`, the slot holder.
- `src/renderer/`: `state/`, the page mirror.
- `src/plugins/`: `window/` beside the other plugins, per task 03.
- `chat/` in the plugins tree: `main/chat-slots.ts`, if the chat entry lists files of that rank.
- Any other new folder the run landed: `git diff --stat <review base> -- src | grep '=> \|(new)'` does not list new folders reliably, so run `git diff --name-status --diff-filter=A <review base> -- src` and read it.

Check every plugin entry that moved, for `dependsOn` and `reads` claims, and the channel claims of sessions, agents, usage, workflow, unity-pool and chat: their entries may say "pushes" or "sends" for what is now a slot. Fix each one.

**Master plan.** Follow its own rule (line 29, measured at plan time, re-verify): when an item lands, tick its box there and remove it from `followups.md`, in the same commit. Tick these, and drop the `[ready]` or `[plan]` tag only if the file's ticked items drop theirs (line 74 keeps its tag, so keep the tag):
- Wave 0: Platform record, Forms takes the timers service, Window plugin, Menu labels by label.
- Wave 2: Plugin state registry, Runtime command API, keysFor and box focus in the core keys API, Core picker and folder services, Events for every state change.

Check that § Wave 2's line on `Events for every state change`, "Its AGENTS.md rule step moves to the Wave 3 checkpoint", stays true: the checkpoint at § Wave 3 holds the rule. Leave that checkpoint unticked.

**Plan-folder pointers.** `wigley:make` deletes `plan-commands-and-state/` when this run closes, so a pointer to it goes untrue. `plan-command-consumers/` stays until its own run closes. Reword these two lines (line numbers measured at plan time, re-verify):
- `docs/features/intent-alignment/master-plan.md` line 31: Waves 0 and 2 have landed and their plan folder is gone. `docs/features/plugin-framework/plan-command-consumers/` holds Wave 3.
- `docs/features/plugin-framework/design.md` line 166: the same two facts.

**Follow-ups.** Remove these items from `docs/features/followups.md` whole (line numbers measured at plan time, re-verify):

| Item | Line |
|---|---|
| Plugin state registry | 18 |
| Runtime command API | 53 |
| Events for every state change | 69 |
| Core picker and folder services | 92 |
| keysFor and box focus in the core keys API | 96 |
| Forms takes the timers service | 104 |
| Platform record | 364 |
| Menu labels by label | 403 |
| Window plugin | 476 |
| Forms self-test platform from services | grep the title |

- `Every click runs a command` (line 57) stays: Wave 3 lands it.
- Before removing an item, read it for anything no task landed. Move each such part to the follow-up that owns its area, or to a new item. Known parts: the Events item names `control changed` and a stage event, which task 14 settled as slots, and backlog `applied`, which the user dropped. They need no carry-forward. Its standing-rule sentence is in the master plan's Wave 3 checkpoint. The registry item may name reload behaviour that belongs to `PluginHost stop and reload` or `Page state survives a page reload`.
- Then grep each removed title across `docs/` and `AGENTS.md`. Fix every pointer to a removed item, and add each file you change to the commit's pathspec. A line inside a plan folder stays.

**Stale doc found in passing.** Fix a stale line you meet in these files, and name it in the Proof.

GIVEN the re-read is done WHEN `grep -n "landing with" AGENTS.md` runs THEN it prints nothing.
GIVEN the master plan WHEN Wave 0 and Wave 2 are read THEN the nine named boxes are ticked and nothing else moved.
GIVEN `followups.md` WHEN the ten titles are grepped THEN none is an item, and `Every click runs a command` still is.
GIVEN `docs/` and `AGENTS.md` WHEN `plan-commands-and-state` is grepped outside the `plan-*` folders THEN it prints nothing.
GIVEN the AGENTS.md tree WHEN each folder added under `src/` is looked up THEN it has an entry.

Tests: none. A doc change picks no test (`wigley:writing-tests` § Picking tests for a gate).

Done when: every passage is re-read and every stale line fixed; the greps above give what they name; `npm run lint` still passes if the repo lints docs.

Commit: one commit for the group, holding the ticks and the removals together, as the master plan's rule asks.

## Proof
