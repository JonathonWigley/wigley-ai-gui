import type { Paths } from '../../../contracts/paths';
import { fileStamp } from '../../../shared/file-stamp';
import { extensionOf } from '../../../shared/image-types';

// The characters a link's path loses before `resolveLink` URI-decodes it:
// `#` and `?` start a fragment or query. `%` goes first, so the others'
// escapes stay as written.
const PERCENT_ENCODED: readonly [string, string][] = [
  ['%', '%25'],
  ['#', '%23'],
  ['?', '%3F'],
];
// In a relative destination, also `:`, which reads as a scheme or a line,
// and `\`, which CommonMark reads as an escape before ASCII punctuation.
const RELATIVE_PERCENT_ENCODED: readonly [string, string][] = [
  ...PERCENT_ENCODED,
  [':', '%3A'],
  ['\\', '%5C'],
];
// A CommonMark link destination holding one of these is written in `<…>`.
const NEEDS_BRACKETS = /[ ()<>]/;

// The markdown link the doc at `docPath` takes for the file at `filePath`:
// `![name](dest)` for an image, else `[name](dest)`. `dest` is `filePath`
// relative to the doc's folder, written with `/`; the full path when the two
// share no root (two Windows drives).
export function docLinkOf(
  filePath: string,
  docPath: string,
  mediaType: string,
  paths: Paths,
): string {
  const name = paths.base(filePath).replace(/[\\[\]]/g, '\\$&');
  const relative = relativeDest(filePath, docPath, paths);
  const dest =
    relative === null
      ? linkDestination(filePath, PERCENT_ENCODED)
      : linkDestination(relative, RELATIVE_PERCENT_ENCODED);
  const bang = mediaType.startsWith('image/') ? '!' : '';
  return `${bang}[${name}](${dest})`;
}

// `links` joined by one space, with a space before the first when
// `charBefore` is neither '' nor whitespace.
export function docLinksText(
  links: readonly string[],
  charBefore: string,
): string {
  const lead = charBefore === '' || /\s/.test(charBefore) ? '' : ' ';
  return `${lead}${links.join(' ')}`;
}

// Where a file pasted into the doc at `docPath` at `at` (epoch ms) is saved:
// `<doc folder>/images/<doc name>-<stamp>[-<index + 1>].<ext>`, the suffix
// only for `index` above 0.
export function pastedImagePath(
  docPath: string,
  mediaType: string,
  at: number,
  index: number,
  paths: Paths,
): string {
  const base = paths.base(docPath);
  const dot = base.lastIndexOf('.');
  const docName = dot > 0 ? base.slice(0, dot) : base;
  const suffix = index > 0 ? `-${String(index + 1)}` : '';
  const fileName = `${docName}-${fileStamp(at)}${suffix}.${extensionOf(mediaType)}`;
  return paths.join(paths.parent(docPath), 'images', fileName);
}

// Null when the two share no root.
function relativeDest(
  filePath: string,
  docPath: string,
  paths: Paths,
): string | null {
  const common = paths.commonFolder([docPath, filePath]);
  if (common === null) {
    return null;
  }
  const up = paths.segmentsBelow(paths.parent(docPath), common)!.length;
  const down = paths.segmentsBelow(filePath, common)!;
  return '../'.repeat(up) + down.join('/');
}

function linkDestination(
  dest: string,
  percentEncoded: readonly [string, string][],
): string {
  let encoded = dest;
  for (const [character, escape] of percentEncoded) {
    encoded = encoded.replaceAll(character, escape);
  }
  if (!NEEDS_BRACKETS.test(encoded)) {
    return encoded;
  }
  return `<${encoded.replace(/[<>]/g, '\\$&')}>`;
}
