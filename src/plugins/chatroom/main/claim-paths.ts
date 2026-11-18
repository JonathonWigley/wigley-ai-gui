// Claim paths are repo-relative and `/`-separated, so the clones of one pool
// compare the same file. A pattern holds `*` (any characters inside one
// segment), `?` (one character other than `/`) and `**` (as a whole segment,
// any number of whole segments, zero included; inside a longer segment, `*`).

const GLOBSTAR = '**';
const DRIVE_LETTER = /^[A-Za-z]:/;
const WILDCARD = /[*?]/;

// The path trimmed, `\` turned into `/`, `//` collapsed, each `.` segment and
// one trailing `/` dropped; null when it is empty, `.`, absolute (a leading
// `/` or a drive letter) or holds a `..` segment.
export function normalizeClaimPath(path: string): string | null {
  const slashed = path.trim().replaceAll('\\', '/');
  if (slashed.startsWith('/') || DRIVE_LETTER.test(slashed)) {
    return null;
  }
  const segments = slashed
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return null;
  }
  return segments.join('/');
}

// Whether `path` is one of the paths `pattern` names. No braces, no classes.
export function matchesClaimPattern(pattern: string, path: string): boolean {
  return matchesWithStars(
    pattern.split('/'),
    path.split('/'),
    (segment) => segment === GLOBSTAR,
    segmentMatches,
  );
}

// Whether a path any pattern of `a` names may also be named by a pattern of
// `b`. Two patterns overlap when the text before the first wildcard of one
// starts the other's, so two patterns that share no file can still overlap.
export function claimPathsOverlap(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.some((left) => b.some((right) => patternsOverlap(left, right)));
}

function patternsOverlap(left: string, right: string): boolean {
  const leftIsLiteral = !WILDCARD.test(left);
  const rightIsLiteral = !WILDCARD.test(right);
  if (leftIsLiteral && rightIsLiteral) {
    return left === right;
  }
  if (leftIsLiteral) {
    return matchesClaimPattern(right, left);
  }
  if (rightIsLiteral) {
    return matchesClaimPattern(left, right);
  }
  const leftStem = stemOf(left);
  const rightStem = stemOf(right);
  return leftStem.startsWith(rightStem) || rightStem.startsWith(leftStem);
}

// The text before the first `*` or `?`.
function stemOf(pattern: string): string {
  const wildcardAt = pattern.search(WILDCARD);
  return wildcardAt === -1 ? pattern : pattern.slice(0, wildcardAt);
}

// One segment against one pattern segment: every run of `*` acts as one `*`.
function segmentMatches(pattern: string, segment: string): boolean {
  return matchesWithStars(
    Array.from(pattern),
    Array.from(segment),
    (character) => character === '*',
    (character, actual) => character === '?' || character === actual,
  );
}

// Whether `items` match `pattern`, where an item `isStar` names matches any
// run of items, zero included, and every other pattern item matches one item
// as `matchesOne` says: the greedy match that backs up to the last star.
function matchesWithStars<T>(
  pattern: readonly T[],
  items: readonly T[],
  isStar: (patternItem: T) => boolean,
  matchesOne: (patternItem: T, item: T) => boolean,
): boolean {
  let patternIndex = 0;
  let itemIndex = 0;
  let lastStar = -1;
  let itemAtLastStar = 0;
  while (itemIndex < items.length) {
    const atStar =
      patternIndex < pattern.length && isStar(pattern[patternIndex]);
    const atMatch =
      patternIndex < pattern.length &&
      !atStar &&
      matchesOne(pattern[patternIndex], items[itemIndex]);
    if (atStar) {
      lastStar = patternIndex;
      itemAtLastStar = itemIndex;
      patternIndex += 1;
    } else if (atMatch) {
      patternIndex += 1;
      itemIndex += 1;
    } else if (lastStar !== -1) {
      itemAtLastStar += 1;
      itemIndex = itemAtLastStar;
      patternIndex = lastStar + 1;
    } else {
      return false;
    }
  }
  while (patternIndex < pattern.length && isStar(pattern[patternIndex])) {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}
