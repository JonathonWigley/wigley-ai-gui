# 15 — Scheduling MCP tools

Status: in progress
Type: Task
Wave: 3 · Depends on: 05 (contributes tools through 05's options), 08, 11
Plan: [plan.md](plan.md)

Files:     create `src/plugins/scheduling/main/task-tools.ts` · test `src/plugins/scheduling/main/task-tools.test.ts`
Consumes:  `AgentHarness.capControls(controls, cap)` in `src/contracts/agent.ts` ← 08 (reached as a dep function) ·
           `ScheduledTask`, `ScheduledTaskView`, `TaskDraft`, `TaskSchedule` in `src/plugins/scheduling/contract.ts`
           ← 03 · `readSchedule`, `scheduleText` in `src/plugins/scheduling/schedule.ts` ← 03 ·
           `TaskStore.save`, `TaskStore.remove` in `src/plugins/scheduling/main/task-store.ts` ← 11 (reached as dep
           functions) · `ToolDefinition`, `ToolSession`, `AgentSession`, `ToolResult`, `textResult`, `errorResult` in
           `src/plugins/sessions/contract.ts` (tree) · `FileStat` in `src/contracts/files.ts` (tree) · `ChatProject`
           in `src/plugins/chat/contract.ts` (tree) · the projects reach this task only through its `projects` dep;
           17 fills it from `ChatMainExports.projects()` ← 14, so this task does not wait on 14
Produces:  in `src/plugins/scheduling/main/task-tools.ts`:
           ```ts
           export const TASK_TOOLS: ToolDefinition[]; // schedule_task, list_scheduled_tasks, update_scheduled_task,
                                                      // remove_scheduled_task, in that order
           export interface TaskToolsDeps {
             views(): readonly ScheduledTaskView[];          // built from the stores at call time, list order
             save(draft: TaskDraft): Promise<string>;        // TaskStore.save
             remove(id: string): Promise<void>;              // TaskStore.remove
             isRunRow(sessionId: string): boolean;           // SchedulingState.runRows holds it
             profileOf(sessionId: string): string | null;    // chat.profileOf
             defaultProfile(sessionId: string | null): string | null; // chat.defaultProfile
             profileNames(): string[];
             projects(): readonly ChatProject[];             // chat.projects(), read at each call
             controlIds(): string[];                         // the chat harness's startControls() ids
             sessionControls(sessionId: string): Readonly<Record<string, string>>; // the calling row's picks
             capControls(
               controls: Readonly<Record<string, string>>,
               cap: Readonly<Record<string, string>>,
             ): Record<string, string>;                      // the chat harness's capControls
             isAbsolute(path: string): boolean;
             stat(path: string): Promise<FileStat | null>;
             log(line: string): void;
           }
           export function startTaskTools(deps: TaskToolsDeps): (session: AgentSession) => ToolSession;
           ```

## Decisions

- **Shape.** Follow `src/plugins/chat/main/start-session-tool.ts`: the tool definitions as constants with a
  `description` and a JSON `inputSchema` (`additionalProperties: false`), a deps interface, and a factory that
  returns the `start` that `contributeTools` takes. The main part (17) contributes `TASK_TOOLS` and
  `startTaskTools(deps)` with `{ mainAgentOnly: true }` and no `offline` entries, so with the app closed each tool
  answers that it did not run (plan.md § Offline answers per tool). `mainAgentOnly` makes chat's guard answer a
  subagent's call; this module does not check for subagents.
- **The calling session** is `session.id`, the row id. Every call from a row that `isRunRow` names answers
  `errorResult('A scheduled run cannot manage scheduled tasks.')` (pinned), before any argument is read.
- **Tool descriptions** say: what the tool does; that a scheduled task starts a new headless session in its folder at
  each time, also while the app is closed, and spends plan tokens each run; that times are local; the six
  `schedule` shapes with one example each (plan.md `TaskSchedule`); and that `controls` are capped at this session's
  own. Write them in the voice of `START_SESSION_TOOL`'s description.
- **`schedule_task`.** Arguments as plan.md § MCP tools gives. Checks, each a tool error naming the argument:
  - `name` and `prompt` non-blank strings; `schedule` read by `readSchedule` (its reason is the error text).
  - `folder` and `project`: not both. `folder` absolute (`isAbsolute`) and an existing folder: `stat` gives a
    non-null result with `isFolder` true; null or a non-folder is the `folder` error. `project` the name of one of
    `projects()`. With neither, the target is `session.info.projectDir`; when that is null the error is
    `Name folder or project: this session has no folder.`
  - `profile` one of `profileNames()`. Absent: the named project's own `profile` when it has one, else
    `profileOf(session.id) ?? defaultProfile(session.id)`; null there is the error `The app has no profile to run
    the task under.` A given `profile` other than the named project's own is the error `Project <project> runs under
    its own profile <own>.` Reason: chat's `prepareLaunch` refuses another profile than a project's own (14), so the
    task would save and then fail at every run. `start-session-tool.ts` `chooseProfile` holds the same default; this
    module mirrors that rule, since a plugin cannot import chat's main code.
  - `controls` keys each one of `controlIds()`, else the error `Unknown control "<id>". Controls: <ids joined by ", ">.`,
    the text 14's `prepareLaunch` throws. Reason: an unknown id saves and then fails every run.
  - Controls: the task's controls are `capControls(args.controls ?? {}, sessionControls(session.id))`. Reason: plan.md
    (an agent-created task's permission mode is capped at the creating session's). Which control is the permission
    control is the harness's knowledge; this module passes every control through `capControls` and names none.
  - The draft is `{ id: null, name, target, profile, prompt, schedule, controls, paused: false }`; `save` rejects with
    a reason, which the tool answers as a tool error.
  - Success text (pinned): `Scheduled task <id>: <name>, <scheduleText>.`
- **`list_scheduled_tasks`.** No arguments. One line per task in `views()` order:
  `<id>  <name>  <scheduleText>  next <next>  last <last>` with two spaces between parts. `<next>` is `paused` for a
  paused task, else the next run as local `YYYY-MM-DDTHH:MM` when `nextRun` is not null, else `none`. `<last>` is
  the newest history entry's `outcome`, else `none`. No tasks: `No scheduled tasks.` `structuredContent: { tasks:
  [{ id, name, schedule: <scheduleText>, nextRun: <next>, lastOutcome: <outcome or null>, paused }] }`. The local
  time text comes from `Date`'s local methods in this module.
- **`update_scheduled_task`.** `id` must name a task in `views()`, else `No scheduled task <id>.` Every other
  argument, when present, replaces that field, checked as for `schedule_task`; `folder` or `project` replaces the
  whole target; `controls` replaces the controls; `paused` sets the pause. Absent fields keep the task's values. The
  resulting controls (given or kept) are capped at the calling session's through `capControls`, on every update
  except one whose only field is `paused: true`. Reason: design.md's rule is that an agent cannot schedule a run with
  more permission than it has; an agent in `manual` mode that changes the prompt of, or resumes, a user's `auto`
  task would otherwise run its own prompt under `auto`. A pause grants nothing, so it leaves the controls alone. The
  profile rule above applies to the resulting target and profile. No field given: `Name at least one field to
  change.`
  Success text (pinned): `Updated <name>: <scheduleText>, <paused or active>.`
- **`remove_scheduled_task`.** `id` must name a task, else `No scheduled task <id>.` Success: `Removed <name>.`
  (pinned by plan.md).
- **Errors from the store** (a broken task file, a write failure) answer as tool errors with the store's reason, and
  log `<tool> failed: <reason>`.
- **Edits go through the store only.** The tools change the file; the main part hears the store's `onChanged` and
  re-plans (17). This module holds no plan or queue. `views()` reads the stores at call time (17), so a tool call
  right after another sees its write.

GIVEN a call from a run row WHEN any of the four tools runs THEN it answers the pinned refusal and changes nothing
GIVEN a session in `manual` mode WHEN it calls `schedule_task` with `controls: { mode: 'auto' }` THEN the saved task's
controls are what `capControls` returned for that cap
GIVEN a session with no folder WHEN it calls `schedule_task` with neither folder nor project THEN it answers the pinned
folder error
GIVEN a paused task and a task with a next run WHEN `list_scheduled_tasks` runs THEN the lines read `next paused` and
`next <local time>`
GIVEN an unknown id WHEN `update_scheduled_task` or `remove_scheduled_task` runs THEN it answers `No scheduled task <id>.`
GIVEN a project with its own profile WHEN `schedule_task` names it with no profile THEN the draft holds that profile,
and with another profile THEN it answers the pinned project-profile error
GIVEN a session in `manual` mode and a task with `controls: { mode: 'auto' }` WHEN it calls `update_scheduled_task`
with only `prompt` THEN the saved controls are what `capControls` returned for the session's cap

## Tests

`task-tools.test.ts`, over plain fake deps (a `save` that records drafts, a `capControls` fake that returns a marked
copy so a test sees it was called with the session's cap, `views()` from built tasks). Set `process.env.TZ = 'UTC'` in
`beforeAll` and restore it in `afterAll`.

- `call_FromRunRow_RefusesEveryTool` — `it.each` over the four tool names: the pinned text, `isError`, no `save` or
  `remove` call.
- `scheduleTask_Args_SavesTheDraft` — `it.each` of `{ args, session, expected draft }`: default folder and profile
  from the session; `folder` given; `project` given; `project` with its own profile and no `profile` (the draft
  holds the project's profile); `profile` given; `controls` given (the draft holds the capped result, and the fake
  saw the session's controls as the cap); no `controls` (capped from `{}`).
- `scheduleTask_BadArgs_AnswersAToolError` — `it.each` of args and a substring: blank name → `name`; a bad schedule
  → `schedule.`; both folder and project → `folder`; a relative folder → `folder`; a folder `stat` answers null
  for → `folder`; a path `stat` answers `isFolder: false` for → `folder`; an unknown project → `project`; an unknown
  profile → `profile`; a project with its own profile and another `profile` → `own profile`; an unknown control id
  → `Unknown control`; no folder anywhere → the pinned folder error. Each row asserts no `save` call.
- `scheduleTask_StoreRejects_AnswersItsReason`.
- `listScheduledTasks_Views_ListsEachTask` — three views (paused; next run `2026-11-20T14:30Z`; no next run and a
  `failed` last entry) give the three pinned lines and the `structuredContent`; empty views give `No scheduled
  tasks.`
- `updateScheduledTask_Args_ReplacesOnlyGivenFields` — `it.each`: `name` only (kept controls capped); `schedule`
  only; `folder` replaces a `project` target; `controls` capped; `paused: true` only (controls as they were, no
  `capControls` call); `paused: false` (kept controls capped); no field → the pinned error; unknown id → the pinned
  error.
- `updateScheduledTask_BadArgs_AnswersAToolError` — `it.each`, the rows of `scheduleTask_BadArgs_AnswersAToolError`
  that apply to an update (bad schedule, both folder and project, relative or non-folder folder, unknown project or
  profile, project-profile mismatch, unknown control id, blank `name` when given), plus a `save` that rejects → its
  reason. Each row asserts no `save` call, the store row excepted.
- `removeScheduledTask_Id_RemovesOrRefuses` — known id → `Removed <name>.`; unknown → `No scheduled task <id>.`

Done when: compiles; the test gate runs `task-tools.test.ts`.
Commit:    one commit for the group

## Proof
