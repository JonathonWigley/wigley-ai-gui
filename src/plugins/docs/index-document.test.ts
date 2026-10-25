import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { IndexEntry } from './contract';
import {
  DOC_KINDS,
  installedCopies,
  metaString,
  parseIndexDocument,
} from './index-document';

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'rule',
    source: 'global',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: posixPaths.base(overrides.path),
    meta: {},
    walked: [],
    ...overrides,
  };
}

function documentText(fields: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 3,
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
          loadedPlugins: {},
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

  it('parse_Schema1_Unsupported', () => {
    expect(parseIndexDocument(documentText({ schemaVersion: 1 }))).toEqual({
      ok: false,
      message: 'Unsupported docs index schema 1; this app reads 3',
    });
  });

  it('parse_Schema2_Unsupported', () => {
    expect(parseIndexDocument(documentText({ schemaVersion: 2 }))).toEqual({
      ok: false,
      message: 'Unsupported docs index schema 2; this app reads 3',
    });
  });

  it('parse_EntriesNotList_SaysSo', () => {
    expect(parseIndexDocument(documentText({ entries: {} }))).toEqual({
      ok: false,
      message: 'Docs index has no entries list',
    });
  });

  it('parse_UnknownKind_Loads', () => {
    const text = documentText({
      entries: [entry({ path: '/a', kind: 'experiment' })],
    });

    const parsed = parseIndexDocument(text);

    expect(parsed.ok && parsed.document.entries[0].kind).toBe('experiment');
  });

  it('parse_UnknownSource_Loads', () => {
    const text = documentText({
      entries: [entry({ path: '/s/a', source: 'scratch', root: '/s' })],
    });

    const parsed = parseIndexDocument(text);

    expect(parsed.ok && parsed.document.entries[0].source).toBe('scratch');
  });

  it('parse_UnknownSourceRootNotString_NamesRoot', () => {
    const text = documentText({
      entries: [{ ...entry({ path: '/s/a', source: 'scratch' }), root: 3 }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: root',
    });
  });

  it('parse_MissingWalked_NamesWalked', () => {
    const { walked: _walked, ...withoutWalked } = entry({ path: '/a' });
    const text = documentText({ entries: [withoutWalked] });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: walked',
    });
  });

  it('parse_WalkedNotStrings_NamesWalked', () => {
    const text = documentText({
      entries: [{ ...entry({ path: '/a' }), walked: ['/l', 2] }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: walked',
    });
  });

  it('parse_MissingOwner_NamesOwner', () => {
    const { owner: _owner, ...withoutOwner } = entry({ path: '/a' });
    const text = documentText({ entries: [withoutOwner] });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: owner',
    });
  });

  it('parse_UnknownOwner_NamesOwner', () => {
    const text = documentText({
      entries: [{ ...entry({ path: '/a' }), owner: 'theirs' }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: owner',
    });
  });

  it('parse_ThirdPartyOwner_Loads', () => {
    const text = documentText({
      entries: [entry({ path: '/a', owner: 'third-party' })],
    });

    const parsed = parseIndexDocument(text);

    expect(parsed.ok && parsed.document.entries[0].owner).toBe('third-party');
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

  it('parse_GlobalRootNotStringOrNull_NamesRoot', () => {
    const text = documentText({
      entries: [{ ...entry({ path: '/a', source: 'global' }), root: 5 }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index entry 0 is malformed: root',
    });
  });

  it('parse_ContextWithoutFolder_NamesFolder', () => {
    const text = documentText({
      contexts: [{ sessionId: null, loadedPlugins: {}, states: {} }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index context 0 is malformed: folder',
    });
  });

  it('parse_ContextWithoutLoadedPlugins_NamesLoadedPlugins', () => {
    const text = documentText({
      contexts: [{ folder: '/u', sessionId: null, states: {} }],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index context 0 is malformed: loadedPlugins',
    });
  });

  it('parse_LoadedPluginsNotStrings_NamesLoadedPlugins', () => {
    const text = documentText({
      contexts: [
        {
          folder: '/u',
          sessionId: null,
          loadedPlugins: { 'w@m': 3 },
          states: {},
        },
      ],
    });

    expect(parseIndexDocument(text)).toEqual({
      ok: false,
      message: 'Docs index context 0 is malformed: loadedPlugins',
    });
  });

  it('parse_LoadedPlugins_Kept', () => {
    const loadedPlugins = { 'wigley@wigley-ai-marketplace': '1.9.1' };
    const text = documentText({
      contexts: [{ folder: '/u', sessionId: 's', loadedPlugins, states: {} }],
    });

    const parsed = parseIndexDocument(text);

    expect(parsed.ok && parsed.document.contexts[0].loadedPlugins).toEqual(
      loadedPlugins,
    );
  });
});

describe('DOC_KINDS', () => {
  it('docKinds_SkillFileAfterSkill', () => {
    expect(DOC_KINDS.indexOf('skill-file')).toBe(
      DOC_KINDS.indexOf('skill') + 1,
    );
  });
});

describe('installedCopies', () => {
  it('installedCopies_NoInstalled_Null', () => {
    expect(installedCopies(entry({ path: '/a', meta: {} }))).toBeNull();
  });

  it('installedCopies_Empty_Empty', () => {
    const subject = entry({ path: '/a', meta: { installed: [] } });

    expect(installedCopies(subject)).toEqual([]);
  });

  it('installedCopies_NotAList_Empty', () => {
    const subject = entry({ path: '/a', meta: { installed: 'x' } });

    expect(installedCopies(subject)).toEqual([]);
  });

  it('installedCopies_Copies_InOrder', () => {
    const installed = [
      { harness: 'claude', version: '1.9.1', path: '/c/a.md' },
      { harness: 'codex', version: '0.17.1', path: '/x/a.md' },
    ];

    const copies = installedCopies(entry({ path: '/a', meta: { installed } }));

    expect(copies).toEqual(installed);
  });

  it('installedCopies_WrongShape_Dropped', () => {
    const installed = [
      { harness: 'vim', version: '1', path: '/p' },
      { harness: 'claude', version: 2, path: '/p' },
      'x',
      null,
      { harness: 'codex', version: '1' },
      { harness: 'claude', version: '1.0.0', path: '/ok' },
    ];

    const copies = installedCopies(entry({ path: '/a', meta: { installed } }));

    expect(copies).toEqual([
      { harness: 'claude', version: '1.0.0', path: '/ok' },
    ]);
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
