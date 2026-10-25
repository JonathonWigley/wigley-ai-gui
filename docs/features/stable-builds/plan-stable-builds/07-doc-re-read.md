# 07 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify as needed `D:/ai-dev/wigley-ai-gui/AGENTS.md` ·
           `D:/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`
Consumes:  every group's landed code
Produces:  docs that match the landed code

Read each doc written ahead line by line against the landed code, and fix every stale line:

- `wigley-ai-gui/AGENTS.md` § Running and testing, the two bullets "The stable app and the dev app" and
  `npm run install-app`: the table's names and paths, the contract path `src/contracts/app-instance.ts`, the
  `WIGLEY_AI_GUI_ENDPOINT_DIR` value, the build folder, the `npm ci` trigger, the install paths, the shortcut name,
  the restart step.
- Also in that `AGENTS.md`: the Contents line for **Running and testing** names the stable build; the lines naming
  `~/.agents/wigley-ai-gui` and "Electron's user data folder" (`ui-state/`, **Plugin data**) still hold with one
  folder per instance.
- `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § The relay, "Starting the app": the fallback, both
  install paths, the failure text.

Done when: every line checked; fixes committed in their own repo (no fix: say so in the Proof)
Commit:    one commit per repo that changed

## Proof

