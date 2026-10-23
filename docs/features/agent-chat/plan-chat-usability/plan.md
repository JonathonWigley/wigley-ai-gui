# Chat usability — plan

Feature: agent chat, plan C · Implements: none · Ticket: none
Target: main · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user runs Claude Code sessions from the Chat tab day to day with no terminal: signs a profile in from the app,
types terminal-only commands (`/login`, `/logout`, `/status`) that the app runs itself, sees the whole slash
completion list, picks a folder from every folder they already work in, and pastes or drops images into a message
with previews before and after sending.

## Architecture

Systems touched:

- **Harness seam** (`src/contracts/agent.ts`): messages carry images; new account calls (`accountStatus`, `logIn`,
  `logOut`) and `listProjects`. Adapters: Claude (`src/main/claude-code/`) and the fake (`src/shared/fake-agent-harness.ts`).
- **Core main services** (`src/contracts/plugin.ts`, `src/main/main.ts`): `MainServices.tempFolders`.
- **Editor adapter** (`src/renderer/codemirror-vim/`): CodeMirror popups mount on the page body.
- **Chat plugin** (`src/plugins/chat/`): main (sign-in, notices, merged folder list, image messages), page (app slash
  command registry and its exports, the sign-in dialog and start-prompt step, attached images, the image viewer),
  layouts (the `images()` kit part and the user entry's images), keys.

No repository, submodule or package boundary is crossed; the relay contract with wigley-ai-marketplace is untouched.

## Preconditions

Each was run at plan time; `wigley:make` re-runs them before the first dispatch.

- `claude --version` → `2.1.309 (Claude Code)`. The wire facts in `claude-stream.md` § Images, § Terminal-only
  commands and § Auth were measured on this version.
- `git merge-base --is-ancestor 3a0e6c2 HEAD && echo ancestor` → `ancestor` (the docs written ahead).
- `command grep -n '"@codemirror/view"\|"@codemirror/autocomplete"' package.json` → both direct dependencies
  (`@codemirror/view` `^6.43.15`, `@codemirror/autocomplete` `6.20.3`). No new package is added by this plan.
- `command grep -n "cm-tooltip" src/renderer/codemirror-vim/editor-theme.ts` → the autocomplete popup is styled by
  the editor theme (line 66 at plan time, re-verify).

## Docs written ahead

Commit `3a0e6c2`:

- `docs/features/agent-chat/design.md` — Vocabulary (app slash command, sign-in, attached image), Flow, Agent
  harness seam (images, accounts, project folders), Chat plugin (start prompt, sign-in dialog, app slash commands,
  images, completion popup), Plans (plan C).
- `docs/features/agent-chat/claude-stream.md` — § Images, § Terminal-only commands, § Auth.
- `docs/keymap.md` — `<Leader>cx` in the `c` row.
- `AGENTS.md` — the `chat/` line of the source tree.
- `docs/features/followups.md` — the images follow-up narrowed to other file types.

## Mandatory Reads

- `AGENTS.md` (repo root) — architecture, layers, plugins, running and testing.
- `DESIGN.md` — every view, CSS, primitive and key change (tasks 05, 06).
- `docs/keymap.md` — every new bind (tasks 05, 06).
- `docs/features/agent-chat/design.md` — the settled design; every task.
- `docs/features/agent-chat/claude-stream.md` § User message, § Images, § Terminal-only commands, § Auth,
  § Launch — task 01.
- `.agents/skills/drive/SKILL.md` — task 08.
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exists in the repo at plan time
  (`find . -name 'CLAUDE*.md' -o -name 'AGENTS*.md' -not -path './node_modules/*'` → `./AGENTS.md`; re-verify).

## Design Overview

```
 Space k n ─► folder step: recentFolders() = recent-folders.json ∪ listProjects(each profile), newest first,
 │            missing + temp folders dropped, "Choose folder…" last
 ├─► profile step ─► accountStatus(profile) ─► signed out? ─► sign-in dialog ─► signed in ─► session step
 └─► session step ─► start / resume (unchanged)

 composer: paste / drop image ─► attachments (PNG/JPEG/GIF/WebP, base64 ≤ 5 MB) ─► thumbnail strip (× / <Leader>cx)
 send ─► text matches a registered `/name`? ─► yes: command.run({ sessionId, profile, args }); box cleared,
 │                                              images kept; output through channel `notice` → notice entry
 └─► no: channel send(sessionId, { text, images }) ─► AgentProcess.send(message)
          ─► Claude: user line with image blocks then the text block; user entry carries images
 user entry ─► kit.images() thumbnails ─► click / Enter ─► image viewer (h / l / Esc)

 /login ─► sign-in dialog.open(profile) ─► channel logIn(profile) ─► AgentHarness.logIn(profileDir, events)
          ─► claude auth login (opens browser) ─► logInLink(url) ─► dialog shows link + code box (Cmd+Enter sends)
          ─► process ends ─► accountStatus confirms ─► logInEnded ─► dialog closes, toast
 /logout ─► channel logOut(profile) ─► claude auth logout ─► notice     /status ─► accountStatus ─► notice

 every vim box: CodeMirror tooltips mount on document.body ─► slash popup no longer clipped by the composer
```

**Decisions** (interview rounds 1–2 and the design review):

- Sign-in runs `claude auth login` through the adapter; the dialog shows the fallback link (Copy) and a box for a
  pasted code; it closes itself on success with a toast; Esc cancels (round 1).
- Sign-in, sign-out, account status and project listing are `AgentHarness` calls; chat draws them (round 1).
- The folder step merges the app's recent folders with every folder each profile's harness has sessions in, drops
  missing and temp folders, `Choose folder…` last (round 1).
- Terminal-only commands are fixed as a class: app slash commands, a registry chat's page exports; chat registers
  `/login`, `/logout`, `/status`; the start prompt checks the profile and offers sign-in (round 2).
- Images: paste and drop; thumbnails before sending with remove; thumbnails in the sent entry opening a full-size
  viewer; bytes kept in memory as base64 with the entry, resumed sessions showing theirs from the transcript;
  `send({ text, images })` on the seam (rounds 1–2).
- Design review, Decided: the account and project calls go on `AgentHarness` beside `listSessions` (locality: Claude's
  CLI and transcript layout stay in its adapter); the Claude adapter reuses the session launch's environment for
  `claude auth …` (one rule for the nested-session strip and `CLAUDE_CONFIG_DIR`); a sign-in's result is confirmed
  with `accountStatus` because the login exit code is unmeasured; temp folders come from the composition root as
  `MainServices.tempFolders` (the OS temp folder is ambient, so it is injected, and features carry no
  `process.platform` check); the fake harness lists the folders it started sessions in, so the drive run and self-test
  see the merged list without a fixture; one sign-in at a time, owned by chat main; app command output goes through a
  main-kept notice entry so a reload keeps it; a second `addSlashCommand` of a registered name throws; the editor
  adapter, not chat, fixes the popup (every box gains it); paste and drop are composer DOM listeners, leaving the
  editor contract unchanged.

**Out of scope**: files other than images in the composer (follow-up), `--console` and `--sso` sign-in, "Always
allow" on permission cards, a read-only chat for terminal sessions, a key or command for sign-in outside `/login`
and the start prompt.

## File Structure

**Modified**

- `src/contracts/agent.ts` — `ChatImage`, `UserMessage`, the user entry's `images`, `AgentProcess.send(message)`,
  `AccountStatus`, `LogInEvents`, `LogInProcess`, `ProjectFolder`, four `AgentHarness` calls.
- `src/contracts/plugin.ts` — `MainServices.tempFolders`.
- `src/main/main.ts` — fills `tempFolders`.
- `src/main/claude-code/claude-code-harness.ts`, `claude-controls.ts`, `transcripts.ts`, `past-sessions.ts` (+ tests).
- `src/shared/fake-agent-harness.ts` (+ test).
- `src/renderer/codemirror-vim/codemirror-vim-host.ts` (or `prefix-completion.ts`, wherever the box extensions are
  assembled).
- `src/plugins/chat/contract.ts`, `manifest.ts`, `main/chat-sessions.ts`, `main/start.ts`, `main/selftest-script.ts`,
  `page/start.ts`, `page/chat-commands.ts`, `page/chat-view.ts`, `page/chat-kit.ts`, `page/start-prompt.ts`,
  `page/chat.css`, `layouts/layout.d.ts`, `layouts/default/layout.js`, `src/plugins/keymap.ts`.

**New**

- `src/main/claude-code/claude-auth.ts` (+ test) — the `claude auth` runs and the login line parser; keeps the
  harness file to the process loop.
- `src/main/temp-folders.ts` (+ test) — the temp folder list the composition root builds.
- `src/plugins/chat/main/accounts.ts` (+ test) — the one running sign-in and the account calls by profile name.
- `src/plugins/chat/main/folder-choices.ts` (+ test) — the merged folder list.
- `src/plugins/chat/page/slash-commands.ts` (+ test) — the app slash command registry and matcher.
- `src/plugins/chat/page/account-commands.ts` — `/login`, `/logout`, `/status` registrations.
- `src/plugins/chat/page/sign-in-dialog.ts` — the sign-in dialog.
- `src/plugins/chat/page/attachments.ts` (+ test) — attached images: accept rules, reading, the strip.
- `src/plugins/chat/page/image-viewer.ts` — the full-size viewer.

**Boundary rules**: only `src/main/claude-code/` names `claude auth` or reads transcripts; `src/contracts/` imports
nothing; chat's page imports only `src/contracts`, `src/shared`, its own folder and its dependencies' `contract.ts`
(`scripts/check-layers.mts` enforces it); `process.platform` appears only in `src/main/main.ts` for this plan.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Harness seam: images, accounts, project folders](01-harness-seam.md)
- [x] [Completion popup on the page body](02-completion-popup.md)
- [x] [Temp folders as a main service](03-temp-folders.md)

### Wave 2
- [x] [Chat main: image messages, notices, sign-in, merged folders](04-chat-main.md) — after 01, 03

### Wave 3
- [x] [App slash commands and sign-in in the page](05-slash-commands-sign-in.md) — after 04

### Wave 4
- [x] [Attached images and the image viewer](06-images.md) — after 05

### Wave 5
- [x] [Doc re-read](07-doc-re-read.md) — after 02, 06

### Wave 6
- [x] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: a0e7aebc036aed1714fb1422459501b1d4d7319d

### Groups
- 03 temp folders · 7c28b58 · proved (diff read, typecheck, lint) · concerns: test names use the task-doc style, not the repo prose style
- 02 completion popup · 63e9972 · proved (diff read, typecheck, lint) · concerns: popup DOM sits outside EditorHost.contains — check clicks on rows in 08
- 01 harness seam · c37acaa · proved (diff read, typecheck, lint) · concerns: layout.d.ts UserInput lacks images (06); AGENTS.md claude-code line stale (07); link-on-stderr untested
- 04 chat main · bb7ccc2 · proved (diff read, typecheck, lint) · concerns: filters after the 40 cap can shorten the list; a rejecting stat rejects recentFolders
- 05 slash commands and sign-in · 89f54d0 · proved (diff read, typecheck, lint) · concerns: second open drops its finished; no sign-in id for stale logInEnded; no self-test step for /status or the dialog
- 06 images and viewer · 2b7fef7 · proved (diff read, typecheck, lint) · concerns: AGENTS.md kit list lacks images; paste/drop/viewer live only; backdrop click does not close
- 07 doc re-read · committed with this Groups line · proved (diff read, lint) · concerns: none new
- 08 · drive verification (opus-low) · no commit · concerns: one lost-text send near a peer hot reload, not reproduced; sign-in Esc needs two presses from insert mode (finding 20 family)
### Contract changes
- createFolderChoices returns a named `FolderChoices` of the planned shape; mergeFolderChoices takes `ListedProject[]` (= `{ profile; folder: ProjectFolder }`) · why: naming only · consumers: none · group 04
- chat-sessions.ts exports `requireProfile(profiles, name)` and `requireChatHarness(harnesses)` (private lookups widened); `SELFTEST_PROJECT_DIR` export removed; `ChatSelfTestDeps` gains `homeDir` and `files` · why: shared by accounts, folder-choices and start · consumers: none outside 04 · group 04
- addAccountCommands deps: `signIn: SignInDialog` → `signIn: Pick<SignInDialog, 'open'>` plus `toast` · why: ended-session toasts · consumers: none · group 05
- createSignInDialog deps: `SignInDialogDeps extends DialogDeps { editor; channel: Pick<PageChannel<ChatChannel>, 'invoke' | 'on'>; toast }` · why: the dialog hears logInLink/logInEnded · consumers: none · group 05
- ChatCommandDeps gains `signIn: SignInDialog` and `slashCommands: Pick<SlashCommands, 'match'>`; ChatViewDeps gains `slashCommandNames(): string[]`; account-commands.ts exports `accountText(account)` · why: the plan left the shape open · consumers: 06 · group 05
- chat-dialogs.ts (outside Files) exports `followKeymap` and `DialogAction` · why: widen, never copy · consumers: none · group 05
- ChatViewDeps gains `viewer: Pick<ImageViewer, 'open'>`, ChatCommandDeps `viewer: ImageViewer`, ChatSession `attachments: Attachments`, KitDeps `openImages(images, index)`; attachments.ts also exports `attachFiles(files, attachments, report)` and `imageUrl(image)` · why: internal deps the plan left open · consumers: none outside chat page · group 06
### Rulings
- plan.py is absent from wigley 1.8.0; the Run log, boxes and Status lines are edited by hand — no tooling to lean on — a malformed entry, caught at Close · lead
- A peer session shares the working tree; every commit is pathspec-scoped and the review range is this run's commit list — a swept peer edit — lead
- listProjects lives in past-sessions.ts (listProjectFolders) with a shared inBatches helper; a folder whose newest transcript head fails to read is left out, no fallback — the spec says newest only — a folder with one corrupt newest transcript is missing from the folder step · group 01
- Auth error texts: `claude auth status|logout exited with code <n>: <stderr>`; login failure is the last stderr line else `claude auth login exited with code <n>|signal <s>`; ENOENT gives `claude was not found at <command>; set claude.command` — spec named the hint only — copy only · group 01
- readAccountStatus with loggedIn true and no email gives account null; the fake ends a wrong code with signed-out status and leaves the stored sign-in unchanged — spec silent — copy only · group 01
- claude-auth.ts carries the repo's first `oxlint-disable-next-line no-control-regex`, for the OSC 8 regex — the control characters are the point — a lint precedent · group 01
- The tooltip z-index sits on the autocomplete rule only — the only tooltip the app styles — a later tooltip type may sit under a dialog · group 02
- readStartInputs became async to await the real path of os.tmpdir(); the self-test gets [] — realPath is async — a failed realPath now fails start through failStart · group 03
- Self-test project folders are made under the real path of the self-test home, not services.homeDir, and sessions start once they exist — the mkdtemp spelling did not tilde in the picker and broke the min-width step — none seen, self-test passes · group 04
- `A sign-in is already running for <profile>` names the running sign-in's profile — matches the page focusing the open dialog — one string · group 04
- File order agreed with peer wigley-ai-gui-b5 (settings-mode plan): plan C 05 holds chat/manifest.ts and keymap.ts; the peer's 01 runs after 05 commits; plan C 06 dispatches only after the peer reports its 01 committed; keymap.ts one worker at a time, announced before and after — both plans edit those files — a wait on 06 · lead
- A finished sign-in still signed out with error null toasts `Sign-in failed: <profile> is still signed out`; a rejected logIn closes, toasts `Sign-in not started: <error>` and calls finished(false) — spec silent — copy only · group 05
- submitCode keeps the code in the box and the dialog open until logInEnded; Copy is a ghost button disabled until the link arrives — spec silent — a resend shows the old text · group 05
- Enter on a user entry with images toggles the entry first, then opens the viewer at 0 — EntryList has no read-only focused() and entry-list.ts was outside Files — a layout with expanders in a user turn would toggle and open both · group 06
- An ended tab still preventDefaults a paste/drop holding files and logs it; files are read before refusalOf runs; the viewer closes on scope base change and otherSessionShown, not on backdrop click — spec order kept — a large non-image file is read before refusal · group 06
### Review rounds
- round 1 · 238f123 · NEEDS FIXES · 24 findings + F1; lead-applied a7703a6; fixes 092d1cf e5020f2 8a96035 48646e8; full tests 2393 pass, self-test passes; open: #1 #3 #8 #20 #21 to the user
- round 2 (re-review, correctness) · 9bdb5e6 · NEEDS FIXES · 1 important repeat of #18 (dialog ignores error) to the user; minor: 2 untested #18 branches dispatched; cap comment + design.md Accounts bullet lead-applied
- round 3 (re-review 2, correctness ×2) · d429a99 · NEEDS FIXES · fix cycle cap reached; 7 findings (2 repeats) to the user
- user-approved fixes after the cap: efd2060 (transcript head stops at the first whole user line; head and harness tests), 5fdf52c (sign-in Copy shows box keys; paste stub, sign-in cancel tests); finding 1 (Finder paste) returned as a question, carried to step 8
### Test gate
- Picked every test file the range added or edited (17: claude-auth, claude-code-harness, claude-controls, claude-launch, past-sessions, transcripts, temp-folders, default layout, accounts, chat-sessions, folder-choices, attachments, chat-commands, chat-state, slash-commands, start-prompt, fake-agent-harness — they cover all changed logic); `npm run selftest` because selftest-script.ts and the chat start path changed; the codemirror host change (02) has no test and goes to the live check in 08 · 17 files / 233 tests passed; self-test all passed (tree held the peer session's uncommitted settings work)
- after 5fdf52c: typecheck clean, lint clean, npm test 165 files / 2498 tests pass, npm run selftest exit 0 (chat, forms, docs, settings results as expected)
