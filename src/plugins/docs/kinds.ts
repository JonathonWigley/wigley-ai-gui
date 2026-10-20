import type {
  CreateKind,
  CreatePlace,
  DocSource,
  IndexEntry,
} from './contract';
import { baseName, joinPath, parentFolder, tildePath } from './doc-paths';
import { compareTitles } from './tree';

// The order the kind list shows.
export const CREATE_KINDS: readonly CreateKind[] = [
  'instructions',
  'rule',
  'skill',
  'subagent',
  'command',
  'learning',
  'reference',
  'feature-doc',
  'followup',
];

export interface CreateContents {
  text: string;
  // 1-based, where the editor opens.
  line: number;
}

export interface CreateTarget {
  path: string;
  // True only for a follow-up: the file may exist.
  appends: boolean;
  // The file's text after the create, from its text now (null: no file).
  contents(existing: string | null): CreateContents;
}

interface KindRule {
  // The folder a new doc of this kind goes in, from an indexed one; null
  // when this entry gives no place.
  placeFolder(entry: IndexEntry): string | null;
  targetPath(place: CreatePlace, name: string): string;
  contents(name: string, existing: string | null): CreateContents;
}

const SLUG_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KIND_RULES: Record<CreateKind, KindRule> = {
  instructions: {
    placeFolder: instructionsFolder,
    targetPath: (place, name) =>
      place.source === 'global'
        ? joinPath(place.folder, `${name}.md`)
        : joinPath(place.folder, name, 'AGENTS.md'),
    contents: (name) => ({ text: `# ${name}\n\n`, line: 3 }),
  },
  rule: titledFileRule(),
  skill: {
    placeFolder: (entry) => parentFolder(parentFolder(entry.path)),
    targetPath: (place, name) => joinPath(place.folder, name, 'SKILL.md'),
    contents: (name) => ({
      text: `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`,
      line: 3,
    }),
  },
  subagent: {
    placeFolder: (entry) => parentFolder(entry.path),
    targetPath: fileInFolder,
    contents: (name) => ({
      text: `---\nname: ${name}\ndescription: \n---\n\n`,
      line: 3,
    }),
  },
  command: {
    placeFolder: (entry) => parentFolder(entry.path),
    targetPath: fileInFolder,
    contents: () => ({ text: '---\ndescription: \n---\n\n', line: 2 }),
  },
  learning: titledFileRule(),
  reference: titledFileRule(),
  'feature-doc': titledFileRule(),
  followup: {
    placeFolder: (entry) =>
      baseName(entry.path) === 'followups.md' ? parentFolder(entry.path) : null,
    targetPath: (place) => joinPath(place.folder, 'followups.md'),
    contents: appendedFollowup,
  },
};

// The places a doc of `kind` may be created: the folders the index finds
// that kind in, outside plugins; global places first, then by title.
export function placesFor(
  kind: CreateKind,
  entries: readonly IndexEntry[],
  homeDir: string,
): CreatePlace[] {
  const places = new Map<string, CreatePlace>();
  for (const entry of entries) {
    if (entry.kind !== kind || entry.source === 'plugin') {
      continue;
    }
    const folder = KIND_RULES[kind].placeFolder(entry);
    if (folder === null || places.has(folder)) {
      continue;
    }
    const title = placeTitle(entry, tildePath(folder, homeDir));
    places.set(folder, { title, folder, source: entry.source });
  }
  return [...places.values()].sort(
    (a, b) =>
      Number(b.source === 'global') - Number(a.source === 'global') ||
      compareTitles(a.title, b.title),
  );
}

// Why `name` cannot name a new doc of `kind`, or null.
export function nameProblem(kind: CreateKind, name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'A name is required';
  }
  const takesSlug = kind === 'skill' || kind === 'subagent';
  if (takesSlug && !SLUG_NAME.test(trimmed)) {
    return `A ${kind} name is lowercase letters, digits and hyphens`;
  }
  if (kind === 'followup') {
    return /[\r\n]/.test(trimmed) ? 'A follow-up title is one line' : null;
  }
  if (trimmed.includes('/') || trimmed.startsWith('.')) {
    return 'A name holds no / and does not start with .';
  }
  return null;
}

// The file a new doc of `kind` named `name` is written to in `place`.
export function createTarget(
  kind: CreateKind,
  place: CreatePlace,
  name: string,
): CreateTarget {
  const rule = KIND_RULES[kind];
  const trimmed = name.trim();
  return {
    path: rule.targetPath(place, trimmed),
    appends: kind === 'followup',
    contents: (existing) => rule.contents(trimmed, existing),
  };
}

// The skill folder `path` heads: its folder when it is a `SKILL.md` in a
// folder under `skills`; else null.
export function skillFolder(path: string): string | null {
  const folder = parentFolder(path);
  const headsSkill =
    baseName(path) === 'SKILL.md' &&
    baseName(parentFolder(folder)) === 'skills';
  return headsSkill ? folder : null;
}

function titledFileRule(): KindRule {
  return {
    placeFolder: (entry) => parentFolder(entry.path),
    targetPath: fileInFolder,
    contents: (name) => ({ text: `# ${name}\n\n`, line: 3 }),
  };
}

function fileInFolder(place: CreatePlace, name: string): string {
  return joinPath(place.folder, `${name}.md`);
}

// An instruction file's folder, a trailing `.claude` dropped for a repo's
// own; a global one in a Claude or Codex config folder gives no place, since
// a new file there is never loaded.
function instructionsFolder(entry: IndexEntry): string | null {
  const folder = parentFolder(entry.path);
  const folderName = baseName(folder);
  if (entry.source === 'global') {
    const inConfigFolder =
      folderName.startsWith('.claude') || folderName.startsWith('.codex');
    return inConfigFolder ? null : folder;
  }
  return folderName === '.claude' ? parentFolder(folder) : folder;
}

function placeTitle(entry: IndexEntry, tildeFolder: string): string {
  const owners: Record<DocSource, string> = {
    global: 'Global',
    repo: `${entry.repo}`,
    features: `${entry.repo} features`,
    plugin: `${entry.plugin}`,
  };
  return `${owners[entry.source]} · ${tildeFolder}`;
}

// `existing` with `- **<name>** — ` appended as a new last line.
function appendedFollowup(
  name: string,
  existing: string | null,
): CreateContents {
  const item = `- **${name}** — \n`;
  if (existing === null || existing === '') {
    return { text: item, line: 1 };
  }
  const head = existing.endsWith('\n') ? existing : `${existing}\n`;
  return { text: head + item, line: head.split('\n').length };
}
