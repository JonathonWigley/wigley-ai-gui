import type { Paths } from '../../contracts/paths';

export type LinkTarget =
  | { type: 'external'; url: string }
  | { type: 'heading'; fragment: string }
  | { type: 'file'; path: string; line: number | null; fragment: string | null }
  | { type: 'unsupported'; href: string };

// The links the app opens outside itself, in the OS default handler.
export const EXTERNAL_SCHEME = /^https?:/i;
const FILE_URL = /^file:\/\//i;
// A `file:` URL's host that is a drive letter and colon, never a UNC server.
const DRIVE_HOST = /^[A-Za-z]:$/;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `b.md:12` reads as a scheme to ANY_SCHEME; a name holding a `.` or `/`
// with a colon followed only by digits is a file and line (not
// `localhost:3000` or `tel:555`).
const NAME_WITH_LINE = /^[^:]*[./][^:]*:\d+([#?]|$)/;
const LINE_FRAGMENT = /^L(\d+)$/;
const LINE_SUFFIX = /:(\d+)$/;

// Where a link in the doc at `fromFile` leads. An empty href is
// unsupported; `#` alone is the doc's first line. An absolute path is a file
// link, so a Windows drive path never reads as a scheme. A `file:` URL names
// an absolute path, as `fileUrlPath` reads it, or is unsupported; it never
// resolves against `fromFile`.
export function resolveLink(
  href: string,
  fromFile: string,
  homeDir: string,
  paths: Paths,
): LinkTarget {
  if (href === '') {
    return { type: 'unsupported', href };
  }
  if (EXTERNAL_SCHEME.test(href)) {
    return { type: 'external', url: href };
  }
  if (FILE_URL.test(href)) {
    const filePath = fileUrlPath(href, paths);
    return filePath === null
      ? { type: 'unsupported', href }
      : fileTarget(filePath, fromFile, homeDir, paths);
  }
  if (paths.isAbsolute(href)) {
    return fileTarget(href, fromFile, homeDir, paths);
  }
  if (ANY_SCHEME.test(href) && !NAME_WITH_LINE.test(href)) {
    return { type: 'unsupported', href };
  }
  if (href === '#') {
    return { type: 'file', path: fromFile, line: 1, fragment: null };
  }
  if (href.startsWith('#')) {
    const fragment = href.slice(1);
    const lineMatch = LINE_FRAGMENT.exec(fragment);
    return lineMatch === null
      ? { type: 'heading', fragment: decoded(fragment) }
      : {
          type: 'file',
          path: fromFile,
          line: Number(lineMatch[1]),
          fragment: null,
        };
  }
  return fileTarget(href, fromFile, homeDir, paths);
}

// The absolute path a `file:` URL names (RFC 8089), still URI-encoded and
// holding any `#…` or `?…`; null when it names none. `file://host/share/x`
// is the UNC path `\\host\share\x`, which only a Windows `paths` accepts;
// `localhost` reads as no host. With no host, `file:///C:/x` is `C:/x` and
// `file:///x` is `/x`, which names no file on Windows. A drive letter in the
// host's place, as in `file://C:/x`, is the start of the path `C:/x`, which
// names no file on POSIX.
function fileUrlPath(href: string, paths: Paths): string | null {
  const rest = href.replace(FILE_URL, '');
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  const urlPath = slash === -1 ? '' : rest.slice(slash);
  const hostIsDrive = DRIVE_HOST.test(host);
  const hasNoHost = host === '' || host.toLowerCase() === 'localhost';
  let candidates: string[];
  if (hostIsDrive) {
    candidates = [host + urlPath];
  } else if (hasNoHost) {
    candidates = [urlPath.slice(1), urlPath];
  } else {
    candidates = [`\\\\${host}${urlPath}`];
  }
  return candidates.find((path) => paths.isAbsolute(path)) ?? null;
}

// A path link: `#L<n>` or a trailing `:<n>` gives the line, any other `#…`
// the fragment; a `?query` is dropped, and a link that is only a `?query`
// leads to `fromFile` itself. A path that starts with a separator yet is not
// absolute (Windows' `\x`) starts at the root of `fromFile`.
function fileTarget(
  href: string,
  fromFile: string,
  homeDir: string,
  paths: Paths,
): LinkTarget {
  const hash = href.indexOf('#');
  let pathText = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const fragmentText = hash === -1 ? '' : href.slice(hash + 1);
  const lineMatch = LINE_FRAGMENT.exec(fragmentText);
  let line = lineMatch === null ? null : Number(lineMatch[1]);
  const fragment =
    lineMatch === null && fragmentText !== '' ? decoded(fragmentText) : null;
  if (line === null) {
    const suffix = LINE_SUFFIX.exec(pathText);
    if (suffix !== null) {
      line = Number(suffix[1]);
      pathText = pathText.slice(0, suffix.index);
    }
  }
  if (pathText === '') {
    return { type: 'file', path: fromFile, line, fragment };
  }
  const expanded = paths.expandTilde(decoded(pathText), homeDir);
  const startsAtRoot = paths.normalize(expanded).startsWith(paths.separator);
  let path: string;
  if (paths.isAbsolute(expanded)) {
    path = paths.normalize(expanded);
  } else if (startsAtRoot) {
    path = paths.join(rootOf(fromFile, paths), expanded);
  } else {
    path = paths.join(paths.parent(fromFile), expanded);
  }
  return { type: 'file', path, line, fragment };
}

// The root `path` starts at: its farthest parent.
function rootOf(path: string, paths: Paths): string {
  let folder = path;
  while (paths.parent(folder) !== folder) {
    folder = paths.parent(folder);
  }
  return folder;
}

// `text` URI-decoded; a malformed escape keeps the raw text.
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
