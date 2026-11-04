# 02 — Stage status and labels

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/contract.ts` · modify `src/plugins/workflow/stages/{idle,primer,feature,plan-ready,make,review,closed}/page.ts` · test `src/plugins/workflow/stages/page-stages.test.ts`
Consumes:  `isBusy(flow)`, `detailLine(...parts)` in `src/plugins/workflow/contract.ts` (in the tree)
Produces:  `export type StageStatus = 'running' | 'paused' | 'ready' | 'done'` in `src/plugins/workflow/contract.ts`
           `export function busyStatus(flow: SessionFlow): StageStatus` in `src/plugins/workflow/contract.ts`
           `export function statusText(label: string, status: StageStatus | null): string` in `src/plugins/workflow/contract.ts`
           `PageStage.status(flow: SessionFlow): StageStatus | null`
           `PageStage.statusLine(flow: SessionFlow): string`
           `PageStage.runsTasks?: boolean`
Decisions:
- `statusText` returns `<label> · <status>`, and the label alone for a null status.
- `busyStatus` returns `running` while `isBusy(flow)`, else `paused`.
- `runsTasks` is true on make only. It means the current wave's open tasks draw the stage's status. A left-out value means they draw `pending`.
- Pinned stage values:

  | Stage | `label` | `stepSlot` | `status` | `statusLine` |
  |---|---|---|---|---|
  | idle | `Idle` | none | `null` | `Idle` |
  | primer | `Primer` | `start` | `busyStatus` | `Primer · running` |
  | feature | `Feature` | `start` | `busyStatus` | `Feature · paused` |
  | planReady | `Make` | `make` | `ready` | `Make · ready` |
  | make | `Make` | `make` | `busyStatus` | `Make · running 3/9` |
  | review | `Review` | none | `busyStatus` | `Review · running · round 2` |
  | closed | `Close` | none | `done` | `Close · done · 9/9` |

- Make's status line has a space before the count. It drops the count while `progress` is null.
- Review drops ` · round <n>` while `progress` is null or `reviewRounds` is 0.
- Closed drops ` · <checked>/<total>` while `progress` is null.
- `detail` stays as it is on every stage.
- Rewrite the `label` and `detail` comments on `PageStage`: the label is now the step's word (`Make`), and `detail` no longer draws on the chip.
GIVEN each row below WHEN `status` and `statusLine` run THEN each returns the pinned value
Tests:     in `page-stages.test.ts`, one table test `each stage's status and status line follow its flow`. Rows, each with a flow built in the test:
           primer busy → `running`, `Primer · running` · feature not busy → `paused`, `Feature · paused` · planReady busy → `ready`, `Make · ready` · make busy 3/9 → `running`, `Make · running 3/9` · make not busy 3/9 → `paused`, `Make · paused 3/9` · make with null progress → `paused`, `Make · paused` · review busy with 2 rounds → `running`, `Review · running · round 2` · review not busy with 0 rounds → `paused`, `Review · paused` · closed 9/9 → `done`, `Close · done · 9/9` · closed with null progress → `done`, `Close · done` · idle → `null`, `Idle`
           Add a second table `busy means a turn or a main-agent subagent`: rows with `turnRunning` only and `runningSubagents` only → `running`; neither → `paused`, through `busyStatus`.
Done when: `npm run typecheck` reports errors only for callers task 03 changes, or none; the test gate runs the tests above
Commit:    one commit for the group

## Proof

