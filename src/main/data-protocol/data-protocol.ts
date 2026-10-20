import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_SCHEME, dataFilePath } from '../../shared/data-url';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};
const OTHER_CONTENT_TYPE = 'text/plain; charset=utf-8';

// Electron takes scheme privileges only before the app is ready.
export function registerDataScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DATA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

// Serves each plugin's data folder under `dataRoot` on the default session,
// open to any origin, so the page imports modules from it in dev and packaged
// alike. A URL outside a plugin's folder, or a missing file, answers 404.
export function serveDataScheme(dataRoot: string): void {
  protocol.handle(DATA_SCHEME, async (request) => {
    const file = dataFilePath(request.url, dataRoot);
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

// Null when the file cannot be read, as when it is missing.
async function fetchFile(file: string): Promise<Response | null> {
  try {
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
