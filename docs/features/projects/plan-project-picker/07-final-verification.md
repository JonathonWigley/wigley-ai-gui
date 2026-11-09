# 07 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     modify `~/.config/wigley-ai-gui/settings.json` (personal) · modify `~/.agents/AGENTS.local.md` (personal)
Consumes:  everything 01–06 landed
Produces:  the user's two projects in settings; the machine note; the live checks below run or handed to the user
Decisions: settings and the machine note are personal files, changed as Decided (`decisions.md` § Personal and team
           files); the settings edit waits for the installed app to know `chat.projects`, because the settings check
           rejects an unknown setting

## 1. Install, then settings

`npm run install-app` quits and restarts the user's running stable app (sessions keep running in the session host).
Ask for the yes in one chat line naming that restart. On the yes, run it from the clone after the branch lands on
`main`; then add to `~/.config/wigley-ai-gui/settings.json`, under `"chat"`, exactly:

```json
"projects": [
  { "name": "New Games", "pool": "new-games-prototypes", "profile": "work",
    "pinnedBranches": ["main", "protos/physics-fun", "protos/hungry-shelves"] },
  { "name": "Wigley AI Dev", "folder": "~/Documents/ai-dev" }
]
```

Read the file first and merge into its existing `chat` object; keep every other key. Without the yes, the wrap-up's
Needs you carries "say **install**" and this snippet, and the settings file is left untouched.

## 2. Machine note

Add to `~/.agents/AGENTS.local.md` § Projects, on the new-games-prototypes pool bullet, after its first sentence:
"A session the app started from the New Games project already holds its clone on the branch the user picked; its
claim before the first write keeps that clone." Word it to `wigley:writing-for-agents`.

## 3. Live checks

Run each the repo's own tooling reaches (`npm run selftest -- --plugin <id>`, filtered; a drive run in
`scripts/drive-*` when one reaches the start prompt). Each is tagged with why it earns a live run
(`wigley:writing-tests` § What earns a live run instead):

- **expected** — Start prompt opens on Project with both projects and `Other folder…`; Other folder… shows today's
  folder step.
- **expected** — Wigley AI Dev → Profile step → a session whose folder is `~/Documents/ai-dev`, grouped in the side
  bar as `Wigley AI Dev`.
- **low-confidence** (wiring a unit test cannot see: the real CLI, env and row move) — New Games → `protos/physics-fun`
  → the row shows `Claiming a Unity clone on protos/physics-fun…`, then the agent starts in a clone on that branch;
  `unity-pool status` shows the clone claimed by the session's id and row. Release the clone afterwards
  (`unity-pool release` with the session's id is the agent's own; else leave it to expire clean — it is a free,
  clean clone the run itself claimed).
- **low-confidence** — `/clear` in that session keeps the clone (`unity-pool status` shows the claim moved to the new
  session id, same row).
- **low-confidence** — closing a row while it shows `Claiming…` stops the CLI and starts no agent.

A check only the user's hands can settle — the real app's picker after install — goes to the wrap-up's Needs you with
its steps and expected result, nowhere else.

Done when: install and settings done or handed to the wrap-up; the note written; each live check run with its result
in the Proof, or handed to the wrap-up.
Commit:    none in the repo (personal files only); the Proof records the edits.

## Proof
