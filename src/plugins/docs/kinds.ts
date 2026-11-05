import type { Paths } from '../../contracts/paths';
import {
  applyFollowupEdit,
  followupTitleProblem,
  newFollowupsFile,
} from '../../shared/followups/followup-file';
import type {
  CreateKind,
  CreatePlace,
  DocSource,
  IndexEntry,
} from './contract';
import { isKnownSource } from './index-document';
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
  placeFolder(entry: IndexEntry, paths: Paths): string | null;
  targetPath(place: CreatePlace, name: string, paths: Paths): string;
  contents(
    name: string,
    existing: string | null,
    place: CreatePlace,
    paths: Paths,
  ): CreateContents;
}

const SLUG_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// The name of the folder `~/wigley-agents` names, a link or a clone, and the
// base name of that clone; the index walks its top level (`decisions.md` as
// reference, every other file as instructions) and `learning`.
export const WIGLEY_AGENTS_FOLDER = 'wigley-agents';

const KIND_RULES: Record<CreateKind, KindRule> = {
  instructions: {
    placeFolder: instructionsFolder,
    targetPath: (place, name, paths) =>
      place.source === 'global'
        ? paths.join(place.folder, `${name}.md`)
        : paths.join(place.folder, name, 'AGENTS.md'),
    contents: (name) => ({ text: `# ${name}\n\n`, line: 3 }),
  },
  rule: titledFileRule(),
  skill: {
    placeFolder: (entry, paths) => paths.parent(paths.parent(entry.path)),
    targetPath: (place, name, paths) =>
      paths.join(place.folder, name, 'SKILL.md'),
    contents: (name) => ({
      text: `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`,
      line: 3,
    }),
  },
  subagent: {
    placeFolder: (entry, paths) => paths.parent(entry.path),
    targetPath: fileInFolder,
    contents: (name) => ({
      text: `---\nname: ${name}\ndescription: \n---\n\n`,
      line: 3,
    }),
  },
  command: {
    placeFolder: (entry, paths) => paths.parent(entry.path),
    targetPath: fileInFolder,
    contents: () => ({ text: '---\ndescription: \n---\n\n', line: 2 }),
  },
  learning: titledFileRule(),
  reference: { ...titledFileRule(), placeFolder: referenceFolder },
  'feature-doc': titledFileRule(),
  followup: {
    placeFolder: (entry, paths) =>
      paths.base(entry.path) === 'followups.md'
        ? paths.parent(entry.path)
        : null,
    targetPath: (place, _name, paths) =>
      paths.join(place.folder, 'followups.md'),
    contents: createdFollowup,
  },
};

// The places a doc of `kind` may be created: the folders the index finds
// that kind in, outside plugins, third-party docs and sources the app does
// not know; global places first, then by title.
export function placesFor(
  kind: CreateKind,
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
): CreatePlace[] {
  const places = new Map<string, CreatePlace>();
  for (const entry of entries) {
    const { source } = entry;
    const isPlaceSource = isKnownSource(source) && source !== 'plugin';
    const isThirdParty = entry.owner === 'third-party';
    if (entry.kind !== kind || !isPlaceSource || isThirdParty) {
      continue;
    }
    const folder = KIND_RULES[kind].placeFolder(entry, paths);
    if (folder === null || places.has(folder)) {
      continue;
    }
    const title = placeTitle(entry, source, paths.tilde(folder, homeDir));
    places.set(folder, { title, folder, source });
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
    return followupTitleProblem(trimmed);
  }
  const holdsSeparator = trimmed.includes('/') || trimmed.includes('\\');
  if (holdsSeparator || trimmed.startsWith('.')) {
    return 'A name holds no / or \\ and does not start with .';
  }
  return null;
}

// The file a new doc of `kind` named `name` is written to in `place`.
export function createTarget(
  kind: CreateKind,
  place: CreatePlace,
  name: string,
  paths: Paths,
): CreateTarget {
  const rule = KIND_RULES[kind];
  const trimmed = name.trim();
  return {
    path: rule.targetPath(place, trimmed, paths),
    appends: kind === 'followup',
    contents: (existing) => rule.contents(trimmed, existing, place, paths),
  };
}

// The skill folder `path` heads: its folder when it is a `SKILL.md` in a
// folder under `skills`; else null.
export function skillFolder(path: string, paths: Paths): string | null {
  const folder = paths.parent(path);
  const headsSkill =
    paths.base(path) === 'SKILL.md' &&
    paths.base(paths.parent(folder)) === 'skills';
  return headsSkill ? folder : null;
}

function titledFileRule(): KindRule {
  return {
    placeFolder: (entry, paths) => paths.parent(entry.path),
    targetPath: fileInFolder,
    contents: (name) => ({ text: `# ${name}\n\n`, line: 3 }),
  };
}

function fileInFolder(place: CreatePlace, name: string, paths: Paths): string {
  return paths.join(place.folder, `${name}.md`);
}

// An instruction file's folder, a trailing `.claude` dropped for a repo's
// own. A global one gives a place only in the wigley-agents folder, whatever
// path it resolves to, since the index reads no other global folder's new
// files.
function instructionsFolder(entry: IndexEntry, paths: Paths): string | null {
  const folder = paths.parent(entry.path);
  const folderName = paths.base(folder);
  if (entry.source === 'global') {
    return folderName === WIGLEY_AGENTS_FOLDER ? folder : null;
  }
  return folderName === '.claude' ? paths.parent(folder) : folder;
}

// A reference doc's folder. A global one in the wigley-agents folder gives no
// place, since a new file at its top level indexes as instructions.
function referenceFolder(entry: IndexEntry, paths: Paths): string | null {
  const folder = paths.parent(entry.path);
  const isWigleyAgentsGlobal =
    entry.source === 'global' && paths.base(folder) === WIGLEY_AGENTS_FOLDER;
  return isWigleyAgentsGlobal ? null : folder;
}

function placeTitle(
  entry: IndexEntry,
  source: DocSource,
  tildeFolder: string,
): string {
  const owners: Record<DocSource, string> = {
    global: 'Global',
    repo: `${entry.repo}`,
    features: `${entry.repo} features`,
    plugin: `${entry.plugin}`,
  };
  return `${owners[source]} · ${tildeFolder}`;
}

// `existing` with a follow-up titled `name` created in the file's own shape,
// its list item or Contents line written as `- **<name>** — ` and the editor
// on that line. No file, or a blank one, starts as a new follow-ups file
// named after the place's repo.
function createdFollowup(
  name: string,
  existing: string | null,
  place: CreatePlace,
  paths: Paths,
): CreateContents {
  const isMissing = existing === null || existing.trim() === '';
  const text = isMissing
    ? newFollowupsFile(followupsRepoName(place.folder, paths))
    : existing;
  const result = applyFollowupEdit(text, {
    type: 'create',
    draft: { title: name, oneLine: '', tags: [], body: '' },
    openOneLine: true,
  });
  if (result.type !== 'applied') {
    throw new Error(`A follow-up titled ${name} already exists`);
  }
  return { text: result.text, line: result.line };
}

// The repo a features home belongs to: the clone's folder for an in-repo
// `<clone>/docs/features`, else the home's own folder, as in
// `~/wigley-features/<repo>`.
function followupsRepoName(folder: string, paths: Paths): string {
  const docs = paths.parent(folder);
  const isInRepoHome =
    paths.base(folder) === 'features' && paths.base(docs) === 'docs';
  return paths.base(isInRepoHome ? paths.parent(docs) : folder);
}
