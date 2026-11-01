# 02 — Agent event contract and Files.append

Status: not started
Type: Batch
Wave: 1 · Depends on: none (precondition: the usage plan `docs/features/usage/plan-usage/` has landed; its task 03 made `AgentEvent = UsageAgentEvent` and `AgentProcessEvents.agentEvent`)
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/contracts/files.ts` · modify `src/main/files/node-files.ts` · modify `src/shared/memory-files.ts` · modify `src/shared/scoped-files.ts` · test `src/shared/files-contract.test-support.ts` (run by `src/shared/memory-files.test.ts` and `src/main/files/node-files.test.ts`) · test `src/shared/scoped-files.test.ts`
Consumes:  `UsageAgentEvent`, `AgentEvent`, `AgentProcessEvents.agentEvent` in `src/contracts/agent.ts` ← the usage plan's task 03 (in the tree)
           `Files` (in the tree)
Produces:  in `src/contracts/agent.ts`:
           `export const MAIN_AGENT_ID = 'main';`
           `export type AgentEvent = UsageAgentEvent | …` widened with the eight members below
           `export type AgentEventType = AgentEvent['type'];`
           in `src/contracts/files.ts`: `Files.append(path: string, text: string): Promise<void>;`
           `append` in `createNodeFiles` (`node-files.ts`), `createMemoryFiles` (`memory-files.ts`) and `scopedFiles` (`scoped-files.ts`)
Decisions: **the union**: `AgentEvent` becomes `UsageAgentEvent` plus the members of plan.md § File Structure other than its `usage` member, which the usage plan's richer `UsageAgentEvent` replaces: `sessionStarted`, `sessionEnded`, `agentSpawned`, `agentFinished`, `toolStarted`, `toolFinished`, `compacted`, `userMessage`, with fields exactly as plan.md writes them. `UsageAgentEvent` stays as the usage plan wrote it. Before adding them, check `agent.ts`: add `MAIN_AGENT_ID` and `AgentEventType` only if the usage plan did not. The usage plan's File Structure has neither. Keep the usage plan's comment over `AgentEvent`, and add plan.md's line on `at` and `agentId` to it. `agentEvent` in `AgentProcessEvents` is already there; leave it. One union with one callback (plan.md Decisions, interview)
           **every implementer already compiles**: the usage plan gave `chat-sessions.ts` its forwarding and the two harness test fakes their `agentEvent`. A wider union needs no new member anywhere. A `switch` on `event.type` that the compiler now flags as non-exhaustive is fixed in place, so a non-`usage` event is ignored where only `usage` is read (expected in the usage plugin's main part)
           **`append` contract comment** (plan.md File Structure, verbatim first sentence): `// Appends \`text\` to the file, creating it (and its folders, as \`write\` does) when missing.` Then add: not atomic; two appends to one file not awaited in turn may interleave, so a caller orders its own appends (the agents log keeps one promise chain per file, 08). Placed after `writeBytes` (plan.md Design review: `Files` gains `append` instead of rewriting the log per event)
           **Node**: `mkdir(dirname, { recursive: true })`, then `appendFile(file, text, 'utf8')` from `node:fs/promises`. No temp file
           **memory**: through the existing `store` path, so the parent checks, the `modified` stamp and the watch report all match `write`. The new content is the file's current text (`textOf`, UTF-8 decoded when it held bytes) plus `text`, or `text` when the file is missing. Update the header comment's list of methods that report changes (`write`, `writeBytes`, `append`, …) and its `modified` stamp sentence
           **scoped**: `append: async (path, text) => files.append(inside(path), text)`. Add `append` to the comment's list of I/O methods that reject outside the root
           **other `Files` objects**: every test double that builds a `Files` spreads a memory adapter (`archived-sessions.test.ts`, `script-locator.test.ts`, `doc-files.test.ts`, `draft-store.test.ts`, `past-sessions.test.ts`), so they compile unchanged. `selftest-steps.test.ts` casts `{} as Files`. Fix any other site the compiler names the same way
GIVEN a missing file under missing folders WHEN `append` writes `a` and then `b` (awaited in turn) THEN `read` returns `ab`
GIVEN a file holding `x` WHEN `append` writes `y` THEN `read` returns `xy`
GIVEN a scoped adapter WHEN `append` names `../x` THEN it rejects naming `../x` and the inner adapter sees no call
Tests:     `files-contract.test-support.ts`: new `it.each` `append after $before reads $expected`, with rows { before: null (missing file, path `x/y/log.txt`), appends: ['a', 'b'], expected: 'ab' } and { before: 'x', appends: ['y'], expected: 'xy' }. It catches an `append` that overwrites, or one that fails on missing parents. It runs against Node and memory alike, since both suites call `describeFilesContract`
           `scoped-files.test.ts`: a row `{ method: 'append', path: '../a.log', call: (scoped) => scoped.append('../a.log', 'x') }` in the existing `'$method rejects $path before any I/O'` table. It catches an `append` that skips `inside`
           Nothing else. `append` is no row in the missing-file rejection table, since it creates the file. The union is a type: 03, 04 and 07 test what produces and folds it
Done when: `npm test` compiles and passes `files-contract` (through `memory-files.test.ts`, `node-files.test.ts`) and `scoped-files.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof
