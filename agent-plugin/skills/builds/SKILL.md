---
name: builds
description: "Queueing and tracking CI and local builds through the Auri app's Builds plugin: the `builds.queue` and `builds.offer` commands run through `run_command`, the `builds.snapshot` state, and adding a tracked game to the `builds.backends` setting. Use when asked to make, run, kick off or check a build or a build set (such as an RC set) of a game from a session the app started, when a wrap-up's change reaches players only through a build, or when asked to track a game's builds."
---

**Contents**

- **Intent** — the app tracks the build; the agent queues and stops.
- **Queueing** — `builds.queue`, its argument, and what to report.
- **Offering at a wrap-up** — `builds.offer` instead of a chip.
- **Reading state** — `builds.snapshot` through `read_state`.
- **Tracking a game** — writing an entry into `builds.backends`.
- **When the build ends** — the message the app sends.

## Intent

The app polls each build backend and shows every build's progress in Builds mode and under the
session's row. The agent queues a build, reports that it started, and ends its turn: the app sends
the session a message when the build ends, with the result, the links and any failed job. A
background watch on the build spends a subagent or a shell for nothing the app does not already do.

## Queueing

- Run the `auri` server's `run_command` tool with `builds.queue` and the argument
  `{ "backend": "<backend id>", "game": "<game id>", "kind": "<kind or set id>", "branch": "<branch>" }`.
  The ids are the ones in `builds.snapshot`. A set id (such as `rc`) queues every kind of the set on
  one revision.
- The command is risky: the user's Allow in the app is the yes. The user's own ask to build is
  still needed before the call, since a queue spends shared build machines and reaches testers.
- For a backend that chooses the branch (TeamCity), the app pins the revision to the branch's origin
  head, read from the game's clone, and refuses a branch origin does not hold; for a set the branch
  must match the set's `branches` pattern. Work that is not pushed is not in the build: check the
  branch on origin holds the work before queueing. A local backend builds the clone as it stands.
- A queue the app refuses comes back as the `run_command` error with the reason.
- Report on start: the game, the kind, the branch, the short revision, and the build's link from
  `builds.snapshot`. Then end the turn.

## Offering at a wrap-up

When the run's change reaches players only through a build, run `builds.offer` with the same
argument shape instead of writing a `device build` chip (the call is refused outside a session the app started, which has no calling session). The session then shows an offer card with a
Queue button; the user's press queues it. One offer per session: a new one replaces the last.

## Reading state

The `auri` server's `read_state` tool with `builds.snapshot` returns every backend, its games and
their newest builds, each with its state, progress, branch, revision, links and jobs. Read it to
answer "how did the build go" or "what is running" before reaching for a backend's own CLI.

## Tracking a game

On the user's ask to track a game, look the game up with the backend's own tools, then add an
entry under that backend's `games` in the `builds.backends` setting of `~/.config/wigley-ai-gui/settings.json`, in the shape the
app's Builds design gives (`docs/features/builds/design.md` § Configuration in the app's repo): an
`id`, `label`, `clone`, `defaultBranch`, `kinds` (each with a `label` and a `target`), and `sets`
when the game has build sets. The app reloads the setting at once and shows any problem with the
entry on the backend's heading in Builds mode; read it back with `read_state` and fix what it names.

## When the build ends

The first time a job of a running build fails, the app sends `Build failing:` with that job's label,
id and status text: read its log then, while the other jobs run.

The app sends the session one message that opens `Build ended:` (or `Set ended:` for a set), with
the result, the branch and revision, the links and the backend's page. A failure names each failed
job's label, id and status text. Answer it: report the links on success; on failure, read the
failed job's log with the backend's own tools and report the cause.
