import { open } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { byteRangeOf } from './byte-range';

// The types the local media route serves, by lowercase extension.
const MEDIA_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const OTHER_TYPE = 'application/octet-stream';

// The local media file `file`, typed by its extension: the bytes a `Range`
// header asks for with 206 (`byteRangeOf`), 416 when it asks for none the file
// holds, else the whole file. The file is opened before any answer, so one
// that is missing, a folder or unreadable answers 404, never a broken body.
export async function serveLocalMedia(
  file: string,
  range: string | null,
): Promise<Response> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return new Response(null, { status: 404 });
  }
  let size: number;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return new Response(null, { status: 404 });
    }
    size = stats.size;
  } catch {
    await handle.close();
    return new Response(null, { status: 404 });
  }
  const headers = {
    'Content-Type': MEDIA_TYPES[path.extname(file).toLowerCase()] ?? OTHER_TYPE,
    'Accept-Ranges': 'bytes',
  };
  const bytes = byteRangeOf(range, size);
  if (bytes === 'unsatisfiable') {
    await handle.close();
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }
  if (size === 0) {
    await handle.close();
    return new Response(null, {
      headers: { ...headers, 'Content-Length': '0' },
    });
  }
  const span = bytes ?? { start: 0, end: size - 1 };
  // The stream closes the handle once it ends or fails.
  const body = Readable.toWeb(
    handle.createReadStream(span),
  ) as ReadableStream<Uint8Array>;
  const length = String(span.end - span.start + 1);
  if (bytes === null) {
    return new Response(body, {
      headers: { ...headers, 'Content-Length': length },
    });
  }
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${span.start}-${span.end}/${size}`,
      'Content-Length': length,
    },
  });
}
