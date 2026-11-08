# 10 — Final verification and landing

Status: done
Type: Task
Wave: 7 · Depends on: 09
Plan: [plan.md](plan.md)

Worktrees (branch `forms-rundown`):

- gui `G` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`
- marketplace `MK` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown`
- agents `AG` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown`

Clones (on `main`): `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`, `…/wigley-ai-marketplace`,
`…/wigley-agents`, `…/wigley-harness`.

Files:     none modified; a check that fails goes back to the task that owns the file
Consumes:  every Produces of 01–09
Produces:  the checks passed and the live checks read; the landing at close lands the three branches and updates the plugin
Decisions: the three branches land together, so no agent on `main` reads `summary` before the app has it (plan § Docs
           written ahead) · notices page keys (round 4, choice 1)

## Checks

Run in this order. Each must pass. The gui commands run from `G` (`cd` to it first in the same Bash call). A shell on
another Node version prefixes `source ~/.nvm/nvm.sh && nvm use && `.

```
npm test
npm run typecheck
npm run lint
npm run selftest -- --plugin forms
npm run selftest -- --plugin chat
```

`npm run typecheck` is added (Decided): it compiles the main and page code that `npm test` does not type-check.
The two self-test runs are the filtered form `G/AGENTS.md` § Running and testing gives (`--plugin <id>`). Run only
these two plugins: the whole self-test runs only on the user's ask. After the forms run, Read these screenshots in
`G/.selftest/screenshots/` against `G/DESIGN.md`: `forms-preview-question.png`, `forms-preview-notices.png`,
`forms-preview-notice.png`, `forms-round-layout-notice.png`, `forms-round-notices.png`,
`forms-round-notice-comment.png`.

Then the marketplace Done commands, from `MK`:

```
python3 scripts/check_manifests.py
python3 scripts/check_manifests.py --against origin/main
python3 scripts/check_pointers.py --agents-root /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown
(cd scripts && python3 -m unittest discover -s tests)
claude plugin validate .
(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)
(cd plugins/wigley/scripts/forms && python3 -m unittest discover)
(cd plugins/wigley/scripts/plan && python3 -m unittest discover)
(cd plugins/wigley/scripts/retro && python3 -m unittest discover)
(cd plugins/wigley/skills/unity-playtest && python3 -m unittest discover -s tests)
(cd plugins/wigley/skills/unity-ux-flow && python3 -m unittest discover -s tests)
```

## Live checks

Through the `drive` skill (`G/.agents/skills/drive/SKILL.md`), from `G`. Each check is one `wigley:writing-tests`
§ What earns a live run instead admits: a judgement of what the screen shows, or wiring no test sees. Start one run
and pass `--run forms-rundown` on every command:

```
npm run drive -- start --run forms-rundown
npm run drive -- key --run forms-rundown Space z l o
```

The preview round opens on the Defect. Its stops are: Defect, Decision, Nit, Card width, the long question, then
the notices stop. Take a `screenshot` at each check and Read it against `G/DESIGN.md`; settle a number with `query`.

| # | Tag | Check | Why it earns a live run |
|---|---|---|---|
| 1 | *expected* | On the Card width stop (`j` ×3): the card shows the Card width summary task 01 pins (`Pick how wide a card draws. …`) as its headline, then the context, then the choices with the rationale under choice 2 with no label. No `Question`, `Context`, `Why recommended` or `Your answer` label shows. | What the card draws and in what order is a judgement on screen; card-kit tests pin only the kit parts. |
| 2 | *expected* | On the Defect, Decision and Nit stops: each finding card keeps its labels (its `Why` reason label and `Your answer` among them). | A shared kit change (`buildChoiceReason`) could drop a finding label; only the screen shows all of them together. |
| 3 | *expected* | The rail's last entry is `N` `Notices · 3`. On the notices stop (`j` ×5 from the Defect) three lines show, badged `Applied`, `Dispatched` and `Decided`, each with its title, all closed. | Rail look and the line kit part are layout output no test sees. |
| 4 | *expected* | On the notices stop: `Enter` opens the cursor line, `Enter` again closes it; `za` does the same. `j` moves the cursor to line 2, `j` to line 3, `j` again does nothing. `a` opens the cursor line and focuses its comment box (log `[forms] focused comment on notice 3`); `Escape Escape` leaves it. `o` does the same on line 2 after `k`. `k` to line 1, then `k` again moves focus to the long question. | Key feel and focus on screen: the cursor mark, the open body and the box focus are drawn state. |
| 5 | *low-confidence* | A comment box mounts inside a hidden line body: after the round opens, open a line that was never opened, press `a`, type `x`; the text shows in the box and the box takes vim keys. | Editors mounting into a hidden body inside a hidden page is inferred, never run (map § 6 Risks). |
| 6 | *low-confidence* | A layout save rebuilds the round and keeps the open lines, the cursor and a focused box: first write `<run folder>/home/.config/wigley-ai-gui/layouts/forms/drive-save/layout.js` holding a layout whose `cards.notice` draws `kit.markdown(card, input.context, 'context-body md')` and `kit.textBox(card, 'comment')` in a `div.item.notice` (a part that changes the pick, so each save rebuilds the view; `export default {}` keeps every pick on `default` and rebuilds nothing), and run `setting forms.layout '"drive-save"'`. Each open body then carries `data-layout="drive-save"`, which proves the rebuild ran. Open lines 1 and 3, put the cursor on line 3, press `a`, then write the same file again with a `// save 2` line added. Lines 1 and 3 stay open, the cursor stays on line 3, and the box keeps focus (type `y`; it lands in the box). | `keepFocusedBox` with open state in `RoundState` is wiring across the rebuild; round-view tests cover the state, not the focus on screen. |
| 7 | *low-confidence* | A throwing user `notices` pane falls back to `default`: write `<run folder>/home/.config/wigley-ai-gui/layouts/forms/drive-notices/layout.js` holding `export default { notices(parent, input, kit) { kit.el(parent, 'section', 'notices'); throw new Error('drive notices throw'); } };`, then `setting forms.layout '"drive-notices"'`. The notices stop draws default's page; the log names the failure. Run `setting forms.layout '"default"'` after. | A user-layout fallback for the new pane: a new pane part through `drawPart`, whose rollback of the bodies' boxes is wiring. |
| 8 | *low-confidence* | A question's `:::details Sources` block and an `html` visual render inside the unlabelled context. Open a round with `npm run drive -- do --run forms-rundown forms.openRound '<json>'`, the JSON holding `sessionId` `"sources"` and a `round` with one question whose `context` holds a sentence, an `html` fence (`<div style="padding:8px">visual</div>`) and a `:::details Sources` block with one path line, closed by `:::`. The visual draws in its frame, the Sources block shows collapsed and opens on click, and no label shows above either. | The context moved from `kit.section` to `kit.markdown`; a lost `md` class drops fence and details styling, visible only on screen. |

End with `npm run drive -- quit --run forms-rundown`.

## Landing

Decided (lead): this task's group covers the Checks and Live checks only. The lead runs the landing steps below
after `wigley:make` step 9 has deleted the plan folder and committed that deletion, and after every review fix is
committed. Landing earlier would merge and push before the review. The plan folder is committed in `G` before the
run starts, so `git worktree remove G` meets no untracked file.

The steps, per `~/wigley-agents/WigleyRepos.md` § Landing, for the three repos together:

1. In each worktree, `git -C <worktree> rebase main`. A conflict stops the landing and is reported.
2. In each clone, check `main` is available (on `main`, no merge or rebase in progress), then
   `git -C <clone> merge --ff-only forms-rundown`. While `main` is not available, poll and retry.
3. In each clone, `git -C <clone> worktree remove <worktree>`, then `git -C <clone> branch -d forms-rundown`. The gui
   worktree's `node_modules` is a symlink (git-ignored); it does not block the removal.
4. Push `main` in all four wigley repos (`wigley-agents`, `wigley-ai-gui`, `wigley-ai-marketplace`, `wigley-harness`),
   rebasing first when origin moved: `git -C <clone> pull --rebase` then `git -C <clone> push`. The marketplace push
   carries the 1.20.2 bump; its pre-push hook runs the version check. A refused push stops here and is reported.
5. Update the plugin, per `~/wigley-agents/AgentsStandardMapping.md` § Plugins step 4:

   ```
   claude plugin marketplace update wigley-ai-marketplace
   claude plugin update wigley@wigley-ai-marketplace
   codex plugin marketplace upgrade wigley-ai-marketplace
   ```

   `~/.claude-personal/plugins` is a symlink to `~/.claude/plugins` on this Mac (`~/.agents/AGENTS.local.md`
   § Claude Code profiles), so the one pair updates both Claude Code profiles. An open session keeps the old copy
   until `/clear`.
6. Install the stable app from the landed gui `main` through the gui `install` skill, so the app agents reach takes
   `summary`. Ask the user for that yes in a one-line chat message first. Until the install, the user's app refuses
   a `summary` that `forms.md` tells agents to send. A session already open keeps its old `ask_round` schema until
   it restarts.

## For the user, in the wrap-up only

- None of the checks above needs the user's hands: synthetic keys reach every forms bind, and the notices page
  shows no native dialog. Name none in the wrap-up unless a live check above could not run.

Done when: every check passes, and every live check's capture is read and matches. The landing steps are done at
close, after step 9.
Commit:    none; a fix found here is committed by the task that owns its file.

## Proof

Commit e6a27daf · proof: on the rebased gui (main bc18cdfc): npm test 544 files/10205 tests, typecheck, lint (after 410b4c70 reflow), selftest forms and chat all pass; six forms screenshots read against DESIGN.md and match; live checks 1-8 pass (drive run forms-rundown); marketplace: check_manifests, --against origin/main (after 1.20.3 d4c4874), check_pointers, every unittest suite and claude plugin validate pass; landing runs at close · concerns: first forms selftest failed the fit check on span.notice-line-title (meant to ellipsize, not exempted) — fixed in e6a27daf (SCROLLS_ITSELF plus a full-text tooltip on both the default and app-drawn title)
