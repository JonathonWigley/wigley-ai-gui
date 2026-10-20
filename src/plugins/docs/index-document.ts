import { errorText } from '../../shared/error-text';
import type {
  DocKind,
  DocSource,
  IndexContext,
  IndexDocument,
  IndexEntry,
} from './contract';

export const INDEX_SCHEMA_VERSION = 1;

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
  if (!isRecord(raw) || typeof raw.schemaVersion !== 'number') {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The first field of `entry` that breaks the schema, or null.
function malformedEntryField(entry: unknown): string | null {
  if (!isRecord(entry)) {
    return 'entry';
  }
  const source = entry.source as DocSource;
  const ownedByRepo = source === 'repo' || source === 'features';
  const ownedByPlugin = source === 'plugin';
  const checks: [string, boolean][] = [
    ['id', typeof entry.id === 'string'],
    ['kind', DOC_KINDS.includes(entry.kind as DocKind)],
    ['source', DOC_SOURCES.includes(source)],
    ['repo', !ownedByRepo || typeof entry.repo === 'string'],
    ['root', !(ownedByRepo || ownedByPlugin) || typeof entry.root === 'string'],
    ['plugin', !ownedByPlugin || typeof entry.plugin === 'string'],
    ['path', typeof entry.path === 'string'],
    ['line', entry.line === null || typeof entry.line === 'number'],
    ['title', typeof entry.title === 'string'],
    ['meta', isRecord(entry.meta)],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}

// The first field of `context` that breaks the schema, or null.
function malformedContextField(context: unknown): string | null {
  if (!isRecord(context)) {
    return 'folder';
  }
  const checks: [string, boolean][] = [
    ['folder', typeof context.folder === 'string'],
    [
      'sessionId',
      context.sessionId === null || typeof context.sessionId === 'string',
    ],
    ['states', isRecord(context.states)],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}
