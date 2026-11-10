# 09 — Offline answers per contributor

Status: not started
Type: Batch
Wave: 2 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/main/tool-definitions.ts` · modify `src/plugins/forms/main/start.ts` ·
           modify `src/plugins/chat/main/permission-tool.ts` · modify `src/plugins/chat/main/set-headless-tool.ts` ·
           modify `src/plugins/chat/main/start.ts` · modify `src/plugins/workflow/contract.ts` ·
           modify `src/plugins/workflow/main/start.ts` · modify `src/plugins/workflow-large/main/start.ts` ·
           modify `src/plugins/sessions/main/title-tool.ts` · modify `src/plugins/sessions/main/start.ts` ·
           modify `src/plugins/agent-form-fakes.test-support.ts` ·
           test `src/plugins/forms/main/start.test.ts` · test `src/plugins/chat/main/start.test.ts` ·
           test `src/plugins/workflow/main/start.test.ts` · test `src/plugins/workflow-large-main.test.ts` ·
           test `src/plugins/sessions/main/start.test.ts`

Consumes:  `OfflineAnswer` and `ContributeToolsOptions.offline` in `src/plugins/sessions/contract.ts` ← 05
           `textResult(text)` in `src/plugins/sessions/contract.ts` (tree)
           `HEADLESS_NOTE` in `src/plugins/chat/contract.ts` (tree)
           `permissionReplyText(answer, input)` and `PERMISSION_TOOL_NAME` in `src/plugins/chat/main/permission-tool.ts`
           (tree)
           `SET_WORKFLOW_STEP_TOOL`, `SET_WORKFLOW_CHECKLIST_TOOL`, `SET_WORKFLOW_PLAN_TOOL`, `SET_SESSION_TITLE_TOOL`
           (tree)

Produces:  `export const ASK_ROUND_OFFLINE: OfflineAnswer` in `src/plugins/forms/main/tool-definitions.ts`
           `export const PERMISSION_OFFLINE: OfflineAnswer` in `src/plugins/chat/main/permission-tool.ts`
           `export const SET_HEADLESS_OFFLINE: OfflineAnswer` in `src/plugins/chat/main/set-headless-tool.ts`
           `export const WORKFLOW_OFFLINE_ANSWER: OfflineAnswer` in `src/plugins/workflow/contract.ts`
           `export const SET_SESSION_TITLE_OFFLINE: OfflineAnswer` in `src/plugins/sessions/main/title-tool.ts`
           each tool contribution below passes its `offline` record to `contributeTools`

## Decisions

- **The answers, verbatim** (plan.md § Offline answers per tool; pinned):

  | Tool | `result` | `replay` |
  |---|---|---|
  | `ask_round` | `textResult('The app is closed, so no round was shown. Take each item\'s recommended pick and list every pick as a Decided notice in your reply.')` | `false` |
  | `permission_prompt` | `textResult(permissionReplyText({ allowed: false, reason: "The app is closed: this run's permission mode does not allow this tool, so it was denied." }, undefined))`, whose text is `{"behavior":"deny","message":"The app is closed: this run's permission mode does not allow this tool, so it was denied."}` | `false` |
  | `set_headless` | `textResult('The app is closed: the session stays headless.')` | `false` |
  | `set_workflow_step`, `set_workflow_checklist`, `set_workflow_plan` | `textResult(\`Recorded. The app applies it when it opens.\n\n${HEADLESS_NOTE}\`)` | `true` |
  | `set_session_title` | `textResult('Title recorded. The app applies it when it opens.')` | `true` |

- **Left out on purpose** (each answers "did not run" and does not replay, through task 05's default):
  `collect_last_round`, `open_primer`, `collect_last_primer`, `start_session`, `add_practice_problem`,
  `read_practice_state`. So `src/plugins/primer/main/start.ts` and `src/plugins/practice/main/start.ts` stay
  unchanged, and chat's `start_session` contribution passes no `offline`.
- **Each answer sits beside its tool's definition**, so the tool and its closed-app answer change together:
  forms' in `tool-definitions.ts`, chat's two in their tool modules, sessions' in `title-tool.ts`. The workflow
  answer goes in `src/plugins/workflow/contract.ts` because `workflow-large` uses it too, and a plugin reaches
  another plugin only through its contract (workflow-large's manifest depends on `workflow`). The contract already
  imports a value from `../sessions/contract`; it imports `HEADLESS_NOTE` from `../chat/contract` (workflow's
  manifest depends on `chat`).
- **Keys are the tool name constants** where the tree has one (`PERMISSION_TOOL_NAME`, `SET_WORKFLOW_STEP_TOOL`,
  `SET_WORKFLOW_CHECKLIST_TOOL`, `SET_WORKFLOW_PLAN_TOOL`, `SET_SESSION_TITLE_TOOL.name`), else the name read from
  the tool's definition. A key that matches no listed tool throws in `contributeTools` (task 05), so a wrong key
  fails at start.
- **The call sites** (grep `contributeTools(` in each file):
  - `forms/main/start.ts`: the `FORMS_TOOLS` contribution gains `{ offline: { ask_round: ASK_ROUND_OFFLINE } }`.
  - `chat/main/start.ts`: `PERMISSION_TOOLS` gains `{ offline: { [PERMISSION_TOOL_NAME]: PERMISSION_OFFLINE } }`;
    `SET_HEADLESS_TOOL` keeps `mainAgentOnly: true` and gains `offline: { set_headless: SET_HEADLESS_OFFLINE }`.
  - `workflow/main/start.ts`: the checklist contribution and every `contributeStepTool` contribution keep
    `mainAgentOnly: true` and gain their tool's `WORKFLOW_OFFLINE_ANSWER` entry. The step tool is contributed again
    when stages change, so the entry rides on each of those calls.
  - `workflow-large/main/start.ts`: the plan tool keeps `mainAgentOnly: true` and gains its entry.
  - `sessions/main/start.ts`: `set_session_title` keeps `mainAgentOnly: true` and gains its entry.
- **The four scheduling tools** get no entry; task 17 contributes them with none.

GIVEN each contributor above started WHEN its contributions are read THEN each contribution carries the `offline`
entry of its tools in the table, with the table's text and replay flag, and no entry for a tool the table leaves out.
The tests below pin each contributor on its own; the merged `offline.json` of a live app, which holds an entry for
exactly `ask_round`, `permission_prompt`, `set_headless`, `set_workflow_step`, `set_workflow_checklist`,
`set_workflow_plan` and `set_session_title`, is checked in task 21's drive check

GIVEN chat started WHEN its contributions are read THEN `start_session`'s contribution has no `offline` record

## Tests

Each test asserts the pinned text literally, so a changed answer fails a test.

- `src/plugins/chat/main/start.test.ts`:
  - change `setHeadlessTool_CallOnAStartedRow_FlipsItsFlag_AsAMainAgentOnlyContribution`: its options assertion
    becomes `{ mainAgentOnly: true, offline: { set_headless: { result: textResult('The app is closed: the session stays headless.'), replay: false } } }`.
  - add `offlineAnswers_EachChatContribution_AnswersAsPinned` — `it.each` rows by tool name over
    `chat.contributions`: `permission_prompt` → the deny JSON text above, `replay: false`; `start_session` → no
    `offline` option.
- `src/plugins/workflow/main/start.test.ts`:
  - change `Start_ContributesBothTools`: each options value becomes `{ mainAgentOnly: true, offline: { <tool>: WORKFLOW_OFFLINE_ANSWER } }`.
  - change `stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed`: its `[{ mainAgentOnly: true }]` assertion gains
    the same `offline` entry.
  - add `workflowOfflineAnswer_RecordsAndReplays` — `WORKFLOW_OFFLINE_ANSWER` equals
    `{ result: textResult('Recorded. The app applies it when it opens.\n\n' + HEADLESS_NOTE), replay: true }`.
- `src/plugins/workflow-large-main.test.ts`: change `PlanTool_ContributedForTheMainAgentOnly` to assert the plan
  tool's `offline` entry is `WORKFLOW_OFFLINE_ANSWER`.
- `src/plugins/forms/main/start.test.ts`: add `contributes ask_round with its offline answer and leaves collect_last_round out`.
  The sessions fake this test uses records no options now; make its `contributeTools` record `(tools, options)`
  in the shared fake module it comes from (`src/plugins/agent-form-fakes.test-support.ts` holds the forms and primer
  fakes). Assert the `ask_round` entry's text literally and `replay: false`, and no `collect_last_round` key.
- `src/plugins/sessions/main/start.test.ts`: add `writes set_session_title's offline answer to offline.json` — a
  live start in a temp home; read `<home>/.agents/app/offline.json`; its `tools.set_session_title` equals
  `{ result: { content: [{ type: 'text', text: 'Title recorded. The app applies it when it opens.' }] }, replay: true }`.

## Done when

`npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. A closed-app run that gets these
answers from the relay defers to task 21 (Final verification).

## Commit

One commit for the group: "Each tool contributor declares its closed-app answer: rounds take their recommended pick,
permission prompts are denied, step, checklist, plan and title reports are recorded for replay."

## Proof
