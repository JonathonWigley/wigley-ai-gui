# Projects

**Contents**

- **Status** — what is built.
- **Projects** — what a project is and how settings write one down.
- **Start prompt** — the Project and Other folder steps.
- **Pool projects** — the clone a new session starts in, and resume.
- **Membership** — which project a folder belongs to, and what reads it.
- **Starting from an agent** — `start_session` and `launch` with a project.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

The user works on a few projects, not on folders: New Games, spread over four Unity clones on whatever branch each
holds, and Wigley AI Dev, four repos in one parent folder. A project fixes where a new session starts and which profile
it runs under, so the user picks one line and the agent lands in the right place.

## Status

Built, in `src/plugins/chat/main/projects.ts` (the setting's checks, `projectOf`, the pool provider registry), the
start path in `src/plugins/chat/main/chat-sessions.ts` (`resolveTarget`), `src/plugins/chat/main/start-session-tool.ts`
(`project`), the page steps in `src/plugins/chat/page/start-prompt.ts` and `start-prompt-items.ts`,
`src/plugins/unity-pool/main/pool-provider.ts`, and sessions' `addProjectNamer` (`src/plugins/sessions/`).

## Projects

A project is an entry in chat's `projects` setting (`chat.projects` in `~/.config/wigley-ai-gui/settings.json`),
edited as JSON in Settings mode:

```json
"projects": [
  { "name": "New Games", "pool": "new-games-prototypes", "profile": "work" },
  { "name": "Wigley AI Dev", "folder": "~/Documents/ai-dev" }
]
```

- `name` — what the start prompt and the side bar show; unique.
- `folder` or `pool`, exactly one. A **folder project** starts in its folder (`~` is the home folder). A **pool
  project** names a `unity-pool` pool and starts in the pool's lowest-numbered clone. Neither checks anything out.
- `profile` — optional. Set, every session of the project runs under that profile and the prompt asks none. Left
  out, the prompt asks: a folder project pre-selects the profile last used in its folder, a pool project the first
  profile.

The default is an empty list. Chat checks each entry when it reads the setting, since the settings check cannot type
the elements of an empty default list: an entry with neither or both of `folder` and `pool`, or a name an earlier
entry took, is left out, and the log names the entry and its fault. A key no project reads is ignored, so an entry
still carrying the retired `pinnedBranches` list reads as before without it.

## Start prompt

`Space b n` opens on **Project**: each project in settings order, labelled by name and its folder or pool, then
**Other folder…**, which opens the folder step as it was before projects (recent folders, `Choose folder…`). With no
projects in the settings, `Space b n` opens the folder step, as before projects.

- A project with no `profile` goes to **Profile**; a project with one passes it over, and one naming a profile the
  settings lack stops with a toast. The sign-in check runs either way.
- The session step lists the project's saved sessions from every folder it covers — for a pool project, all its
  clones — each resuming in the folder it ran in.

## Pool projects

A new session in a pool project opens in the pool's lowest-numbered clone, as the pool provider's `folders` lists
them, and starts its agent there at once, holding no claim: chat fires `sessionOpened` with that clone as the folder,
as for any new session. A pool with no clones in its state stops the start with `Pool "<pool>" has no clones.`

The agent claims a clone itself when its work needs one, with `unity-pool claim --branch <branch>`, which hands back
the clone to work in; the pool's hooks renew that claim from then on, as for any agent's claim. The app never claims
for a session.

Resuming a pool project's saved session reopens it in the clone it ran in, with no claim: a transcript is tied to its folder,
and when its agent claims again the pool's sticky ranking and stranded hand-back favour that clone.

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

`start_session` and chat's `launch` take `project` in place of `projectDir`; the profile is the project's, else the
one the caller names, else the caller's own; a named profile that differs from the project's is refused. The start
runs the same path as the prompt. A call names `folder` or `project`, not both. A pool project's session claims no
clone, so a caller whose work needs a branch names it in the prompt it sends.

## Decisions

- **Chat owns projects; unity-pool plugs in.** unity-pool depends on chat, so chat cannot call it. Chat exports
  `addPoolProvider`, as it exports `addResumeSection`, and unity-pool registers its clone folders through it.
- **The agent claims, not the app.** A claim at launch held the row resting for seconds before the agent could start,
  and pinned the session to one branch before the user had said what the work was. The agent knows the branch its
  work needs, and the pool's own `claim` already moves it to a clone on that branch.
- **Membership is worked out from the folder, never stored.** It matches how the side bar already groups, and covers
  every session open before projects existed. Renaming a project regroups its sessions.
- **A project checks nothing out.** Wigley work lands through per-run worktrees off `main`, and a pool's branch is the
  agent's claim to make, so the app has no branch to set.

## Out of scope

- A per-item settings editor for projects: Settings mode edits the list as JSON.
- Codex sessions: they read the pool but do not claim.
