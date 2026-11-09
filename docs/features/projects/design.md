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

Planned (`plan-project-picker/`).

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
  out, the prompt asks, pre-selecting the profile last used in the project's folder.
- `pinnedBranches` — optional, pool projects only: the branches listed first, in this order.

The default is an empty list. Chat checks each entry when it reads the setting, since the settings check cannot type
the elements of an empty default list: an entry with neither or both of `folder` and `pool`, a `pinnedBranches` on a
folder project, or a name an earlier entry took is left out, and the log names the entry and its fault.

## Start prompt

`Space b n` opens on **Project**: each project in settings order, labelled by name and its folder or pool, then
**Other folder…**, which opens the folder step as it was before projects (recent folders, `Choose folder…`).

- A pool project goes to **Branch**: its pinned branches, then every other branch on origin, newest commit first,
  filtered as the user types (`/`). The list opens from the refs each clone last fetched, and refreshes once a
  background fetch lands, keeping the cursor's branch and any filter typed meanwhile.
- A project with no `profile` goes to **Profile**; a project with one passes it over. The sign-in check runs either
  way.
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
   plugins that copied the folder at connect (docs, workflow) take the clone, and chat fires `sessionOpened` only
   now, with the clone as the folder; a row whose claim never lands fires neither `sessionOpened` nor
   `sessionClosed`.

Closing the row while the claim runs cancels the claim: the provider stops the CLI, and a queue ticket nobody polls
drops after two minutes. A claim that fails (`dirty`, `unknown-branch`, `no-cli`, `internal`) leaves the row resting
with the CLI's message as an error notice. A `diverged` claim keeps its clone, by the pool's rules, so the agent
starts there with the CLI's message as a notice, to settle the divergence.

Resuming a pool project's saved session reopens it in the clone it ran in, with no claim: a transcript is tied to its
folder, and the pool's sticky ranking and stranded hand-back already return that clone to the row.

The pool's rules, the claim's JSON and its error codes are the pool's own: `~/wigley-agents/tools/unity-pool/README.md`.

## Membership

A folder belongs to a project when it is the project's folder or under it, or, for a pool project, when it is one of
the pool's clones or under one. `projectOf` in chat main answers it, and the first project in settings order wins.
Sessions started through Other folder, sessions already open, and saved ones all take their project this way.

- **Side bar**: the row's `project` is the project's name when its folder has one, else the origin repo name as
  before (`docs/features/session-groups/design.md` § Projects). Chat registers the rule with sessions main
  (`addProjectNamer`).
- **Session step**: a project's saved sessions are those whose folders it covers.

## Starting from an agent

`start_session` and chat's `launch` take `project` and, for a pool project, `branch`, in place of `projectDir`; the
profile is the project's, else the one the caller names, else the caller's own. The start runs the same path as the
prompt, the claim on the row included.

## Decisions

- **Chat owns projects; unity-pool plugs in.** unity-pool depends on chat, so chat cannot call it. Chat exports
  `addPoolProvider`, as it exports `addResumeSection`, and unity-pool registers its branch list, clone folders and
  claim through it.
- **The claim waits on the row, not in the picker.** The claim needs the row id, and a claim takes seconds even with a
  clone free; the user keeps working while it waits, and the wait shows where the session will live.
- **Membership is worked out from the folder, never stored.** It matches how the side bar already groups, and covers
  every session open before projects existed. Renaming a project regroups its sessions.
- **A folder project checks nothing out.** Wigley work lands through per-run worktrees off `main`, so the app has no
  branch to set.

## Out of scope

- A per-item settings editor for projects: Settings mode edits the list as JSON.
- Codex sessions: they read the pool but do not claim.
