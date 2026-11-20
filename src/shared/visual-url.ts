import { decodedSegment, parsedSchemeUrl } from './file-url';

// The scheme that serves the page each visual's document, by its source's
// hash, and each local image or video a visual or markdown names, by its
// absolute path.
export const VISUAL_SCHEME = 'wigley-visual';

// A visual URL's path: `/` and a lowercase hex SHA-256.
const HASH_PATH = /^\/([0-9a-f]{64})$/;

// The file types the local media route serves, by lowercase extension.
const IMAGE_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
];
const VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'webm'];

// A Windows drive: a local media path's first segment, or the start of a path.
const DRIVE_SEGMENT = /^[A-Za-z]:$/;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

// A local file the visual host serves: its URL, and whether it draws as an
// image or a video.
export interface LocalMedia {
  url: string;
  kind: 'image' | 'video';
}

// The local media at `path` — an absolute path in URL form, as a markdown
// image's destination holds it (`/Users/me/a.png`, `C:/me/a.mp4`, its
// segments percent-encoded) — served on the visual host, so a visual's own
// `<img src="/Users/me/a.png">` or `<video src="/Users/me/a.mp4">` resolves to
// the same URL. Null when `path` is not absolute or `localMediaPathOf` refuses
// the URL.
export function localMediaOf(path: string): LocalMedia | null {
  const isDrive = DRIVE_PATH.test(path);
  if (!isDrive && !path.startsWith('/')) {
    return null;
  }
  const slashed = path.replaceAll('\\', '/');
  const url = `${VISUAL_SCHEME}://visual${isDrive ? '/' : ''}${slashed}`;
  const file = localMediaPathOf(url);
  if (file === null) {
    return null;
  }
  return {
    url,
    kind: VIDEO_EXTENSIONS.includes(extensionOf(file)) ? 'video' : 'image',
  };
}

// The absolute path a local media URL names, `/`-separated (`C:/me/a.png` for
// a drive), its search and fragment ignored; null for a visual's hash URL, a
// URL off the visual host, an empty segment or one holding an encoded `/` or
// `\`, and a file type outside `IMAGE_EXTENSIONS` and `VIDEO_EXTENSIONS`. The
// URL parser folds `.` and `..` segments before this reads them.
export function localMediaPathOf(url: string): string | null {
  const parsed = parsedSchemeUrl(url, VISUAL_SCHEME);
  if (
    parsed === null ||
    parsed.hostname !== 'visual' ||
    HASH_PATH.test(parsed.pathname)
  ) {
    return null;
  }
  const segments: string[] = [];
  for (const encoded of parsed.pathname.slice(1).split('/')) {
    const segment = decodedSegment(encoded);
    if (segment === null || segment === '' || /[/\\]/.test(segment)) {
      return null;
    }
    segments.push(segment);
  }
  const extension = extensionOf(segments.at(-1) ?? '');
  if (
    !IMAGE_EXTENSIONS.includes(extension) &&
    !VIDEO_EXTENSIONS.includes(extension)
  ) {
    return null;
  }
  const joined = segments.join('/');
  return DRIVE_SEGMENT.test(segments[0]) ? joined : `/${joined}`;
}

// A file name's or path's extension, lowercased; '' with none.
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

// `wigley-visual://visual/<hash>`: the host is always `visual`, and the hash
// sits in the path, since 64 characters pass the 63-character DNS label limit.
export function visualUrl(hash: string): string {
  return `${VISUAL_SCHEME}://visual/${hash}`;
}

// The hash a `visualUrl` names, its search and fragment ignored; null when
// `url` is not a visual URL on the `visual` host with one 64-character
// lowercase hex segment.
export function visualHashOf(url: string): string | null {
  const parsed = parsedSchemeUrl(url, VISUAL_SCHEME);
  if (parsed === null || parsed.hostname !== 'visual') {
    return null;
  }
  return HASH_PATH.exec(parsed.pathname)?.[1] ?? null;
}

// Whether main refuses a frame's navigation: a subframe stays on the
// `wigley-visual:` scheme, since CSP does not cover navigation.
export function refusesFrameNavigation(details: {
  url: string;
  isMainFrame: boolean;
}): boolean {
  return !details.isMainFrame && visualHashOf(details.url) === null;
}
