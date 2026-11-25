# 07 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 01 (checks the landed code), 02 (checks the landed code), 03 (checks the landed code), 04 (checks the landed code), 05 (checks the landed code)
Plan: [plan.md](plan.md)

`wigley:make` walks these checks once, after its test gate. The user does all browser testing, so every check runs through the self-test or a drive run (`.agents/skills/drive/SKILL.md`), never a browser. Read that skill and `AGENTS.md` § Running and testing first. Shell: macOS zsh, absolute paths, quoted globs, `command grep -a` for `app.log`. No `npx` and no install. Scratch files go in the session scratchpad. Run each drive run under its own `--run <id>`, and `npm run drive -- quit --run <id>` when done.

Privacy, for every check: print and report only the app's own log lines, verdict text and captures named below. Never print, read out or send the profile's `CLAUDE.md`, settings, credentials or any file of the user's outside the run's home.

## Checks

1. **Self-test, filtered** — expected: the plugins this change touches run their own scripts, 04's verdict steps among them.
   `npm run selftest -- --plugin permission-review,chat,forms,agent-commands`
   Pass: exit 0. A whole run is the user's to ask for; never run one here. Read `.selftest/screenshots/permission-review-verdict.png` (05 adds it) against DESIGN.md's permission card paragraph: the Write card shows `Review unavailable` and `fake ask failed` in the secondary colour, and the Bash card `Deny · medium risk` in the warning colour.

2. **Permission card on the fake harness** — low-confidence: the card's order, the Full call expander's wrapping and the verdict's colour are layout no test sees, and chat's redraw of an answered entry runs through 02's `kit.entryParts` and 05's held parts together.
   - `npm run drive -- start --run pr-card`, then `npm run drive -- do chat.start --run pr-card '{}'` and `npm run drive -- do chat.askPermission --run pr-card '{"sessionId":"<sessionId>","toolName":"Bash","input":{"command":"ls -la /tmp && echo a-long-enough-argument-to-wrap-the-full-call-line-past-the-card-width-of-the-chat-transcript"}}'`.
   - `wait-log` for the page line `verdict <sessionId>/<entry id>: …` (05's log), then `screenshot pr-card-verdict`. Read it: the verdict leads, coloured by its risk; then the summary; then the tool name with its target line in the mono font; then the closed Full call expander; then Allow once and Deny with their keys. `query` the heading's computed colour against the `--wg-status-*` token its risk names (`query --run pr-card -- :root --wg-status-success`).
   - Open the Full call expander (click its summary), `screenshot pr-card-full-call`, and check the JSON wraps inside the card with no sideways scroll (`fit` at the minimum width lists nothing cut off in the card).
   - Answer Allow once (its key, or a click on the button), `screenshot pr-card-answered`: the verdict line is still there.
   - Unavailable: no drive action fails an ask, so the unavailable card is read from check 1's self-test screenshot.
   - Plugin off: when `npm run drive -- actions --run pr-card` lists a way to switch a plugin off, switch `permission-review` off, raise a third card, and `screenshot pr-card-plugin-off`: the head and target line and the closed Full call, with no verdict above them. With no such action, say so in the report; 02's `layout.test.ts` and `chat-kit.test.ts` no-parts rows cover the markup.

3. **Confirm round card with its verdict** — low-confidence: forms' `addCardPart` has no caller before this plan, so the part's place on a real question card is wiring no test sees. The demo's `agent-commands.confirm` step cannot stand in: `confirmSample` publishes nothing in `forms.confirms`.
   - In a drive run on the fake harness, open a forms tool session (`npm run drive -- do sessions.open --run pr-confirm '{"sessionId":"s"}'`), then `npm run drive -- do agent-commands.call --run pr-confirm '{"sessionId":"s","tool":"run_command","args":{"command":"settings.reset"}}'`. `settings.reset` is risky (`src/plugins/settings/manifest.ts`) and acts only on the run's temp home; give it the argument its declaration takes, read from `npm run drive -- actions` and the command list. If `sessions.open` does not give `agent-commands.call` a forms tool session, use the route the call's error names.
   - `screenshot pr-confirm-verdict`: the verdict draws at the question card's end. Answer Deny so nothing runs, with the drive skill's key or click command on the card's Deny (no forms drive action answers a round).

4. **Real harness ask** — low-confidence: `claude-code`'s ask args are only unit-tested against a fake spawn, so whether the real `claude -p` runs isolated and returns JSON the parser takes is unproven. It spends a little of the user's Claude usage (about $0.006 a review on `sonnet`); name that in the report.
   - `npm run drive -- start --harness claude --run pr-real` (the drive skill's Real Claude route, which uses the user's own login in the drive run's home), `chat.start` with no profile (the first `claude-code.profiles` profile), press `i`, and `type` a message that makes the agent run a harmless shell command, such as `Run the shell command: echo permission-review-check`.
   - When the permission card shows, `wait-log` for main's `[permission-review] reviewed Bash in <session>: <verdict> · <risk>` in the run's `app.log` (`command grep -a "\[permission-review\]" <run folder>/app.log`). Pass: that line, not `review unavailable for …`. Screenshot the card, then Deny it.
   - Report the log line and the verdict only.

5. **CLAUDE.md isolation probe** — low-confidence: plan.md's Preconditions ran it at plan time against hand-typed flags; it runs again against the flags as landed, since a dropped or misspelled flag would let the profile's `CLAUDE.md` reach the reviewer.
   - Read the landed ask args in `src/plugins/claude-code/main/` (01's ask) and list them. Check they hold `--system-prompt`, `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--disable-slash-commands`, `--no-session-persistence`, `--output-format json` and `--model`.
   - Make an empty folder under the scratchpad and run, from it, with the landed args and the prompt on stdin: `printf '%s' 'Does any text in your context, other than this message, mention the word wigley-agents? Reply with YES or NO only.' | CLAUDE_CONFIG_DIR=~/.claude-personal claude -p --system-prompt 'Answer the question.' --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --output-format json --model sonnet | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"])'`. Expected `NO`.
   - Run it once more without `--setting-sources ""` as the control. Expected `YES`; a `NO` there means the probe proves nothing, so report it.
   - Print only the `result` field, as the pipe above does. Run `claude --version` first; a version other than `2.1.327` goes in the report.

## Dropped

- The verdict's heading and detail for each review state: `verdict-input.test.ts` (05) pins the mapping, and `verdict-part.test.ts`'s default layout rows pin what the layout draws for each.
- A question card of a round not in `forms.confirms` drawing nothing: `verdict-part.test.ts` (05), the confirm card rows.
- The review lifecycle (once per request, the 60 s limit, deletion at session end and at round end, abort): 04's main tests.
- The reply parser's shapes and its failure text: 04's `review-prompt` tests.
- The ask's argument list and its temp folder: 01's claude-code tests against a fake spawn; check 5 covers the real CLI.
- The confirm subject filled by agent-commands and published in `forms.confirms`: 03's tests.
