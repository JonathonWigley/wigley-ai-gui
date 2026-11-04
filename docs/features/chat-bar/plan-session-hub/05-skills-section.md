# 05 — Skills section

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agents/contract.ts` · modify `src/plugins/agents/roster.ts` · modify `src/plugins/agents/main/start.ts` · modify `src/plugins/agents/main/preview.ts` · modify `src/plugins/agents/page/rosters.ts` · modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` · modify `src/plugins/page.ts` · create `src/plugins/agent-skills/manifest.ts` · create `src/plugins/agent-skills/main/start.ts` · create `src/plugins/agent-skills/main/selftest-script.ts` · create `src/plugins/agent-skills/page/start.ts` · create `src/plugins/agent-skills/page/skill-list.ts` · create `src/plugins/agent-skills/page/layout/read-agent-skills-layout.ts` · create `src/plugins/agent-skills/layouts/layout.d.ts` · create `src/plugins/agent-skills/layouts/default/layout.js` · create `src/plugins/agent-skills/layouts/default/layout.css` · test `src/plugins/agents/roster.test.ts` · test `src/plugins/agents/main/start.test.ts` · test `src/plugins/agent-skills/page/skill-list.test.ts` · test the roster literals in `src/plugins/agent-strip/page/strip-boxes.test.ts`, `src/plugins/agent-strip/page/agent-strip.test.ts`, `src/plugins/agents/page/rosters.test.ts`, `src/plugins/agents/main/preview.test.ts`, `src/plugins/agent-lines/page/working-lines.test.ts` (measured at plan time; `tsc` names any other)
Consumes:  `ChatSidePart`, `ChatSideSection` ← 01
           `AgentsPageExports.roster`, `onRosterChanged`, `foldAgentEvent`, `nameOfOwner`, the `skillStarted` event (in the tree)
Produces:  `RosterSkill` and `Roster.skills` as `plan.md` § File Structure writes them, in `src/plugins/agents/contract.ts`
           in `src/plugins/agent-skills/layouts/layout.d.ts`:
           `export interface SkillRowInput { skill: string; ownerName: string; isMain: boolean }`
           `export interface SkillListInput { skills: readonly SkillRowInput[] }`
           `Layout.skillList?(parent: HTMLElement, input: SkillListInput, kit: BaseKit): AgentSkillsPart`
           `agentSkillsManifest` in `src/plugins/agent-skills/manifest.ts`, `agentSkillsMainPart`, `agentSkillsPagePart`
Decisions:
- `foldAgentEvent` on `skillStarted` appends `{ skill: event.skill, agentId: event.agentId, ownerName: nameOfOwner(roster.agents, event.agentId) }`. When a row with the same `skill` and `agentId` exists it returns the same roster object, so no change is sent. The `args` are dropped.
- `sessionEnded` keeps `skills`. It returns `{ agents: [], tasks: [], skills: roster.skills }`, and returns the same roster when agents and tasks are already empty.
- `compactionStarted`, `compactionEnded` and an agent's end leave `skills` as they are. A row outlives the subagent through `ownerName`, as `RosterTask.ownerName` does.
- `agents/main/start.ts` `rowRoster` merges each host's skills in host order and keeps the first row of each `skill` and `agentId` pair, so a new process with the same skill does not add a second `main` row.
- A `/clear` keeps the list. Its old host's `sessionEnded` keeps that host's skills, and `rowRoster` merges them. The row's end clears them: `dropRoster` at `agents/main/start.ts:98` sends an empty roster, `skills: []` included.
- The host pruning line deletes a host only when `agents`, `tasks` and `skills` are all empty.
- `NONE`, `dropRoster`'s literal, `page/rosters.ts`'s default and `preview.ts`'s `end` literal gain `skills: []`. `preview.ts`'s `copyRoster` copies `skills`. The comments on `Roster`, `AgentsPageExports` and `AgentsChannel` say a session's roster holds three lists, and that the skills stay until the row ends.
- `agents/main/start.ts` already folds replayed events, so a re-attach brings its skills back. Leave that.
- The preview's sample roster gains two rows: `wigley:make` by `main`, and `wigley:review` by `preview-agent-1` with `ownerName` `map-sessions`. So `zla` shows the section. The chat preview's own events hold no `skillStarted`, so `zlc` hides it; leave that.
- Plugin shape: the `agent-lines` plugin's. `dependsOn: ['agents', 'chat', 'sessions', 'keys']`, a `layout` setting with a `settingInfo` description, no commands, no scopes. Main registers the layouts and the self-test. Register it in `manifests.ts`, `main.ts` and `page.ts` next to `agent-strip`. The strip's start order and the context line's place do not change: the hub sorts by `order`.
- The page adds one side part: id `agent-skills.list`, title `Skills`, order 30.
- `skill-list.ts` holds `createSkillList(deps)`. Its `part.build` keeps the `parent` per session and draws the `skillList` part directly into `parent`, with no wrapper of its own, when `onRosterChanged` names the session. `isMain` is `agentId === MAIN_AGENT_ID`, because a subagent may be named `main`. With zero skills it leaves `parent` empty and sets the summary to null, so the section hides through 01's rule. With skills it sets the summary to the count as a string.
- `<name>` is the side-bar label from `sessions.sessionAdded`, as `agent-lines` keeps it. The list logs `skills in <name>: <skill> (<owner>), …` when the text changes, and `skills in <name>: none` when the list empties. It does not log a first draw with zero skills, so a session that never starts a skill logs nothing.
- `sessions.sessionRemoved` drops the session's name and logged text, as `agent-lines` drops its own.
- The default `skillList` draws one row per skill, in roster order: `span.agent-skills-name` in mono with an ellipsis and `title` set to the skill, then `kit.tag` with `ownerName`. The tag's tone is `neutral` with `isMain` and `accent` without it.
- `DESIGN.md`'s Chat bullet holds the look. Lint enforces tokens.
GIVEN `skillStarted` for `foo` by `main` twice WHEN folded THEN the roster holds one row, and the second fold returns the same object
GIVEN `foo` by `main` and `foo` by agent `a1` WHEN folded THEN the roster holds two rows
GIVEN a roster with skills, a task and an agent WHEN `sessionEnded` folds THEN agents and tasks are empty and skills stay
GIVEN a subagent `reviewer` that started `foo` WHEN it ends THEN the row still reads owner `reviewer`
GIVEN two hosts of one row, both with `foo` by `main` WHEN `rowRoster` runs THEN one row shows
GIVEN a host with only skills left WHEN another event folds THEN the host stays
GIVEN a cleared host with `foo` WHEN its `sessionEnded` folds THEN the row still lists `foo`, and `sessions.ended` then sends `skills: []`
GIVEN a session with no skills WHEN the part builds THEN `parent.children.length` is 0 and the summary is null
GIVEN one main skill and one subagent skill WHEN the part draws THEN the tags take `neutral` and `accent`
GIVEN a part built WHEN a roster change adds a second skill THEN it shows two rows and the summary `2`
Tests:     rows in the `roster.test.ts` test that owns each event, asserting the whole `skills` array and object identity for the no-change cases. The existing `SkillStarted` row, which asserts `same: true`, is replaced. The `rowRoster` and pruning cases in `agents/main/start.test.ts`, by its existing seam. `skill-list.test.ts` holds the part's GIVENs and the log text. `agent-skills/main/selftest-script.ts` sends a typed `/selftest-skill` to the fake session and expects `[agent-skills] skills in <project>: selftest-skill (main)`, with `checksFit` true and `scrollsItself: ['.agent-skills-name']`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above; `npm run selftest -- --plugin agent-skills` is in the plan's final verification
Commit:    one commit for the group

## Proof

