# 01 — Agent event members for the workflow

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/plugins/agents/roster.ts` · test `src/plugins/agents/roster.test.ts` ·
           create `src/shared/typed-skill.ts` · test `src/shared/typed-skill.test.ts`
Consumes:  `AgentEvent`, `MAIN_AGENT_ID` in `src/contracts/agent.ts` (in the tree: the usage and subagent-lines plans
           landed)
           `foldAgentEvent` and its `satisfies never` switch in `src/plugins/agents/roster.ts`, and the table
           `foldAgentEvent_Event_FoldsRoster ($case)` in `roster.test.ts` (in the tree)
Produces:  in `src/contracts/agent.ts`, four members at the end of the `AgentEvent` union, word for word as plan.md §
           File Structure writes them:
           `| { type: 'skillStarted'; at: number; agentId: string; skill: string; args: string }`
           `| { type: 'fileWritten'; at: number; agentId: string; path: string }`
           `| { type: 'turnStarted'; at: number }`
           `| { type: 'turnEnded'; at: number }`
           in `src/shared/typed-skill.ts`:
           `export interface TypedSkill { skill: string; args: string }`
           `export function typedSkill(text: string): TypedSkill | null;`
Decisions: **union comments**. Put one comment line above each new member, in the style of the `compacted` comment:
           - `skillStarted`: a skill or slash command started: the agent called its Skill tool, or the user's sent
             message began with `/`. `skill` has no leading `/` (`wigley:make`); `args` is trimmed, `''` when none.
           - `fileWritten`: a write tool (Write, Edit and the others the adapter names) finished without an error.
             `path` is the full path as the tool got it.
           - `turnStarted`: a turn of the main conversation started. Every turn emits it, a turn the harness runs
             with no user message included (Claude: each turn's `system/init`, the turn after a background
             subagent ends included).
           - `turnEnded`: the main conversation's turn ended, done, failed or interrupted.
           Do not change the existing members or the comment above the union.
           **the roster passes them through**. In `foldAgentEvent`, add `case 'skillStarted':`, `case 'fileWritten':`,
           `case 'turnStarted':` and `case 'turnEnded':` to the group of cases that `return running;`. The `satisfies never` check then
           compiles again. No other `switch` on `AgentEvent['type']` exists in `src`: the usage plugin's main part
           tests `event.type === 'usage'`, chat main tests `event.type === 'sessionEnded'`, and the agents log appends
           every event as it is. Check this with `grep -rn "satisfies never" src --include='*.ts'`: it must print only
           `roster.ts`. When it prints another file that switches on an agent event, add the four cases there as
           well, with the same pass-through result, and name the file in the Proof.
           **`typedSkill` is shared** (drafting decision: one rule for two harnesses): the Claude adapter (04) and the fake harness (05)
           both read a sent message's text the same way, so the rule lives once in `src/shared/`. It is pure: no I/O.
           Rules, in order:
           - The text must begin with `/` at index 0. A text with a leading space returns null.
           - `skill` is the run of characters after the `/` up to the first whitespace character (space, tab or
             newline), or to the end.
           - An empty `skill` returns null (the text `/` alone, or `/ x`).
           - `args` is the rest of the text after `skill`, trimmed at both ends; `''` when nothing is left.
           The comment above the function says: "The skill a sent message names when it begins with `/`, as a
           harness reports it in `skillStarted`; null for any other message." A `/effort high` control command still
           returns a value here; the Claude adapter excludes it itself (04).
GIVEN `/wigley:make /p/docs/features/x/plan-y` WHEN `typedSkill` reads it THEN it returns
`{ skill: 'wigley:make', args: '/p/docs/features/x/plan-y' }`
GIVEN a running subagent `a` WHEN a `skillStarted`, `fileWritten`, `turnStarted` or `turnEnded` event folds THEN `foldAgentEvent`
returns the same array
Tests:     `roster.test.ts`: four rows in the existing table `foldAgentEvent_Event_FoldsRoster ($case)`, each with
           `before: [a]` and `same: true`, like the `UserMessage` row:
           - `SkillStarted`: `{ type: 'skillStarted', at: 7000, agentId: a.agentId, skill: 'wigley:make', args: '/p/plan-x' }`
           - `FileWritten`: `{ type: 'fileWritten', at: 7000, agentId: a.agentId, path: '/p/plan-x/plan.md' }`
           - `TurnStarted`: `{ type: 'turnStarted', at: 7000 }`
           - `TurnEnded`: `{ type: 'turnEnded', at: 7000 }`
           They catch a new case that clears or changes the roster (a `turnEnded` taken for a `sessionEnded`).
           No existing expectation changes: the new members reach no existing table row.
           `typed-skill.test.ts`: one table `typedSkill_$case`, each row a `text` and the `expected` value:
           - `skill and path` → `/wigley:make /p/plan-x` → `{ skill: 'wigley:make', args: '/p/plan-x' }`
           - `skill alone` → `/wigley:feature` → `{ skill: 'wigley:feature', args: '' }`
           - `args trimmed` → `/wigley:feature   two words  ` → `{ skill: 'wigley:feature', args: 'two words' }`
           - `newline ends the skill` → `/wigley:retro\nthe run went well` → `{ skill: 'wigley:retro', args: 'the run went well' }`
           - `plain text` → `make the plan` → `null`
           - `slash later in the text` → `see /wigley:make` → `null`
           - `leading space` → ` /wigley:make` → `null`
           - `slash alone` → `/` → `null`
           - `slash then space` → `/ wigley:make` → `null`
           They catch a skill cut at the wrong place, args left untrimmed, and a message taken for a skill when the
           `/` is not first.
Done when: compiles; the test gate runs `roster.test.ts` and `typed-skill.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 441b6eb · proof: diff read: all four AgentEvent members and typedSkill present as Produces; roster fold exhaustive; typecheck clean outside in-flight 06; worker ran roster and typed-skill tests (28 pass) · concerns: plan.md Architecture says three new members, four landed (turnStarted) — for task 11's doc re-read
