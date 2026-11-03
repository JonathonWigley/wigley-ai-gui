import { net, protocol } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LayoutOwner } from '../../contracts/layouts';
import type { Paths } from '../../contracts/paths';
import { DATA_SCHEME, dataFilePath } from '../../shared/data-url';
import { LAYOUT_SCHEME, layoutFilePath } from '../../shared/layout-url';
import { VISUAL_SCHEME } from '../../shared/visual-url';
import { createVisualDocuments } from './visual-documents';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const OTHER_CONTENT_TYPE = 'text/plain; charset=utf-8';

// The privileges both file schemes take: a standard, secure origin the page
// may fetch from and import modules from across origins.
const FILE_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
};

// The privileges `wigley-visual:` takes. `standard`: the URL parses with a
// host and a path, and a relative URL (`#anchor`) inside a visual resolves.
// `secure`: the frame is a secure context, so Chromium's mixed-content check
// does not block it inside the page. No `supportFetchAPI` or `corsEnabled`:
// nothing fetches a visual, the page only frames it. No `bypassCSP`: the
// frame's own CSP header must hold.
const VISUAL_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
};

// Registers `wigley-data:`, `wigley-layout:` and `wigley-visual:`. Electron
// takes scheme privileges once, before the app is ready, so all three go in
// this one call.
export function registerAppSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    ...[DATA_SCHEME, LAYOUT_SCHEME].map((scheme) => ({
      scheme,
      privileges: FILE_SCHEME_PRIVILEGES,
    })),
    { scheme: VISUAL_SCHEME, privileges: VISUAL_SCHEME_PRIVILEGES },
  ]);
}

// Serves each plugin's data folder under `dataRoot`, joined by `paths`, on
// the default session, open to any origin, so the page imports modules from it
// in dev and packaged alike. A URL outside a plugin's folder, or naming
// anything but a file, answers 404.
export function serveDataScheme(dataRoot: string, paths: Paths): void {
  serveFiles(DATA_SCHEME, (url) => dataFilePath(url, dataRoot, paths));
}

// Serves each owner's layouts under `layoutsRoot`, and its `default` from the
// folder `defaultFolderOf` names, as `serveDataScheme` serves plugin data: a
// URL outside a layout's folder, a `default` whose owner has no default
// folder, or a URL naming anything but a file, answers 404.
export function serveLayoutScheme(
  layoutsRoot: string,
  paths: Paths,
  defaultFolderOf: (owner: LayoutOwner) => string | null,
): void {
  serveFiles(LAYOUT_SCHEME, (url) =>
    layoutFilePath(url, layoutsRoot, paths, defaultFolderOf),
  );
}

// Serves each visual's document on the default session, kept in memory by
// source hash for the app's life, and returns the call that hands one over
// and resolves its URL. A URL it does not hold answers 404.
export function serveVisualScheme(): (source: string) => string {
  const documents = createVisualDocuments();
  protocol.handle(VISUAL_SCHEME, (request) => documents.response(request.url));
  return (source) => documents.serve(source);
}

// Serves `scheme` on the default session, open to any origin: the file
// `fileOf` names for a request's URL, typed by its extension, or 404 when it
// names none or no readable file.
function serveFiles(
  scheme: string,
  fileOf: (url: string) => string | null,
): void {
  protocol.handle(scheme, async (request) => {
    const file = fileOf(request.url);
    if (file === null) {
      return notFound();
    }
    const fetched = await fetchFile(file);
    if (fetched === null || !fetched.ok) {
      return notFound();
    }
    return new Response(fetched.body, {
      headers: {
        'Content-Type': CONTENT_TYPES[path.extname(file)] ?? OTHER_CONTENT_TYPE,
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

// Null when `file` is not a file, such as a folder, or cannot be read, as
// when it is missing.
async function fetchFile(file: string): Promise<Response | null> {
  try {
    if (!(await stat(file)).isFile()) {
      return null;
    }
    return await net.fetch(pathToFileURL(file).toString());
  } catch {
    return null;
  }
}

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
