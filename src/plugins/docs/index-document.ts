import { errorText } from '../../shared/error-text';
import type {
  DocKind,
  DocSource,
  IndexContext,
  IndexDocument,
  IndexEntry,
} from './contract';
import { isJsonObject, isStringArray } from '../../shared/json';

export const INDEX_SCHEMA_VERSION = 2;

// `model.py`'s KINDS order; the tree groups kinds in this order.
export const DOC_KINDS: readonly DocKind[] = [
  'instructions',
  'reference',
  'learning',
  'rule',
  'skill',
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

function failed(message: string): ParsedIndex {
  return { ok: false, message };
}

// The first field of `entry` that breaks the schema, or null. A kind or
// source need only be a string; `repo`, `root` and `plugin` are each a string
// where a known source requires it, else a string or null.
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
    ['repo', fieldValid(entry.repo, ownedByRepo)],
    ['root', fieldValid(entry.root, ownedByRepo || ownedByPlugin)],
    ['plugin', fieldValid(entry.plugin, ownedByPlugin)],
    ['path', typeof entry.path === 'string'],
    ['line', entry.line === null || typeof entry.line === 'number'],
    ['title', typeof entry.title === 'string'],
    ['meta', isJsonObject(entry.meta)],
    ['walked', isStringArray(entry.walked)],
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
    ['states', isJsonObject(context.states)],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}
