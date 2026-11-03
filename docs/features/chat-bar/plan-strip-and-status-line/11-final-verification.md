# 11 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 10
Plan: [plan.md](plan.md)

Files:     none (checks only; a defect found goes back to its task's group as a fix)
Consumes:  the landed code of 01–10
Produces:  the checks below, each passed or reported with its capture
Decisions: checks follow `wigley:writing-tests` § What earns a live run instead: only expected paths and
           low-confidence paths, never a claim a landed test already pins · the agent runs every check through the
           project's own tooling (`npm run selftest -- --plugin <id>`, the `drive` skill); the user's-hands checks go
           in the wrap-up only

## Whole-tree checks

Run once on the final tree, with every group of 01–10 landed: `npm run typecheck`, `npm run lint` and `npm test`. Each
task's Done-when ran them on a partial tree; this run is the first that sees all of them together. A failure is fixed
in the group of the task that owns the failing file.

## Self-test runs

Run the touched plugins' groups only (AGENTS.md § Running and testing; the whole self-test only on the user's ask):
`npm run selftest -- --plugin settings,forms,chat,agent-lines,agent-strip,usage,workflow`. The list names only plugins
whose main part hands a script: a `--plugin` filter naming a plugin with no script fails the run, so `gallery` (forms'
script saves the gallery's pages) and `agents` (its script moved to agent-lines in 07) are not in it. Read every
screenshot it saves against `DESIGN.md` (density, the one accent, each surface on its layer, sentence case), both
transparency settings where forms' script saves the gallery (`forms-gallery-full-*`, `forms-gallery-reduced-*`).

## Live checks (drive run)

Each line is tagged expected (E) or low-confidence (L) with its reason.

1. (E) Status line in a Chat tab of a real clone. Open a Chat session in the drive run home's clone (a folder inside
   a git clone; make one with `git init` and one commit under the run home when it has none). Repo and branch show,
   and the log has `[chat] <tab name> is in <repo> on <branch>`. Between turns, the agent runs
   `git -C <clone> checkout -b x` itself, then sends a fake turn; after that turn ends the status line shows `x` and the
   log has `is in <repo> on x`. Then `git -C <clone> checkout --detach` and one more turn: the short commit shows. A
   session in a folder outside git shows the folder name and no branch (`is in <folder>, no branch`).
2. (L, layout no test sees) Status line in a narrow composer: the usage part drops spend, then cache, then the context
   text, and keeps its context bar; the running dot and Send stay at the end; the model · effort chip opens the model
   picker on click.
3. (L, wiring across five plugins) A `fake: agents` turn: the agent strip shows below the workflow strip, one box per
   subagent and per task, in start order; running boxes carry a running dot; finished boxes dim with a done or failed
   dot and stay until the next message, then go.
4. (L, cross-plugin key scope) `Esc` to leave the box, `G`, then `j` selects the strip's first running box; `l`/`h`
   move and clamp at the ends; Enter opens the selected box in place with every tool call (a task shows its command)
   and Enter closes it; `k` returns to the last entry; `i` and `a` focus the box. Then, with a box selected: a mouse
   click in the box, a tab switch and a pane focus move (`Alt+hjkl`) each drop the strip's selection, and after the
   click `j`, `i` and `G` work in the box's tab again; `Space ?` over the strip keeps it.
5. (L, ResizeObserver timing) The strip's `‹ ›` chevrons: at a narrow width with more boxes than fit, each shows only
   when there is more that way; a click scrolls by one box and takes no focus; moving the selection with `l` past the
   edge scrolls the box into view; the scroll position stays across the once-a-second redraw.
6. (L, look) Gallery's HScroller cells (No overflow, At start, In the middle, At end) look right in both transparency
   settings (forms' gallery step already asserts their chevron states).
7. (E) Chat preview `Space z l c`: the sample session shows the strip with two subagent boxes and one task box, and
   the agents plugin's data folder gains no log file under `logs/chat-layout-preview.jsonl`.
8. (E) Default `plugins.disabled`: no sidebar subagent lines and no tab-bar usage line. With `agent-lines` and
   `usage-tab-line` removed from the list in the run home's `settings.json`, after an app restart, the lines and the
   tab-bar usage line (on the Form and Primer tabs too) show as before.
9. (E) `settings.json` with `{"plugins":{"disabled":["sessions"]}}`: the title bar shows the config problem badge
   and a toast naming the dependency; the app keeps the last good settings. Settings mode's Core section shows the
   `Disabled plugins` row.
10. (L, real stream shapes measured once) Runs only when the drive run home has a signed-in Claude profile with the
    wigley plugin; else it goes to the wrap-up as a check for the user. Keep it to one short turn: in a Chat tab, one
    message asks the agent to spawn one subagent through the Agent tool with `name: "strip-probe"`, `model: "haiku"`,
    `effort: "low"` and a one-line prompt, and to run `sleep 5` as a background Bash. The subagent box shows the name
    `strip-probe`, the model (the full `claude-haiku-…` id from the launch receipt or its first reply), effort `low`,
    and a cost after its first reply; the task box opens to `sleep 5`. The cost uses API list prices; compare its
    order of magnitude with the session spend.

## On the user's ask only

- The whole self-test run, for its end-of-run key placement check: it logs no `[keys] unplaced` line for scope
  `agent-strip.strip` (the `i`/`a` anchors 09's default layout draws) or `chat.chat` (the joined model · effort chip,
  05). A filtered run skips that check, and the whole run takes about 30 minutes (AGENTS.md § Running and testing), so
  the agent lists it in the wrap-up and runs it only when the user asks.

## For the user's hands (wrap-up only)

- Trackpad sideways scrolling of the strip, in a visible `npm start`.
- The final visual pass of the composer in a visible `npm start` (DESIGN.md § Checks).

GIVEN the landed plan WHEN the whole-tree checks, the self-test groups and the live checks above run THEN each passes,
or its failure is reported with its capture and fixed in its task's group.
Tests:     none added here.
Done when: typecheck, lint and the suite pass on the final tree; the self-test groups pass; every live check above is
           run and passed or fixed (check 10 run, or listed for the user when no signed-in profile exists); the wrap-up
           lists the whole self-test run as the user's ask and the user's-hands checks.
Commit:    none, unless a fix lands (it commits in its own group).

## Proof
