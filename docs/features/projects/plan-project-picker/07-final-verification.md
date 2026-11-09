# 07 — Final verification

Status: done
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     modify `~/.config/wigley-ai-gui/settings.json` (personal) · modify `~/.agents/AGENTS.local.md` (personal)
Consumes:  everything 01–06 landed
Produces:  the user's two projects in settings; the machine note; the live checks below run or handed to the user
Decisions: settings and the machine note are personal files, changed as Decided (`decisions.md` § Personal and team
           files); the settings edit waits for the installed app to know `chat.projects`, because the settings check
           rejects an unknown setting

Run in this order: the checks that need no install, then the install and settings, then the installed-app checks.

## 1. Checks before the install

Run on the worktree build through the repo's own tooling (`npm run selftest -- --plugin <id>`, filtered; a drive run
in `scripts/drive-*`). A drive run starts the app in `.drive/<run-id>/` with its own home and settings, so the run
writes its own `chat.projects` there (a folder project on a scratch folder) and has no `unity-pool` or pool state.
Each check is tagged with why it earns a live run (`wigley:writing-tests` § What earns a live run instead):

- **expected** — Start prompt opens on Project with the projects and `Other folder…`; Other folder… shows today's
  folder step.
- **expected** — a folder project → Profile step → a session whose folder is the project's, grouped in the side bar
  under the project's name.

## 2. Install, then settings

`npm run install-app` quits and restarts the user's running stable app (sessions keep running in the session host).
Ask for the yes in one chat line naming that restart. On the yes, run it from the clone after the branch lands on
`main`; then set, in `~/.config/wigley-ai-gui/settings.json`, `chat.projects` to exactly:

```json
"projects": [
  { "name": "New Games", "pool": "new-games-prototypes", "profile": "work",
    "pinnedBranches": ["main", "protos/physics-fun", "protos/hungry-shelves"] },
  { "name": "Wigley AI Dev", "folder": "~/Documents/ai-dev" }
]
```

Read the file first. At plan time it held only `fonts` and `keys` (measured, re-verify): add a `chat` object holding
`projects` when none exists, else merge `projects` into it; keep every other key. `work` is one of chat's default
profiles, so no profile entry is needed. Without the yes, the wrap-up's Needs you carries "say **install**" and this
snippet, and the settings file is left untouched.

## 3. Machine note

Add to `~/.agents/AGENTS.local.md` § Projects, on the new-games-prototypes pool bullet, after its first sentence:
"A session the app started from the New Games project already holds its clone on the branch the user picked; its
claim before the first write keeps that clone." Word it to `wigley:writing-for-agents`.

## 4. Installed-app checks

These need the user's real settings, `unity-pool` and pool, so they run only against the installed app. The agent
cannot drive the installed app's start prompt; each goes to the wrap-up's Needs you with its steps and expected
result:

- **low-confidence** (wiring a unit test cannot see: the real CLI, env and row move) — New Games →
  `protos/physics-fun` → the row shows `Claiming a Unity clone on protos/physics-fun…`, then the agent starts in a
  clone on that branch; `unity-pool status` shows the clone claimed by the session's id and row.
- **low-confidence** — `/clear` in that session keeps the clone (`unity-pool status` shows the claim moved to the new
  session id, same row).
- **expected** — Wigley AI Dev → Profile step → a session in `~/Documents/ai-dev`, grouped as `Wigley AI Dev`.

Closing a row while it shows `Claiming…` needs a claim that waits (every clone held), which the user's real pool
should not be forced into: task 04's `claim_SignalAndDispose_AbortTheRun` and `claim_Cancelled_ReleasesUnderTheSameIds`
and task 03's close-mid-claim test cover it, and no live check is asked.

Done when: the § 1 checks run with their results in the Proof; install and settings done or handed to the wrap-up;
the note written; the § 4 checks in the wrap-up's Needs you.
Commit:    none in the repo (personal files only); the Proof records the edits.

## Proof

Commit none (personal files only) · proof: §1 drive run pp07: Project step lists the project and Other folder… → Folder step (PASS); folder project → Profile → Session → session in the project folder, grouped 'Scratch Project' (PASS); captures read. §3 note added to ~/.agents/AGENTS.local.md new-games-prototypes pool bullet. §2 install + settings.json and §4 installed-app checks run after landing / go to the wrap-up · concerns: none
