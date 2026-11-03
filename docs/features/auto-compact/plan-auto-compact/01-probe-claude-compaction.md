# 01 — Probe Claude's compaction lines

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `docs/features/agent-chat/claude-stream.md` (§ Compaction and the version lines at the top of the file).
           Scratch only, never committed: `/tmp/claude-autocompact/probe/` (the driver and its logs) and
           `/tmp/claude-autocompact/project-*/` (the probe's working folders).
Consumes:  nothing from this plan. The installed `claude` 2.1.317 (`~/.local/bin/claude` →
           `~/.local/share/claude/versions/2.1.317`).
Produces:  measured facts in `claude-stream.md` § Compaction, one subsection each:
           `Automatic compaction`, `Interrupt during /compact`, `A message during /compact`,
           `/compact with nothing to compact`, `Saved transcript lines`. Task 02 reads these facts.

## Why this task

The design assumes facts that no probe has measured yet. § Compaction has only one manual `/compact` on 2.1.316.
Its last line says: "Not measured: an automatic compaction (`trigger` other than `manual`), and the lines it
prints." § Interrupt measures an interrupt only on a model turn and on an idle process. No probe wrote a message
during a running `/compact`. No probe read a saved transcript's compaction lines. Task 02 builds the adapter on
these facts, so this task measures them first.

## Decisions

- **Probe method.** Use the method of claude-stream.md § "How every probe ran" (lines 12–24). Write a `python3`
  stdlib driver. It starts the binary with `subprocess.Popen` (stdin, stdout and stderr pipes). It logs every stdout
  line, and every line it writes, with seconds since spawn. Put the driver in `/tmp/claude-autocompact/probe/`.
  Use these settings:
  - binary `~/.local/bin/claude`
  - cwd: a new folder `/tmp/claude-autocompact/project-<letter>/` for each process. Each folder holds one file,
    `notes.txt`, with the line `spike`.
  - env: the driver's environment with `CLAUDE_CONFIG_DIR=$HOME/.claude-personal`. Remove the nested-session
    variables § Launch lists (`AI_AGENT`, `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_AFK_TIMEOUT_MS`,
    `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` and every `CLAUDE_CODE_*`). Then add the probe's own variables (probe A).
  - flags: `-p --input-format stream-json --output-format stream-json --include-partial-messages --verbose
    --session-id <fresh uuid4> --model haiku --effort low`
  - every stdin user message carries a fresh `uuid`, so `command_lifecycle` frames come (§ Message lifecycle)
- **Run `claude` directly, never through the app.** The app's launch strips `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
  (`src/main/claude-code/claude-launch.ts`, `NESTED_SESSION_ENV`; `docs/features/usage/design.md` § The usage
  plugin). Probe A needs that variable.
- **Cost.** Each probe costs money on the user's account. Use haiku at low effort. Keep each prompt to one short
  instruction. Keep the context small. Run each probe once. Run the probe-A fallback only if the first attempt
  fails, and only once.
- **State.** The probes write session transcripts into `~/.claude-personal/projects/-tmp-claude-autocompact-project-*/`,
  as the earlier probes did. These transcripts are new, so the probes change no existing state. Do not delete them:
  probe D reads them.
- **The excerpts.** Write excerpts in the style of the existing § Compaction block: seconds since spawn, then the
  line trimmed to the fields that a fact uses, with `…` at each cut. Write `IN` before each line the driver wrote.

### How to force an automatic compaction (probe A)

The 2.1.317 binary has these levers. They come from its strings, and no probe has measured them:

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<tokens>` sets the autocompact window. The binary accepts 100k to 1M. (Its
  message: "Set it to a size from 100k to 1M, such as 200k or 200000, or unset it.")
- The threshold is that window minus a summary buffer. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<percent>` lowers it further.
  The binary's schema says this ("lowered further by CLAUDE_AUTOCOMPACT_PCT_OVERRIDE when set").
- `get_context_usage` may report the threshold without the override. On 2.1.314 it reported `967000` with the
  override at 30 (usage design.md). So do not use that reply to check the override.

First attempt: start with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5` in the
child environment. Turn 1: `U(Reply with the single word ok.)`. Turn 2, after turn 1's `result`:
`U(Use the Bash tool to run cat notes.txt, then reply with the single word done.)`. The system prompt alone is above
5 % of 100k. So the compaction fires before a model request in turn 2, either at the turn's start or between the
tool result and the next request.

Fallback (run it only if no `compact_boundary` came in the first attempt): use the same window and no override.
Write `big.txt` into the project folder: about 360,000 characters of plain text, about 90k tokens. Turn 1:
`U(Read the file big.txt and reply with the single word ok.)`. Turn 2 is the same as above. The context then
crosses the window minus the buffer.

If the fallback also makes no compaction, record in the doc what you tried and what came back. Report this to the
lead as a concern. Then continue with probes B to E.

## Probes

Each probe is a new process with its own project folder and session id.

- **A — automatic compaction.** As above. Log 30 s after turn 2's `result`, then close stdin. Record:
  - every line from turn 2's `init` to its `result`, in order, with times
  - each `system/status` line with `status: "compacting"`: how many there are, whether they carry
    `user_message_uuid` or `user_message_uuids`, and whether they carry `compact_output_chars`
  - whether `system/status` with `status: null` and `compact_result` comes, the hook pair (`SessionStart:compact`
    or other names), and whether a second `system/init` comes inside the turn
  - where the compaction falls relative to turn 2's `init`, its tool call and its `result`
  - `compact_boundary`: every `compact_metadata` field, with the `trigger` value verbatim
  - the summary `user` line and any `<local-command-stdout>` replay
  - the next main `assistant` line's `usage` (`input_tokens`, `cache_creation_input_tokens`,
    `cache_read_input_tokens`, `output_tokens`), next to `pre_tokens` and `post_tokens`
  - any line type that § Compaction does not name (for example `autocompact_state`)
  - the `command_lifecycle` frames of turn 2's message
- **B — plain interrupt during `/compact`.** Turn 1: `U(Reply with the single word ok.)`. After its `result`, write
  `U(/compact)` with uuid `C`. At the first `system/status` `compacting` line, write
  `{"type":"control_request","request_id":"probe-int","request":{"subtype":"interrupt"}}`. Log 30 s after the
  interrupt, then send `U(Reply with the single word after.)` and log until its `result`. Record:
  - the `control_response` and its `response` fields
  - whether each of these comes, and when: `compact_boundary`, `system/status` with `status: null` (and its
    `compact_result` and `compact_error`), `system/init`, a `result` (its `subtype`, `is_error`, `local_command`,
    `user_message_uuid`, `terminal_reason`), an interrupt marker `user` line, and `command_lifecycle` for `C` (which
    terminal state)
  - the time from the interrupt to the last compaction line
  - whether the `after` turn runs normally
- **C — a user message during `/compact`.** Turn 1 as in B. Write `U(/compact)` with uuid `C`. At the first
  `compacting` status, write `U(Reply with the single word two.)` with uuid `T`. Log until `T`'s `result` and 5 s
  more. Record:
  - `T`'s `command_lifecycle` frames with times, relative to the compaction lines and `C`'s `result`
  - whether `T` runs as its own turn (own `init` and `result`) after the compaction, or is folded, cancelled or
    dropped
  - the `usage` of `T`'s reply (the after-size)
- **E — `/compact` with nothing to compact.** A new process. Write `U(/compact)` with uuid `C` as the first
  message. Log 20 s. Record every line, including `compacting` statuses, `compact_result`, `compact_error`, `init`,
  `result` (`is_error`, `result` text, `local_command`) and `C`'s lifecycle frames. This shows what an app compact
  prints when Claude refuses it.
- **D — saved transcript lines.** After probes A, B and C end, read each session's transcript:
  `~/.claude-personal/projects/<project folder name>/<session id>.jsonl`. The folder name is the project path with
  every character outside `[A-Za-z0-9]` changed to `-` (`transcripts.ts`, `projectFolderName`). Read these files
  with `command grep -a` or `python3`, not with the Bash tool's `grep` (`~/wigley-agents/ClaudeCode.md` § Bash tool).
  Record, for A and C:
  - the `compact_boundary` line: its `type`, `subtype`, the metadata key name (`compactMetadata` or
    `compact_metadata`), every metadata field name and value (`trigger` verbatim), and `uuid`, `timestamp`,
    `logicalParentUuid` and `isSidechain`
  - the summary `user` line: `isCompactSummary`, `isVisibleInTranscriptOnly`, `isMeta`, the start of its content
  - any `system` line with `subtype: "local_command"` that the compaction wrote (its `content`), and the typed
    `/compact` `user` line (its `<command-name>` content)
  - for B: whether the transcript holds a boundary, and what marks the interrupted compaction

## Shell rules for the probe run

- The shell is zsh. Quote every glob. Quote an argument that starts with `=`.
- Use absolute paths in every Bash call.
- Write scratch files only under `/tmp/claude-autocompact/`.
- Wait on a probe by polling its log file or with `Monitor`. Do not use `sleep` in the foreground.
- Do not install, update or download anything.

## What task 02 does when a fact differs from the design's assumption

Write each "if" below that the probes confirm as one line in the new subsections. Task 02 reads this table.

| Fact the probe measures | Design assumption | Task 02 when the fact differs |
|---|---|---|
| A: the boundary `trigger` value | `auto` | Live: no change. The adapter takes the trigger from what started the compaction, not from the metadata. History: map `manual` to `manual` and every other value to `harness`. |
| A: `status: compacting` comes before the boundary | it comes | If no `compacting` status comes, the boundary emits `compactionStarted` and then `compactionEnded` at once (row "boundary with no start" in task 02). |
| A: `compacting` statuses repeat | they may repeat (`compact_output_chars`) | No change: only the first status starts a compaction. |
| A, B, C: `compacting` carries `user_message_uuid` | unknown | If it carries the uuid, task 02 matches the trigger by that uuid first. If it does not, task 02 matches by the `started` lifecycle frame. |
| B: a plain interrupt stops `/compact` | unknown | If it stops `/compact`, the compaction ends `interrupted` at the first end line (failed `compact_result`, the command's `result` or its terminal lifecycle frame). If it does not stop `/compact`, the compaction ends `interrupted` when the interrupt grace (5 s) ends, and the boundary that comes later emits the entry and no second `compactionEnded`. Task 02 implements both paths. B tells which one runs. |
| B: the time to the end line | under 5 s | If it is above 5 s, the grace ends the compaction first. No change. |
| C: a message written during `/compact` waits and then runs as its own turn | it waits | If it is folded, no change. If it is cancelled or dropped, the existing `messageDropped` path reports it, and task 05 must return the held row. Report this to the lead as a plan change. |
| E: `/compact` with nothing to compact prints no `compacting` status | unknown | Task 02 emits `compactionStarted` and `compactionEnded` `failed` when the compact command's turn ends with no compaction line, so a held send is released. |
| D: the saved boundary's metadata key and field names | `compactMetadata` with `trigger`, `preTokens`, `durationMs` | Task 02 reads the names D records. |
| D: the compaction writes a `local_command` line `Compacted` | unknown | If it writes one, task 02's history reads it as nothing after a boundary. |

## GIVEN / WHEN / THEN

- GIVEN a probe process with a 100k autocompact window and a 5 % override WHEN turn 2 runs THEN the doc records the
  line order of the automatic compaction, the `trigger` value, and the `compacting` lines' fields.
- GIVEN a running `/compact` WHEN the driver writes a plain interrupt THEN the doc records each line that follows,
  with times, for 30 s.
- GIVEN a running `/compact` WHEN the driver writes a user message THEN the doc records that message's lifecycle and
  whether it runs.
- GIVEN a fresh process WHEN `/compact` is its first message THEN the doc records every line it prints.
- GIVEN the probe sessions' transcripts WHEN they are read THEN the doc records the boundary line, the summary line
  and any `local_command` line, with field names verbatim.

## Tests

None. This task changes only a doc. The facts come from the live probe.

## Done when

- claude-stream.md § Compaction has the five subsections. Each one records its probe's version (`2.1.317`), its
  date, its stdin, and an excerpt with seconds since spawn.
- The version lines at the top of claude-stream.md name § Compaction's 2.1.317 probes with their date.
- The last line of § Compaction ("Not measured: …") names only what is still not measured.
- Each row of the table above that a probe answered has a one-line fact in the doc.
- `git diff --stat` shows only `docs/features/agent-chat/claude-stream.md`.

## Commit

One commit: `docs/features/agent-chat/claude-stream.md` alone, by pathspec. Example message:
`Record Claude 2.1.317 compaction lines: autocompact, interrupt and a message during /compact, saved transcript`.

## Addendum (round 3): Claude's idle compaction

The 2.1.317 binary holds an `idleCompaction` setting (default on): while a session idles on the 1-hour cache, Claude
compacts before the cache expires (`Compacted while idle, before the prompt cache expired`), above
`max(100000, CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS ?? 200000)` tokens. Its outcome names include `no_host`,
`not_one_hour`, `lapsed` and `small`. Nothing about it is measured.

Probe F, run in the background (it can take up to 65 minutes of wall time):
- Start `claude` in stream-json mode as the other probes do, with `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=100000` and
  the 1-hour cache TTL (find the lever: the binary names `CLAUDE_CODE_PROMPT_CACHE_TTL`; record the value it takes).
- Turn 1 reads a file of about 110k tokens, so the context is above the floor. Then send nothing.
- Wait until a compaction prints or the 1-hour cache would have expired (65 minutes), then end the process.
- Record in claude-stream.md § Compaction: whether idle compaction fires under stream-json; when it fires, its lines,
  `trigger`, whether a `turnStarted`-like `init` and a `result` frame it, and the time from the last turn's end.
- Task 02 reads it as trigger `harness` in every case. When it never fires, record that: the app's gate then covers
  every cold send alone.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
