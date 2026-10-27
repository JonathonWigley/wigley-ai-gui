# 04 — Docs main exports

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/contract.ts` · modify `src/plugins/docs/main/start.ts` · test
           `src/plugins/docs/main/start.test.ts`
Consumes:  existing: `IndexSourceRegistry.load` / `rebuild` (`src/plugins/docs/main/index-sources.ts`),
           `DocFiles.read` / `write` / `watch` (`src/plugins/docs/main/doc-files.ts`), `MACHINE_SOURCE_ID`
Produces:  `DocsMainExports` in `src/plugins/docs/contract.ts` becomes:
           ```ts
           export interface DocsMainExports {
             addSource(source: IndexSource): Disposable;
             // The machine index source's load, as Docs mode reads it.
             machineIndex(): Promise<SourceRead>;
             // The machine index source's rebuild.
             rebuildMachineIndex(): Promise<SourceRead>;
             readDoc(path: string): Promise<string>;
             // Guarded as the channel's `writeDoc`: the same refusals and changed-on-disk check.
             writeDoc(path: string, text: string, expectedText: string | null): Promise<WriteResult>;
             // Calls `changed` after the file at `path` changes or is replaced, until `dispose`.
             watchDoc(path: string, changed: () => void): Promise<Disposable>;
           }
           ```
           A docs main event `indexLoaded` with payload `{ sourceId: string }`, emitted only by the channel
           handlers `loadIndex` and `rebuildIndex` (Docs' own reads), never by `machineIndex` or
           `rebuildMachineIndex`: Backlog calls those on every reload, and an emit there would loop. Typed in the
           docs contract's main events (follow the shape another plugin uses for its events, e.g. `sessions.ended`).
Decisions: docs owns the index and the write guard; Backlog reaches them only through these exports (design.md §
           Seams) · each export calls the same function the matching channel handler calls today, so the channel
           and the exports share one path · `indexLoaded` lets Backlog reload when the user rescans in Docs mode

GIVEN a dependent plugin calls `writeDoc` on a path the guard refuses WHEN it runs THEN it rejects with the same
refusal text the channel's `writeDoc` gives.
GIVEN Docs mode rebuilds the machine index WHEN the rebuild finishes THEN `indexLoaded` fires with `sourceId` `machine`.

Tests:     in `start.test.ts`: `machineIndex` returns the machine source's load · `writeDoc` refusal matches the
           channel's · `watchDoc`'s `dispose` stops the calls · `indexLoaded` fires after `loadIndex` and
           `rebuildIndex` · `machineIndex` and `rebuildMachineIndex` do not emit it. Use the file's existing fakes.
Done when: `npm test -- src/plugins/docs/main/start` passes; `npm run lint` and `npm run typecheck` pass.
Commit:    one commit for the group

## Proof

Commit 0d13dae · proof: diff read; typecheck clean; docs start tests 24 pass · concerns: none
