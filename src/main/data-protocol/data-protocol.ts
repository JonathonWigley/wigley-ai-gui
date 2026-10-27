import { net, protocol } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Paths } from '../../contracts/paths';
import { DATA_SCHEME, dataFilePath } from '../../shared/data-url';
import { LAYOUT_SCHEME, layoutFilePath } from '../../shared/layout-url';

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

// Registers `wigley-data:` and `wigley-layout:`. Electron takes scheme
// privileges once, before the app is ready, so both go in this one call.
export function registerFileSchemes(): void {
  protocol.registerSchemesAsPrivileged(
    [DATA_SCHEME, LAYOUT_SCHEME].map((scheme) => ({
      scheme,
      privileges: FILE_SCHEME_PRIVILEGES,
    })),
  );
}

// Serves each plugin's data folder under `dataRoot`, joined by `paths`, on
// the default session, open to any origin, so the page imports modules from it
// in dev and packaged alike. A URL outside a plugin's folder, or naming
// anything but a file, answers 404.
export function serveDataScheme(dataRoot: string, paths: Paths): void {
  serveFiles(DATA_SCHEME, (url) => dataFilePath(url, dataRoot, paths));
}

// Serves each owner's layouts under `layoutsRoot` as `serveDataScheme` serves
// plugin data: a URL outside a layout's folder, or naming anything but a
// file, answers 404.
export function serveLayoutScheme(layoutsRoot: string, paths: Paths): void {
  serveFiles(LAYOUT_SCHEME, (url) => layoutFilePath(url, layoutsRoot, paths));
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
