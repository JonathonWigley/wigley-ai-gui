import { errorText } from '../../shared/error-text';
import type {
  DocKind,
  DocOwner,
  DocSource,
  IndexContext,
  IndexDocument,
  IndexEntry,
  IndexHeading,
  IndexLink,
  InstalledCopy,
} from './contract';
import { isJsonObject, isStringArray } from '../../shared/json';

export const INDEX_SCHEMA_VERSION = 5;

// `model.py`'s KINDS order; the tree groups kinds in this order.
export const DOC_KINDS: readonly DocKind[] = [
  'instructions',
  'reference',
  'learning',
  'rule',
  'skill',
  'skill-file',
  'subagent',
  'command',
  'prompt',
  'hook',
  'plugin',
  'annotation',
  'feature',
  'task',
  'plan',
  'feature-doc',
  'followup',
];

const DOC_OWNERS: readonly DocOwner[] = ['mine', 'third-party'];

const LINK_FORMS: readonly IndexLink['form'][] = ['markdown', 'section'];

const DOC_SOURCES: readonly DocSource[] = [
  'global',
  'repo',
  'plugin',
  'features',
];

export function isKnownKind(kind: string): kind is DocKind {
  return (DOC_KINDS as readonly string[]).includes(kind);
}

export function isKnownSource(source: string): source is DocSource {
  return (DOC_SOURCES as readonly string[]).includes(source);
}

export type ParsedIndex =
  | { ok: true; document: IndexDocument }
  | { ok: false; message: string };

// Reads an index document, checking the fields the app relies on; the first
// problem found is the message.
export function parseIndexDocument(text: string): ParsedIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return failed(`Docs index is not valid JSON: ${errorText(error)}`);
  }
  if (!isJsonObject(raw) || typeof raw.schemaVersion !== 'number') {
    return failed('Docs index has no schemaVersion');
  }
  if (raw.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return failed(
      `Unsupported docs index schema ${raw.schemaVersion}; this app reads ${INDEX_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(raw.entries)) {
    return failed('Docs index has no entries list');
  }
  if (!Array.isArray(raw.contexts)) {
    return failed('Docs index has no contexts list');
  }
  for (const [index, entry] of raw.entries.entries()) {
    const field = malformedEntryField(entry);
    if (field !== null) {
      return failed(`Docs index entry ${index} is malformed: ${field}`);
    }
  }
  for (const [index, context] of raw.contexts.entries()) {
    const field = malformedContextField(context);
    if (field !== null) {
      return failed(`Docs index context ${index} is malformed: ${field}`);
    }
  }
  return {
    ok: true,
    document: {
      schemaVersion: INDEX_SCHEMA_VERSION,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      entries: raw.entries as IndexEntry[],
      contexts: raw.contexts as IndexContext[],
    },
  };
}

// A meta field as a string; null when absent or not a string.
export function metaString(entry: IndexEntry, key: string): string | null {
  const value = entry.meta[key];
  return typeof value === 'string' ? value : null;
}

// The installs merged into a marketplace clone's plugin file, in install
// order; null when the entry is no such file, and [] when its `installed` is
// not a list. An element of the wrong shape is dropped.
export function installedCopies(entry: IndexEntry): InstalledCopy[] | null {
  const { installed } = entry.meta;
  if (installed === undefined) {
    return null;
  }
  if (!Array.isArray(installed)) {
    return [];
  }
  const copies: InstalledCopy[] = [];
  for (const element of installed) {
    if (isInstalledCopy(element)) {
      const { harness, version, path } = element;
      copies.push({ harness, version, path });
    }
  }
  return copies;
}

function isInstalledCopy(value: unknown): value is InstalledCopy {
  return (
    isJsonObject(value) &&
    typeof value.harness === 'string' &&
    typeof value.version === 'string' &&
    typeof value.path === 'string'
  );
}

function isIndexHeading(value: unknown): value is IndexHeading {
  return (
    isJsonObject(value) &&
    typeof value.level === 'number' &&
    typeof value.text === 'string' &&
    typeof value.line === 'number'
  );
}

function isIndexLink(value: unknown): value is IndexLink {
  return (
    isJsonObject(value) &&
    (LINK_FORMS as readonly unknown[]).includes(value.form) &&
    typeof value.raw === 'string' &&
    typeof value.target === 'string' &&
    typeof value.line === 'number' &&
    (value.targetLine === null || typeof value.targetLine === 'number')
  );
}

function failed(message: string): ParsedIndex {
  return { ok: false, message };
}

// The first field of `entry` that breaks the schema, or null. A kind or
// source need only be a string; `repo`, `root` and `plugin` are each a string
// where a known source requires it, else a string or null. One bad element of
// `headings` or `links` fails the entry. `lastLoaded` is null or a time
// `Date.parse` reads.
function malformedEntryField(entry: unknown): string | null {
  if (!isJsonObject(entry)) {
    return 'entry';
  }
  const { source } = entry;
  const ownedByRepo = source === 'repo' || source === 'features';
  const ownedByPlugin = source === 'plugin';
  const checks: [string, boolean][] = [
    ['id', typeof entry.id === 'string'],
    ['kind', typeof entry.kind === 'string'],
    ['source', typeof source === 'string'],
    ['owner', (DOC_OWNERS as readonly unknown[]).includes(entry.owner)],
    ['repo', fieldValid(entry.repo, ownedByRepo)],
    ['root', fieldValid(entry.root, ownedByRepo || ownedByPlugin)],
    ['plugin', fieldValid(entry.plugin, ownedByPlugin)],
    ['path', typeof entry.path === 'string'],
    ['line', entry.line === null || typeof entry.line === 'number'],
    ['title', typeof entry.title === 'string'],
    ['meta', isJsonObject(entry.meta)],
    ['walked', isStringArray(entry.walked)],
    [
      'headings',
      Array.isArray(entry.headings) && entry.headings.every(isIndexHeading),
    ],
    ['links', Array.isArray(entry.links) && entry.links.every(isIndexLink)],
    [
      'lastLoaded',
      entry.lastLoaded === null ||
        (typeof entry.lastLoaded === 'string' &&
          !Number.isNaN(Date.parse(entry.lastLoaded))),
    ],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}

// A source-specific field: a string where the entry's source requires it,
// else a string or null.
function fieldValid(value: unknown, isRequired: boolean): boolean {
  return typeof value === 'string' || (!isRequired && value === null);
}

// The first field of `context` that breaks the schema, or null.
function malformedContextField(context: unknown): string | null {
  if (!isJsonObject(context)) {
    return 'folder';
  }
  const checks: [string, boolean][] = [
    ['folder', typeof context.folder === 'string'],
    [
      'sessionId',
      context.sessionId === null || typeof context.sessionId === 'string',
    ],
    ['loadedPlugins', isStringRecord(context.loadedPlugins)],
    ['states', isJsonObject(context.states)],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}

// Whether `value` is an object whose every value is a string.
function isStringRecord(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}
