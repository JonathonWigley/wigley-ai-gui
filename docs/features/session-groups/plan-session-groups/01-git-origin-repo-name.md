# 01 — Git origin repo name

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/git.ts` · modify `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts` ·
           modify `src/plugins/backlog/main/start.test.ts` · modify `src/plugins/docs/main/plugin-status.test.ts`
Consumes:  `ProcessRunner.run` (tree)
Produces:  `originRepoName(folder: string): Promise<string | null>` on `interface Git` in `src/contracts/git.ts`
Decisions: the project is the origin repo name, `.git` dropped (round 1) · one run, `git -C <folder> remote get-url origin`,
           which works from any folder inside a clone
GIVEN a folder whose origin URL is each row below WHEN `originRepoName` runs THEN it returns the row's name
GIVEN `git remote get-url origin` exits non-zero (no clone, or no origin) WHEN `originRepoName` runs THEN it returns null
Tests:     one table test in `process-git.test.ts`, following that file's fake-processes pattern, rows:
           `git@github-personal:JonathonWigley/wigley-ai-gui.git` → `wigley-ai-gui` ·
           `https://github.com/peoplefun/new-games-prototypes` → `new-games-prototypes` ·
           `https://github.com/peoplefun/Spacebreaker.git` → `Spacebreaker` ·
           `/Users/someone/repos/local-bare.git/` → `local-bare` ·
           `C:\repos\tool.git` → `tool` ·
           exit 2 → null
Approach:  the name is the text after the last `/`, `\` or `:` once trailing `/` and `\` are trimmed, with one trailing `.git`
           dropped; an empty result is null. Like `topLevel`, a non-zero exit is null and a git that cannot start
           rejects — update the contract's header comment, which lists the methods that reject on a failed run.
           Add the member to the two `Git` fakes (`vi.fn<Git['originRepoName']>(async () => null)`).
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 7dfb580e · proof: diff read; Produces originRepoName present on the contract; compile clean for the group's files · concerns: AGENTS.md line 155's adapter list omits the origin repo name (goes to task 07); the empty-name branch and the cannot-start rejection have no test row, per the task's row list
