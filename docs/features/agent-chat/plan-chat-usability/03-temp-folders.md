# 03 — Temp folders as a main service

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/main.ts` · create `src/main/temp-folders.ts` ·
           test `src/main/temp-folders.test.ts` · modify any test or fixture that builds a whole `MainServices`
           (search `MainServices` in `*.test.ts` and `src/shared/`)
Consumes:  none
Produces:  `MainServices.tempFolders: readonly string[]` in `src/contracts/plugin.ts`
           `export function tempFolders(osTemp: string, platform: Platform): string[]` in `src/main/temp-folders.ts`
Decisions: temp folders injected from the composition root (design review: the OS temp folder is ambient, and
           features carry no `process.platform` check)
Done when: compiles; the test gate runs the tests below
Commit:    one commit for the group

## Change

- Contract comment beside the other `MainServices` fields: `tempFolders` are the OS's temporary folders as real
  paths; a folder inside one is scratch space.
- `tempFolders(osTemp, platform)`: on `macos` and `linux`, `osTemp`, `/tmp` and `/private/tmp`, without repeats; on
  `windows`, `osTemp` alone.
- `main.ts` builds it once from the real path of `os.tmpdir()` (`files.realPath`, as `homeDir` is) and the platform
  the served config names, and passes it in the services object for the live and drive modes. The self-test passes
  `tempFolders: []`: its home is a `mkdtemp` under `os.tmpdir()`, and its chat steps open folders in that home
  (task 04).

## Tests

GIVEN macOS and an OS temp of `/private/var/folders/x/T` WHEN `tempFolders` runs THEN it holds that folder, `/tmp` and `/private/tmp`

- `tempFolders_Macos_AddsTmpAndPrivateTmp` — the three folders
- `tempFolders_Windows_OsTempOnly` — `['C:\\Users\\u\\AppData\\Local\\Temp']`

## Proof

Commit 7c28b58 · diff read · typecheck and lint pass · temp-folders.test.ts 2 passed (worker) · concerns: test names in the task doc style rather than the repo prose style
