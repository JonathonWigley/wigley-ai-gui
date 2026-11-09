# 05 — Final verification

Status: in progress
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     none; a fix found here is made in its own repo's worktree and committed there
Consumes:  every earlier task
Produces:  the checks below, passed

Checks, each run in its worktree:

- wigley-agents: `cd tools/workflow-gate && python3 -m unittest discover -s tests`.
- wigley-ai-marketplace: every command in its `AGENTS.md` § Done.
- wigley-ai-gui: `npm test`, `npm run typecheck`, `npm run lint`, then the filtered self-test
  `npm run selftest -- --plugin workflow-spike,workflow-small,workflow-medium` (Small and Medium
  run too, since the shared registries changed). Expected to pass.
- wigley-ai-gui drive run (`drive` skill): start a fake-harness session that loads
  `wigley:spike`, then report `build`, `check`, `build`. The row chip shows `X` in the
  `fg-secondary` tone with the stage word, and the composer trail reads
  `Interview › Build › Check › Land` with Build running after the second `build`. Expected:
  `stepState` in `src/plugins/workflow/page/workflow-view.ts` marks steps before the current one
  done and steps after it pending, so Interview reads done, Build running, Check and Land pending.
  Low confidence only on how Check draws when it goes from done back to pending, since no shipped
  level does that — capture the strip and read it.

Done when: every check passes, and the drive captures were read against `DESIGN.md` § Workflow.
Commit:    a fix commits in its own repo; a passing run commits nothing

## Proof
