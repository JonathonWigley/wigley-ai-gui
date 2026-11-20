import { net, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { LayoutOwner } from '../../contracts/layouts';
import type { Paths } from '../../contracts/paths';
import { DATA_SCHEME, dataFilePath } from '../../shared/data-url';
import { LAYOUT_SCHEME, layoutFilePath } from '../../shared/layout-url';
import { PLUGIN_SCHEME, pluginFilePath } from '../../shared/plugin-url';
import { localMediaPathOf, VISUAL_SCHEME } from '../../shared/visual-url';
import { byteRangeOf } from './byte-range';
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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const OTHER_CONTENT_TYPE = 'text/plain; charset=utf-8';

// The privileges the file schemes take: a standard, secure origin the page
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

// Registers `wigley-data:`, `wigley-layout:`, `wigley-plugin:` and
// `wigley-visual:`. Electron takes scheme privileges once, before the app is
// ready, so all four go in this one call.
export function registerAppSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    ...[DATA_SCHEME, LAYOUT_SCHEME, PLUGIN_SCHEME].map((scheme) => ({
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

// Serves each user plugin's per-revision copies under `codeRoot`, as
// `serveDataScheme` serves plugin data: a URL naming no file, a folder, a
// missing revision, or a path outside the plugin's copy answers 404. A
// relative import inside `page.js` resolves under the same `~<revision>`, so
// it loads from that revision's copy.
export function servePluginScheme(codeRoot: string, paths: Paths): void {
  serveFiles(PLUGIN_SCHEME, (url) => pluginFilePath(url, codeRoot, paths));
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
// and resolves its URL. A local media URL (`localMediaPathOf`) answers with
// that image or video file, read from disk on each request, to a visual's
// frame and to markdown in the page alike; with no CORS header, so a frame's
// canvas cannot read its pixels. A `Range` request, which a video sends to
// load and seek, answers 206 with those bytes (`byteRangeOf`). A URL it does
// not hold, or a file it cannot read, answers 404.
export function serveVisualScheme(): (source: string) => string {
  const documents = createVisualDocuments();
  protocol.handle(VISUAL_SCHEME, async (request) => {
    const media = localMediaPathOf(request.url);
    if (media === null) {
      return documents.response(request.url);
    }
    // A drive-shaped path is relative off Windows: refuse it there.
    const file = path.normalize(media);
    if (!path.isAbsolute(file)) {
      return new Response(null, { status: 404 });
    }
    return serveLocalMedia(file, request.headers.get('Range'));
  });
  return (source) => documents.serve(source);
}

// The local media file `file`, typed by its extension: the bytes `range`
// asks for with 206, 416 when it asks for none the file holds, else the whole
// file. 404 when it is not a readable file.
async function serveLocalMedia(
  file: string,
  range: string | null,
): Promise<Response> {
  const size = await fileSize(file);
  if (size === null) {
    return new Response(null, { status: 404 });
  }
  const headers = {
    'Content-Type':
      CONTENT_TYPES[path.extname(file).toLowerCase()] ?? OTHER_CONTENT_TYPE,
    'Accept-Ranges': 'bytes',
  };
  const bytes = byteRangeOf(range, size);
  if (bytes === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }
  if (bytes !== null) {
    const stream = createReadStream(file, bytes);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${bytes.start}-${bytes.end}/${size}`,
        'Content-Length': String(bytes.end - bytes.start + 1),
      },
    });
  }
  const fetched = await fetchFile(file);
  if (fetched === null || !fetched.ok) {
    return new Response(null, { status: 404 });
  }
  return new Response(fetched.body, {
    headers: { ...headers, 'Content-Length': String(size) },
  });
}

// The size of `file` in bytes; null when it is not a file or cannot be read.
async function fileSize(file: string): Promise<number | null> {
  try {
    const stats = await stat(file);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
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
