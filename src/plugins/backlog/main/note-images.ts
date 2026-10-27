import type { Paths } from '../../../contracts/paths';

// The folder in a features home that holds its follow-ups' images.
export const IMAGES_FOLDER = 'followups-images';

const SLUG_LENGTH = 40;
const IMAGE_LINK =
  /!\[[^\]]*\]\(((?:\.\.\/)*followups-images\/([^/)\s]+)\/(\d+)\.png)\)/g;

// One image a follow-up body links: `relative` is the link's target as
// written, relative to the follow-ups file's folder.
export interface LinkedImage {
  folder: string;
  number: number;
  relative: string;
}

function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replace(/-$/, '');
}

// `<UTC yyyyMMdd-HHmmss>-<title slug>`; the time alone when the slug is empty.
export function imageFolderName(now: number, title: string): string {
  const iso = new Date(now).toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
  const slug = titleSlug(title);
  return slug === '' ? stamp : `${stamp}-${slug}`;
}

// Every `followups-images/<folder>/<n>.png` image link in `body`, in body
// order.
export function linkedImages(body: string): LinkedImage[] {
  return [...body.matchAll(IMAGE_LINK)].map((match) => ({
    folder: match[2],
    number: Number(match[3]),
    relative: match[1],
  }));
}

// `'../'` once per folder between the follow-ups file's folder and the home
// root.
export function imageLinkPrefix(
  followupFile: string,
  homeRoot: string,
  paths: Paths,
): string {
  const below = paths.segmentsBelow(paths.parent(followupFile), homeRoot);
  if (below === null) {
    throw new Error(`${followupFile} is outside ${homeRoot}`);
  }
  return '../'.repeat(below.length);
}

export function imageLink(
  prefix: string,
  folder: string,
  number: number,
): string {
  return `![${number}](${prefix}${IMAGES_FOLDER}/${folder}/${number}.png)`;
}

// `text`, then one blank line and the links one per line when there are any.
export function noteBody(text: string, links: readonly string[]): string {
  return links.length === 0 ? text : `${text}\n\n${links.join('\n')}`;
}

// `addition` after `body` with one blank line between; `addition` alone when
// `body` is blank.
export function appendedBody(body: string, addition: string): string {
  const kept = body.trimEnd();
  return kept === '' ? addition : `${kept}\n\n${addition}`;
}
