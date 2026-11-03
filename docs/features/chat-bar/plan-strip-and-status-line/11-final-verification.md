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

## Self-test runs

Run the touched plugins' groups only (AGENTS.md § Running and testing; the whole self-test only on the user's ask):
`npm run selftest -- --plugin settings,gallery,chat,agents,agent-lines,agent-strip,usage,workflow`. Read every
screenshot it saves against `DESIGN.md` (density, the one accent, each surface on its layer, sentence case), both
transparency settings where the gallery saves them.

## Live checks (drive run)

Each line is tagged expected (E) or low-confidence (L) with its reason.

1. (E) Status line in a Chat tab of a real clone: repo and branch show; a turn that runs `git checkout -b x` updates
   the branch after the turn ends; a detached HEAD shows its short commit; a session in a folder outside git shows the
   folder name and no branch.
2. (L, layout no test sees) Status line in a narrow composer: the usage part drops spend, then cache, then the context
   text, and keeps its context bar; the running dot and Send stay at the end; the model · effort chip opens the model
   picker on click.
3. (L, wiring across five plugins) A `fake: agents` turn: the agent strip shows below the workflow strip, one box per
   subagent and per task, in start order; running boxes carry a running dot; finished boxes dim with a done or failed
   dot and stay until the next message, then go.
4. (L, cross-plugin key scope) `Esc` to leave the box, `G`, then `j` selects the strip's first running box; `l`/`h`
   move and clamp at the ends; Enter opens the selected box in place with every tool call (a task shows its command)
   and Enter closes it; `k` returns to the last entry; `i` and `a` focus the box. Then, with a box selected: a mouse
   click in the box, a tab switch and a pane focus move (`Alt+hjkl`) each drop the strip's selection; `Space ?` over the
   strip keeps it.
5. (L, ResizeObserver timing) The strip's `‹ ›` chevrons: at a narrow width with more boxes than fit, each shows only
   when there is more that way; a click scrolls by one box and takes no focus; moving the selection with `l` past the
   edge scrolls the box into view.
6. (L, pending reveal) Gallery's HScroller cells (No overflow, At start, In the middle, At end) show the right chevrons,
   with the middle and end cells scrolled.
7. (E) Chat preview `Space z l c`: the sample session shows the strip with two subagent boxes and one task box.
8. (E) Default `plugins.disabled`: no sidebar subagent lines and no tab-bar usage line. With `agent-lines` and
   `usage-tab-line` removed from the list in the run home's `settings.json`, after a page reload and an app restart,
   the lines and the tab-bar usage line (on the Form and Primer tabs too) show as before.
9. (E) `settings.json` with `{"plugins":{"disabled":["sessions"]}}`: the title bar shows the config problem badge
   and a toast naming the dependency; the app keeps the last good settings. Settings mode's Core section shows the
   `Disabled plugins` row.
10. (L, real stream shapes measured once) A real Claude session (Chat tab, a profile with the wigley plugin) that
    spawns a named `wigley:opus-high` subagent and runs a background Bash: the subagent box shows its name, the model
    after its first reply, effort `high`, and a cost that rises with its replies; the task box opens to its command.
    The cost uses API list prices; compare its order of magnitude with the session spend.

## For the user's hands (wrap-up only)

- Trackpad sideways scrolling of the strip, in a visible `npm start`.
- The final visual pass of the composer in a visible `npm start` (DESIGN.md § Checks).

GIVEN the landed plan WHEN the self-test groups and the live checks above run THEN each passes, or its failure is
reported with its capture and fixed in its task's group.
Tests:     none added here.
Done when: the self-test groups pass, every live check above is run and passed or fixed, and the wrap-up lists the
           user's-hands checks.
Commit:    none, unless a fix lands (it commits in its own group).

## Proof
