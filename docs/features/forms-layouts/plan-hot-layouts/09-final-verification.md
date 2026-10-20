# 09 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything above
Produces:  the user's live-run results, recorded in Proof
Decisions: a visible run is the user's (AGENTS.md, Running and testing); the agent hands the user these steps and
           records what they report
Commit:    none

Every task defers its runtime and visual checks here. Each check below is one `wigley:writing-tests` § What earns a
live run admits: an expected path, or a low-confidence path with its reason. Claims the unit tests and the self-test
already pin are left off.

## Under `npm start`

1. **Expected** — `Space z l o` adds a 'Layout preview' row (selected, or marked with a toast when another row is
   selected); select it: its Form tab shows the sample: a notice, a defect, a
   decision, a nit and two questions, each drawn as before this plan.
2. **Expected** — `Space z l c` toasts the copy path. In
   `~/Library/Application Support/wigley-ai-gui/plugins/forms/layouts/default-2/`, add a `layout.css` that changes a
   colour, and save it: the open card redraws within about a second, and any answer already picked stays picked.
3. **Low-confidence** (module cache across relative imports; no test covers the scheme) — move one card section into
   a helper `parts.js` beside `layout.js`, imported relatively, and save `parts.js` alone: the change shows.
4. **Low-confidence** (error path in live module loading) — save `layout.js` with a syntax error: an error toast shows
   and the previous look stays. Fix it and save: the layout returns.
5. **Expected** — `Space z l n` / `Space z l p` cycle `default` ↔ `default-2`. Quit and start the app: the layout
   last chosen is active.
6. **Expected** — `Space z l o` again swaps in the newest saved real round. Submit it: the row leaves, and no agent
   session receives anything.
7. **Low-confidence** (the editor reads the `.d.ts` the app wrote) — open `default-2/layout.js` in an editor with
   `// @ts-check` and `/** @type {import('../layout').Layout} */`: completions list the kit's parts.

## Packaged build

8. **Low-confidence** (the scheme, CORS and the CSP under `file://`; the dev server hides all three) — run
   `npm run package`, start `out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app`, and repeat checks 2 and 5. Close the
   dev instance first: both use the same data folder and single-instance lock.

Done when: the user reports each check; each failure is fixed or recorded as a follow-up the user agreed to.

## Proof
