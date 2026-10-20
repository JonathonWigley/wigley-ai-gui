# 03 — Plugin data folders and the wigley-data scheme

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/plugins/main-api.ts` · modify `src/renderer/plugins/page-api.ts`
           · modify `src/main/main.ts` · modify `index.html` · create `src/shared/data-url.ts`
           · create `src/main/data-protocol/data-protocol.ts` · test `src/shared/data-url.test.ts`
           · test `src/main/plugins/main-api.test.ts` (extend)
Consumes:  `Files`, `createNodeFiles()`, `scopedFiles(files, root)` ← 01
Produces:  `files: Files` on `MainServices` and `data: Files` on `MainApi` in `src/contracts/plugin.ts`
           `dataUrl(path: string, revision: number): string` on `PageApi` in `src/contracts/plugin.ts`
           in `src/shared/data-url.ts`:
           `export const DATA_SCHEME = 'wigley-data'`
           `export function dataUrl(pluginId: string, revision: number, path: string): string`
           `export function dataFilePath(url: string, dataRoot: string): string | null`
           in `src/main/data-protocol/data-protocol.ts`:
           `export function registerDataScheme(): void`
           `export function serveDataScheme(dataRoot: string): void`
Decisions: a data folder per plugin, reached from main through scoped files and from the page through one core
           scheme (round 3) · `files` is an ambient service, as AGENTS.md's **An ambient service** names it ·
           privileges and headers from the design review
Commit:    one commit for the group

## Pinned values

- Data root: `path.join(app.getPath('userData'), 'plugins')`. In the self-test it is
  `path.join(<self-test home>, 'plugin-data')`, inside the temp folder `homeFolder()` makes, so cleanup removes it.
  `readStartInputs` reads the data root after `homeFolder()`.
- A plugin's folder: `<dataRoot>/<pluginId>`. `createMainApi` gets `dataRoot` in its deps and sets
  `data: scopedFiles(deps.services.files, `${deps.dataRoot}/${manifest.id}`)`, joining with `/` because
  `src/main/plugins` imports no `node:` package (task 01's cold-read rulings).
- URL shape: `wigley-data://<pluginId>/~<revision>/<path>`, with `path`'s segments URI-encoded. Example:
  `dataUrl('forms', 3, 'layouts/a b/layout.js')` → `wigley-data://forms/~3/layouts/a%20b/layout.js`.
- `dataFilePath` returns `<dataRoot>/<pluginId>/<decoded path>` with the `~<revision>` segment dropped, or null when
  the scheme differs, the host is empty, the first segment is not `~` and digits, or the decoded path resolves
  outside `<dataRoot>/<pluginId>` (`..`, `%2e%2e`, an encoded `/`). It parses with the global `URL` and resolves
  with `resolveInside` from `scoped-files.ts`, with no `node:` import, since the page imports this module too.
- Scheme privileges: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`. `registerDataScheme` runs at module
  load in `main.ts`, before `app.whenReady()`, which is what `protocol.registerSchemesAsPrivileged` requires.
- `serveDataScheme` runs inside `whenReady`, on the default session: `protocol.handle(DATA_SCHEME, …)` resolves the
  file with `dataFilePath`, then `net.fetch(pathToFileURL(file))`, and answers with the body, these headers, and a
  404 for null or a missing file:
  - `Content-Type`: `.js` → `text/javascript`, `.css` → `text/css`, `.json` → `application/json`, anything else
    `text/plain; charset=utf-8`.
  - `Access-Control-Allow-Origin: *` — a module import is a CORS fetch from `http://localhost:5173` in dev and from
    `file://` when packaged.
- CSP in `index.html`, exactly:
  `default-src 'self'; script-src 'self' wigley-data:; style-src 'self' 'unsafe-inline' wigley-data:; connect-src 'self' ws://localhost:*`
- `page-api.ts`: `dataUrl: (path, revision) => dataUrl(manifest.id, revision, path)`.
- `main.ts` builds one `createNodeFiles()` and passes it as `services.files`.

GIVEN `wigley-data://forms/~3/layouts/a%20b/layout.js` and data root `/d` WHEN `dataFilePath` runs THEN it returns
`/d/forms/layouts/a b/layout.js`.

Tests:

- `data-url.test.ts`:
  - `dataUrl_EncodesSegmentsAndPutsRevisionInPath`: the pinned example.
  - `dataFilePath_RoundTripsDataUrl`: the GIVEN/WHEN/THEN above.
  - `dataFilePath_ParentEscape_ReturnsNull`: `wigley-data://forms/~1/../sessions/x`.
  - `dataFilePath_EncodedDots_ReturnsNull`: `wigley-data://forms/~1/%2e%2e/x`.
  - `dataFilePath_EncodedSlash_ReturnsNull`: `wigley-data://forms/~1/a%2f..%2f..%2fx`.
  - `dataFilePath_MissingRevision_ReturnsNull`: `wigley-data://forms/layouts/x.js`.
  - `dataFilePath_OtherScheme_ReturnsNull`.
- `main-api.test.ts`: `createMainApi_Data_IsScopedToThePluginFolder`: with memory files and root `/d`, a write
  through plugin `forms`' `data` to `x.txt` lands at `/d/forms/x.txt`, and `../x.txt` rejects.

The scheme adapter itself (Electron's `protocol` and `net`) is checked live in task 09.

Done when: compiles; `npm run lint` passes; the test gate runs the tests above.

## Proof
