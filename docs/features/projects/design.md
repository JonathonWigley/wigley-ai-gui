# Projects

**Contents**

- **Status** — what is built.
- **Projects** — what a project is and how settings write one down.
- **Start prompt** — the Project, Branch and Other folder steps.
- **Pool projects** — the branch list, the claim on the row, and resume.
- **Membership** — which project a folder belongs to, and what reads it.
- **Starting from an agent** — `start_session` and `launch` with a project.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

The user works on a few projects, not on folders: New Games, spread over four Unity clones on whatever branch each
holds, and Wigley AI Dev, four repos in one parent folder. A project fixes where a new session starts, which profile it
runs under and, for a Unity pool, which branch its clone is on, so the user picks one line and the agent lands in the
right place.

## Status

Built, in `src/plugins/chat/main/projects.ts` (the setting's checks, `projectOf`, the branch order, the pool provider registry), the
start path in `src/plugins/chat/main/chat-sessions.ts` (`startInPool`, the claim notices, `claimSettled`),
`src/plugins/chat/main/start-session-tool.ts` (`project` and `branch`), the page steps in
`src/plugins/chat/page/start-prompt.ts` and `start-prompt-items.ts`, `src/plugins/unity-pool/main/pool-provider.ts` and
the claim run in `pool-cli.ts` (`runPoolClaim`), and sessions' `addProjectNamer` and `relocate`
(`src/plugins/sessions/`).

## Projects

A project is an entry in chat's `projects` setting (`chat.projects` in `~/.config/wigley-ai-gui/settings.json`),
edited as JSON in Settings mode:

```json
"projects": [
  { "name": "New Games", "pool": "new-games-prototypes", "profile": "work",
    "pinnedBranches": ["main", "protos/physics-fun", "protos/hungry-shelves"] },
  { "name": "Wigley AI Dev", "folder": "~/Documents/ai-dev" }
]
```

- `name` — what the start prompt and the side bar show; unique.
- `folder` or `pool`, exactly one. A **folder project** starts in its folder (`~` is the home folder) and checks
  nothing out. A **pool project** names a `unity-pool` pool and starts in the clone a claim gives it.
- `profile` — optional. Set, every session of the project runs under that profile and the prompt asks none. Left
  out, the prompt asks: a folder project pre-selects the profile last used in its folder, a pool project the first
  profile.
- `pinnedBranches` — optional, pool projects only: the branches listed first, in this order, each listed even when
  origin lacks it.

The default is an empty list. Chat checks each entry when it reads the setting, since the settings check cannot type
the elements of an empty default list: an entry with neither or both of `folder` and `pool`, a `pinnedBranches` on a
folder project, or a name an earlier entry took is left out, and the log names the entry and its fault.

## Start prompt

`Space b n` opens on **Project**: each project in settings order, labelled by name and its folder or pool, then
**Other folder…**, which opens the folder step as it was before projects (recent folders, `Choose folder…`). With no
projects in the settings, `Space b n` opens the folder step, as before projects.

- A pool project goes to **Branch**: its pinned branches, then every other branch on origin, newest commit first,
  filtered as the user types (`/`). The list opens from the refs each clone last fetched, and refreshes once a
  background fetch lands, keeping the cursor's branch and any filter typed meanwhile. When the fetch fails or lists
  nothing while the last-fetched list shows, an info toast says `Branches not refreshed: <reason>`. When both reads
  fail or list nothing, the step does not open and an error toast names the fetch's reason.
- A project with no `profile` goes to **Profile**; a project with one passes it over, and one naming a profile the
  settings lack stops with a toast. The sign-in check runs either way.
- The session step lists the project's saved sessions from every folder it covers — for a pool project, all its
  clones — each resuming in the folder it ran in.

## Pool projects

A new session in a pool project starts in two parts, because the pool records the app's row id on the claim and
that id exists only once the row is open:

1. Chat opens the row at once, resting, in the pool's lowest-numbered clone, and shows *Claiming a Unity clone on
   `<branch>`…* on it (*Waiting for a Unity clone…* while the claim queues).
2. The pool provider runs `unity-pool claim --branch <branch> --pool <pool> --wait --json` with
   `CLAUDE_CODE_SESSION_ID` set to the host session id chat is about to start the agent under and
   `WIGLEY_SESSION_ROW` set to the row's id. The agent's own hooks renew the claim from its first tool call, and
   `/clear` hands it to the fresh session as for any claim.
3. When the claim lands, chat moves the row to the clone it got (`sessions.relocate`) and starts the agent there, so
   its `AGENTS.md`, skills and transcript are the clone's from the first message. Sessions emits `relocated`, so
   docs, which copied the folder at connect, takes the clone, and chat fires `sessionOpened` only now, with the
   clone as the folder, which workflow's flow takes; a row whose claim never lands fires neither `sessionOpened` nor
   `sessionClosed`.

Closing the row while the claim runs cancels the claim: the provider stops the CLI, then runs `unity-pool release
--json` under the same ids, since the CLI may have been killed after it granted a clone. The provider releases the
same way after a claim that answers `internal` or `cli-failed`, which the CLI can give past the grant, and chat hands a
landed claim back through the provider's `release` when the row closed before it landed or the move to the clone
throws; that row's notice reads `Unity clone not used, releasing it: <reason>`. A claim stopped by the app quitting
gets no release: the pool's claim expiry frees its clone. A claim cancelled while it
queues leaves its queue ticket behind: the pool drops a ticket nobody polls after two minutes. A claim that fails (`dirty`,
`unknown-branch`, `no-cli`, `cli-failed`, `internal`) leaves the row resting with the error notice `Unity clone not
claimed: <the CLI's message>`; a message sent to that row is refused. A `diverged` claim keeps its clone, by the pool's rules, so the agent
starts there with the CLI's message as a notice, to settle the divergence.

A restart cancels a running claim too, and the provider releases it as for a closed row. Unity-pool restarting alone
stops its provider, so the row rests with `Unity clone not claimed: claim cancelled`. Chat restarting takes unity-pool
with it and ends the row: chat keeps only the rows its restore adopts, and a row with a claim, running or failed, is
not saved. A row whose claim landed is saved in its clone and comes back like any other.

Resuming a pool project's saved session reopens it in the clone it ran in, with no claim: a transcript is tied to its
folder, and the pool's sticky ranking and stranded hand-back already return that clone to the row.

The pool's rules, the claim's JSON and its error codes are the pool's own: `~/wigley-agents/tools/unity-pool/README.md`.

## Membership

A folder belongs to a project when it is the project's folder or under it, or, for a pool project, when it is one of
the pool's clones or under one. `projectOf` in chat main answers it, and the first project in settings order wins.
Sessions started through Other folder, sessions already open, and saved ones all take their project this way.

- **Side bar**: the row's `project` is the project's name when its folder has one, else the origin repo name as
  before (`docs/features/session-groups/design.md` § Projects). Chat registers the rule with sessions main
  (`addProjectNamer`) and re-asks it when the projects setting changes, when a pool provider registers or goes, and
  when the provider's handle says its clones changed, as unity-pool's does on each state change, so clone rows take
  the project's name once the pool's first read lands.
- **Session step**: a project's saved sessions are those whose folders it covers.

## Starting from an agent

`start_session` and chat's `launch` take `project` and, for a pool project, `branch`, in place of `projectDir`; the
profile is the project's, else the one the caller names, else the caller's own; a named profile that differs from
the project's is refused. The start runs the same path as the
prompt, the claim on the row included. A call names `folder` or `project`, not both, and `branch` only with `project`.
For a pool project the tool answers once the row is open, before the claim lands.

## Decisions

- **Chat owns projects; unity-pool plugs in.** unity-pool depends on chat, so chat cannot call it. Chat exports
  `addPoolProvider`, as it exports `addResumeSection`, and unity-pool registers its branch list, clone folders, claim
  and release through it.
- **The claim waits on the row, not in the picker.** The claim needs the row id, and a claim takes seconds even with a
  clone free; the user keeps working while it waits, and the wait shows where the session will live.
- **Membership is worked out from the folder, never stored.** It matches how the side bar already groups, and covers
  every session open before projects existed. Renaming a project regroups its sessions.
- **A folder project checks nothing out.** Wigley work lands through per-run worktrees off `main`, so the app has no
  branch to set.

## Out of scope

- A per-item settings editor for projects: Settings mode edits the list as JSON.
- Codex sessions: they read the pool but do not claim.
