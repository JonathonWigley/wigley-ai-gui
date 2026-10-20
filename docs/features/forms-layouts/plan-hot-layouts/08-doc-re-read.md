# 08 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` (only lines that disagree with the landed code)
Consumes:  every task above, landed
Produces:  a commit of fixes, or a Proof line saying every line held
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code)
Commit:    one commit, when anything changed

Re-read these `AGENTS.md` parts, written ahead in `df00396`, line by line against the landed code, and fix each stale
line:

- Contents: the Architecture entry's list.
- The layout tree: `data-protocol/`, and `forms/`'s `layouts/` and main description.
- **An item kind**: the page module handing the layout card input, and the new-kind steps for the Layout contract and
  the `default` layout.
- **Debug and testing keys**.
- **Plugin data**: the folder path, the self-test temp folder, `api.data`, `api.dataUrl(path, revision)`, the CSP, and
  the revision in the path.
- **A forms layout**: the contract path, the kit's part names, `default`'s file and `// @ts-check`, the user folder
  and `layout.css`, `layout.d.ts` written at start, redraw on save, the four keys, and both fallbacks.
- Running and testing: the preview line.

Also check the AGENTS.md `files/` line ("file reads, atomic writes, rename, trash, folder lists and watching"). Rename
and trash land in plan B. If plan B has not landed, leave that line as it stands: it was written ahead for plan B,
whose own re-read checks it.

Done when: every listed part matches the code; the fixes are committed.

## Proof

Commit `a4f3184`. Every listed part held but the Running and testing preview line, which now says a press after the
last saved round wraps back to the sample. The `files/` line was left for plan B.
