# Auto retro

**Contents**

- **Intent** — why a closed session gets a retro of its own.
- **Flow** — from the user's close to the retro row closing itself.
- **The queue** — which closes queue a retro, one run at a time, and what survives a restart.
- **The Retro section** — where a retro row shows and how it looks.
- **Unattended sessions** — how a launched row runs with nobody to answer it.
- **Done** — when a retro row counts as finished.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

The `wigley:retro` skill's analysis — digest, analysts, ledger, drafts — is the slow part of a retro. The user wants it
done before they ask, so a manual `/wigley:retro` only reports and asks. The `auto-retro` plugin starts a background
retro for each session the user closes, shows it running where the user can see it, and closes it when it is done.
The user never has to touch it. The skill's side of the split is its `auto <session ids>` mode
(`plugins/wigley/skills/retro/SKILL.md` § Modes in wigley-ai-marketplace).

## Flow

```
user closes a row ──► chat.sessionClosed (reason user, sent true)
                          │
                          ▼
              auto-retro queue (plugin data) ──► one run at a time
                          │
                          ▼
   chat.launch({ projectDir: ~/wigley-agents, profile, unattended: true,
                 message: "/wigley:retro auto <host ids>" })
                          │
                          ▼
     retro row in the Retro section ── turn ends, nothing running ──►
                          │
                          ▼
              chat.close(rowId, 'finished') ──► next queued close
```

## The queue

- **What queues.** A `chat.sessionClosed` with reason `user` and `sent` true, for a row this plugin did not launch.
  Every other reason — a failed start, `closeSessionsIn`, `finished` — and a quit queue nothing. A terminal session
  never closes in the app; the next manual retro's backfill finds it.
- **What a run gets.** The closed row's host session id and every id it had before a `/clear` (`chat.sessionCleared`),
  oldest first, and the row's profile. The plugin keeps each open row's earlier ids for this, since the close payload
  carries only the current one.
- **One at a time.** The ledger and its commits in `~/wigley-agents` take one writer, and two Opus retros at once spend
  the plan for nothing. The skill's ledger lock also keeps a manual run and a background run apart.
- **On disk.** The queue, the running row's id and every row id `launch` returned live in `queue.json` in the plugin's
  data. A close just before a quit runs on the next start; a retro row restored at start is still known as one, so
  closing it queues nothing. A running row that is gone at start (its profile was removed) is dropped and the next
  item launches.

## The Retro section

The sessions plugin draws its side bar as sections: Favorites, Recent, and every section a plugin registers through
the sessions page export `addSection`. `auto-retro` registers Retro, always last, which claims the rows it launched.
A section shows only while it holds a row, or its header has something to say.

- Rows sit flat, with no project groups: every retro runs in `~/wigley-agents`.
- A row's title is the title of the session it analyzes, and the sessions layout draws a claimed row muted, with a
  dashed accent edge, so it reads apart from the user's own sessions.
- The header counts the closes still queued (`2 queued`), drawn through the auto-retro layout.
- A click opens the row's Chat tab, to watch the run.

## Unattended sessions

`launch` takes `unattended: true` for a session nobody will answer. Chat keeps the flag with the row, across a relaunch
too, and answers each permission prompt in that row with a deny at once, naming the reason, so the agent works around
it rather than waiting. The session keeps the harness's default permission mode. The flag is harness-neutral: it lives
in chat, not in the Claude adapter.

## Done

A retro row is done when its main turn has ended and no subagent or task still runs: chat's `chat.session` slot reads
`activity` idle, `background` 0 and no compaction, after its first turn started. `chat.turnFinished` alone fires while
the analysts still run. A process that ended (clean or crash) is done too. A short settle wait keeps a task that ends
and wakes the agent from closing the row under a new turn.

On done the plugin calls chat's `close(rowId, 'finished')`. A `finished` close stays out of Recently closed and the
stash, which take `user` closes only, and queues no retro. A run that failed still closes: it never marked its
sessions seen, so the next manual retro's backfill analyzes them and its report says so.

## Decisions

- **A visible row, not a headless process.** The user wants to see the work happening without touching it. A row
  reuses chat's launch, its transcript view and its done signals; a headless one-shot would need its own process path
  and a status surface.
- **A section registration, not a special case in sessions.** Favorites and Recent were a closed list; any plugin
  that owns rows can now give them a section.
- **No on/off setting.** `plugins.disabled` switches the plugin off.
- **Deny, not allow, in an unattended row.** An allowed prompt would let an unwatched run do what the user's rules hold
  back; a denied one costs at most a retro that stops short, which the next manual run catches up.
- **The closed session's profile.** Its config folder holds the transcript, and `digest.py` reads
  `$CLAUDE_CONFIG_DIR/projects`.
