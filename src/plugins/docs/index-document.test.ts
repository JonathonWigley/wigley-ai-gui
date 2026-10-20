import { describe, expect, it } from 'vitest';
import type { IndexEntry } from './contract';
import { baseName } from './doc-paths';
import { metaString, parseIndexDocument } from './index-document';

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'rule',
    source: 'global',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: baseName(overrides.path),
    meta: {},
    ...overrides,
  };
}

function documentText(fields: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-10-19T14:02:11Z',
    entries: [],
    contexts: [],
    ...fields,
  });
}

describe('parseIndexDocument', () => {
  it('parse_ValidDocument_ReturnsEntriesAndContexts', () => {
    const text = documentText({
      entries: [entry({ path: '/x', kind: 'skill' })],
      contexts: [
        {
          folder: '/Users/u',
          sessionId: null,
          states: { '/x': { claude: { state: 'launch', reason: 'r' } } },
        },
      ],
    });

    const parsed = parseIndexDocument(text);

    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    expect(parsed.document.entries[0].kind).toBe('skill');
    expect(parsed.document.contexts[0].folder).toBe('/Users/u');
    expect(parsed.document.contexts[0].states['/x'].claude?.state).toBe(
      'launch',
    );
  });

  it('parse_NotJson_NamesTheJsonError', () => {
    const parsed = parseIndexDocument('{');

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toMatch(
      /^Docs index is not valid JSON: /,
    );
  });

  it('parse_NoSchemaVersion_SaysSo', () => {
    for (const text of ['{}', '[]']) {
      expect(parseIndexDocument(text)).toEqual({
        ok: false,
        message: 'Docs index has no schemaVersion',
      });
    }
  });

  it('parse_SchemaTwo_RefusesWithPinnedMessage', () => {
    expect(parseIndexDocument(documentText({ schemaVersion: 2 }))).toEqual({
      ok: false,
      message: 'Unsupported docs index schema 2; this app reads 1',
    });
  });

  it('parse_EntriesNotList_SaysSo', () => {
    expect(parseIndexDocument(documentText({ entries: {} }))).toEqual({
      ok: false,
      message: 'Docs index has no entries list',
    });
  });

  it('parse_UnknownKind_NamesEntryAndField', () => {
    const text = documentText({
      entries: [
        entry({ path: '/a' }),
        { ...entry({ path: '/b' }), kind: 'widget' },
      ],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 1 is malformed: kind',
    });
  });

  it('parse_RepoEntryWithoutRoot_NamesRoot', () => {
    const text = documentText({
      entries: [entry({ path: '/a', source: 'repo', repo: 'r', root: null })],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: root',
    });
  });

  it('parse_ContextWithoutFolder_NamesFolder', () => {
    const text = documentText({ contexts: [{ sessionId: null, states: {} }] });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index context 0 is malformed: folder',
    });
  });
});

describe('metaString', () => {
  it('metaString_NonString_Null', () => {
    const subject = entry({ path: '/a', meta: { slug: 'a', checked: 2 } });

    expect(metaString(subject, 'slug')).toBe('a');
    expect(metaString(subject, 'checked')).toBe(null);
    expect(metaString(subject, 'none')).toBe(null);
  });
});
