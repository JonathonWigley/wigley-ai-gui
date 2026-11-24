// The two shapes of a features-home template, as Backlog reads them: an
// in-repo template `{repo}/<relative folder>` and an out-of-repo template
// `<~ or absolute folder>/{name}`. The docs index's `contributions.py` reads
// the same two shapes by the same rules.

const IN_REPO_PREFIX = '{repo}/';
const OUT_OF_REPO_SUFFIX = '/{name}';
const PLACEHOLDER = /\{[^}]*\}/;

// Null for a template of either shape, else the line that refuses it.
export function templateProblem(template: string): string | null {
  return inRepoParts(template) !== null || outOfRepoFolder(template) !== null
    ? null
    : `"${template}" is neither {repo}/<folder> nor <folder>/{name}`;
}

// Each in-repo template's folder parts below the repo's root, in order:
// `{repo}/docs/features` gives `['docs', 'features']`.
export function inRepoHomeParts(homes: readonly string[]): string[][] {
  return homes.flatMap((template) => {
    const parts = inRepoParts(template);
    return parts === null ? [] : [parts];
  });
}

function inRepoParts(template: string): string[] | null {
  if (!template.startsWith(IN_REPO_PREFIX)) {
    return null;
  }
  const folder = template.slice(IN_REPO_PREFIX.length);
  const parts = folder.split('/').filter((part) => part !== '' && part !== '.');
  const isRelative =
    !folder.startsWith('/') && parts.length > 0 && !parts.includes('..');
  return isRelative && !PLACEHOLDER.test(folder) ? parts : null;
}

function outOfRepoFolder(template: string): string | null {
  if (!template.endsWith(OUT_OF_REPO_SUFFIX)) {
    return null;
  }
  const folder = template.slice(0, -OUT_OF_REPO_SUFFIX.length);
  const isRooted = folder.startsWith('~/') || folder.startsWith('/');
  return isRooted && !PLACEHOLDER.test(folder) ? folder : null;
}
