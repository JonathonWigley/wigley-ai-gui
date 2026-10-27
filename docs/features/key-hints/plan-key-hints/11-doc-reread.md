# 11 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 10
Plan: [plan.md](plan.md)

Files:     modify only the docs below, where a line is stale
Consumes:  the landed code of tasks 01–10
Produces:  docs that agree with the landed code
Decisions: the docs were written before the code (commit `83e0733`), so each one is a hypothesis
           (`wigley:writing-for-agents` § Doctrine before code). The code wins. A doc line that
           disagrees with the code is fixed in the doc. A code line that disagrees with a doc line
           the user settled in the interview (`docs/features/key-hints/design.md`) is reported as a
           concern, not fixed in the doc.

## Steps

1. Read each doc below line by line against the landed code:
   - `AGENTS.md` — the keys plugin line in the layer tree; the **Key hints** bullet and its five
     sub-bullets (the `anchor` export, the hide rule, the four placement kinds, vim's own keys, the
     `[keys] unplaced` line and the self-test failure, the layout kit calls). The lead edited the
     unplaced sub-bullet ahead of the code: it now says the plugin logs "at the end of a self-test
     run". Check it against the code: the keys plugin logs only from `checkSeen()`, which the
     `keys-check-placement` event runs at the end of the self-test, for every scope that was in
     force during the page load, over every anchor the page load named, once per scope and bind;
     a target shown only in some states is placed by a self-test fixture state that builds it, shown or
     hidden, never by a stand-in element. The
     vim keys sub-bullet should say a prompt shows the first bind that is not a vim key; the user config
     folder bullet (title bar badge); the forms layout bullet (rail header open count and saved state).
   - `DESIGN.md` — the Layers diagram; § Keys and focus (the placement kinds and their examples,
     the hide rule, vim's own keys); § Primitives (KeyPrompt, its builder name and its label colour,
     and the `ui-key-chevron` element a view places beside a prompt);
     § Surfaces (title bar, status bar, forms rail header).
   - `docs/features/ui-design/design.md` — the broken-config line and the key hints row.
   - `docs/features/key-hints/design.md` — each decision.
   - `docs/keymap.md` — any line that names the status bar's key list.
   - `docs/features/followups.md` — the four follow-ups task 10 removed are gone.
2. Check each example key in `DESIGN.md` § Keys and focus against the anchor that draws it, by
   reading the view code (for example, the tab strip prompts in `src/plugins/sessions/page/`).
3. Search for stale words across the repo's docs and comments:
   `grep -rn -i "key bar\|status bar's key\|keys-bar\|key-bar" AGENTS.md DESIGN.md docs src --include='*.md' --include='*.ts' --include='*.css'`.
   Each hit outside a historical "Landed as" line and outside this plan folder is fixed.
4. Fix each stale line. Commit the fixes in one commit.

Tests:     none; a doc is not a test subject.
Done when: every doc above agrees with the landed code, and step 3's search finds no stale hit.
Commit:    one commit, "Docs: re-read key hints docs against the landed code", or none when nothing was stale.

## Proof
