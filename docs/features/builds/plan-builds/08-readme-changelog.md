# 08 — README and changelog

Status: in progress
Type: Batch
Rung: standard · every README and changelog line is pinned below
Wave: 4 · Depends on: 03 (its lines describe the landed commands and setting), 04 (its lines describe the landed plugin), 05 (its lines describe the landed plugin), 06 (its lines describe the landed keys), 07 (the landed binds `<Leader>mm`, `<Leader>mx` and the row, hub and offer parts)
Plan: [plan.md](plan.md)

Files:
- modify `README.md`
- modify `CHANGELOG.md`

Consumes:
- the landed plugins of 03, 04, 05 and 06; task 02 registered all three plugins in the composition roots
- the landed binds `<Leader>mm` and `<Leader>mx` in `src/plugins/keymap.ts`, and the row line, hub section and offer
  card parts ← 07
- `agent-plugin/skills/builds/SKILL.md` (in the tree, commit `74643ff2c`)

Produces:
- the README rows and changelog lines below

Decisions:
- First, before any edit: rebase the run's branch onto `main`, then read `README.md` and `CHANGELOG.md` again. The
  peer run `shareable-app` edits these files on `main` (plan.md § Preconditions); an edit made on the old text
  conflicts with it.
- Check each command id, setting key and key bind below against the landed manifests and `src/plugins/keymap.ts`
  before writing it. A difference is a concern: write the landed name and report it.
- README (AGENTS.md § README, changelog and boundary: a new built-in plugin, setting and `auri` skill each update
  `README.md` in the same change). The README has no commands or keys section, so the commands and keys go in the
  changelog only. Add, verbatim:
  - in § Settings, the By plugin table, after the `scheduling` row:
    `| \`builds\` | \`builds.backends\`, \`builds.layout\` |`
  - in § Settings, Settings worth setting first, after the `unity-pool.scriptPath` item:
    `- \`builds.backends\` — the build backends this machine uses (\`teamcity\` or \`local\`), each with the games it
    tracks, their build kinds and their sets. An agent adds a game on the user's ask.`
  - in § Built-in plugins, after the `scheduling` row:
    `| \`builds\` | Builds mode: the CI and local builds of the tracked games, queued in one press; each session's builds on its row and in its hub, and a build offer above its composer. |`
    `| \`builds-teamcity\` | The \`teamcity\` build backend, over the TeamCity CLI. |`
    `| \`builds-local\` | The \`local\` build backend: a command per build kind, run in the game's clone. |`
  - in § Skills, after the `live-view` row:
    `| \`builds\` | Queueing and offering builds, reading \`builds.snapshot\`, and tracking a game in \`builds.backends\`. |`
- Changelog: under `## Unreleased`, `### Added`, after the last line there, add verbatim:
  - `- Builds mode (\`Space k m\`) shows the CI and local builds of the games each machine tracks in
    \`builds.backends\`: a side bar of games, each build's branch, commit, progress and who queued it, and an All feed
    with All, Running and From sessions filters. \`q\` or \`Space m q\` queues a build or a build set on a branch.`
  - `- A session shows its newest build on its row (\`building\` while it runs) and every build it queued in the hub's
    Builds section, and the app messages the session when a build fails a job and when it ends.`
  - `- Agents queue builds with \`builds.queue\` and offer one at a wrap-up with \`builds.offer\`; the offer card above
    the composer queues it (\`Space m m\`) or dismisses it (\`Space m x\`). The \`auri:builds\` skill teaches both.`
  - `- Build backends are plugins: \`builds-teamcity\` over the TeamCity CLI, and \`builds-local\`, which runs a
    command per build kind in a game's clone.`
- Boundary: no README or changelog line names a user's server, project id, branch, path or skill (plan.md
  § Boundary rules; AGENTS.md § README, changelog and boundary).

GIVEN the README edited WHEN a reader looks up `builds.backends` THEN § Settings names it under `builds`.

Tests:
- None: the README and changelog are copy (`wigley:writing-tests` § What earns neither).

Done when:
`grep -n "builds-teamcity\|builds-local\|builds.backends" README.md` lists the § Settings and § Built-in plugins
lines above. Every live, visual and drive
check goes to task 10 "Final verification".
Commit: one commit for the group: `builds: README and changelog`.

## Proof
