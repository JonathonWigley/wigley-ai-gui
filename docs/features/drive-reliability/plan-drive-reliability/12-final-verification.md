# 12 — Final verification in drive runs

Status: done
Type: Task
Wave: 6 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none (drive runs and the self-test)
Consumes:  every task
Produces:  a live-check record in the Proof section
Decisions: only checks no test pins (`wigley:writing-tests` § What earns a live run instead); every run happens with
           no `npm start` of the user's open, since it shares `.vite/build` and is outside the start lock

## Checks

Run each, reading every capture. Each is tagged expected (the change doing its job) or
low-confidence (where a bug is likely), with its reason.

1. **Restart loop** — expected; the root-cause fix has no live proof yet. One dev run: `restart` it 20 times, each
   followed by an `eval` of `document.readyState`. Pass: every `restart` returns ready and no command reports "never
   finished loading". Record the times.
2. **Two dev starts at once** — low-confidence; the lock's process race has no test. Start two runs with distinct
   `--run` ids in the same second (two background shells). Pass: one prints `Waiting for another dev start (pid …) to
   finish`, both answer `ready`, and each run's page is served by its own dev server (`eval location.href` shows two
   ports). Quit both.
3. **Drag held on the split handle** — expected; the follow-up's purpose. Seed a docs session (`docs.connectSession`),
   `drag --hold '.session-body:not([hidden]) .docs-split > .ui-split-handle' 40 0`, `query` that selector and
   `screenshot`, then `release` and `query` again. Pass: `is-active` is in the handle's classes while held and not
   after `release` (its visible change is an `::after`, which `query` does not read, so the screenshot shows it),
   and the split's start pane is about 40 px wider after `release`. `release`'s lines may be empty.
4. **Ended composer** — expected; the follow-up's purpose. `chat.start`, `key i`, `type fake: end`,
   `key Escape Enter` (chat's own send sequence, `sendKeys` in `src/plugins/chat/main/selftest-script.ts`), then
   `screenshot`. Pass: the composer's chips and send show disabled, read against `DESIGN.md`.
5. **Docs load-state tags** — expected; the follow-up's purpose. `docs.seed` with `{"loadStates":true}`, open each of
   the four load-state docs and `query` its Claude chip's tone, then edit `on-demand.md` on disk under the run's home
   and read its chip again. Pass: the tones are `CHIP_TONES`'s (`src/plugins/docs/page/doc-view.ts`): on-demand
   accent, listed neutral, shadowed warning, not-loaded neutral, and the edited doc reads `Claude pending` in the
   warning tone. Screenshot each.
6. **Self-test report** — low-confidence; the report format has no test of its printing. `npm run selftest`. Pass:
   every group header prints in order, the run ends `[selftest] all passed`, and the gallery saves
   `forms-gallery-full-1.png` onward.

Done when: every check passes, or each failure is reported with its captures and fixed in a new commit before the
           run closes
Commit:    none, unless a check needs a fix

## Proof

Commit none · proof: 1 restart loop PASS (20 restarts, 1.78–2.90 s, all complete); 2 two dev starts PASS (one waited on the lock, ports 5173/5174); 3 held drag PASS (is-active while held, start pane 288→330 px, click rejected naming the drag); 4 ended composer FAIL: fake: end ends the session, but chat-sessions.ts:312 session.owned.end() closes the row at once, so the disabled composer never shows; 5 load-state tags PARTIAL: four tones match CHIP_TONES, but an on-disk edit of an open doc never shows Claude pending; 6 self-test run at the gate; 7 gallery screenshots PASS against DESIGN.md · report /private/tmp/claude-502/-Users-jonathonwigley-Documents-dev-wigley-ai-gui/b18036e1-0824-436b-9728-681d086584bd/scratchpad/reports/12-1.md · concerns: checks 4 and 5 fail on app behaviour this plan did not change (a CLI that exits closes its session row; the open-doc reload does not mark pending); full vs reduced gallery shots near-identical offscreen; gallery-full-0 has no scrollbar
