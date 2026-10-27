import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { IndexEntry } from './contract';
import {
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
    lastLoaded: null,
    ...overrides,
  };
}

// `subject` without its `field`.
function without(subject: IndexEntry, field: keyof IndexEntry) {
  const { [field]: _dropped, ...rest } = subject;
  return rest;
}

function documentText(fields: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 4,
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
    expect(!parsed.ok && parsed.message).toMatch(/JSON/);
  });

  it('parse_NoSchemaVersion_SaysSo', () => {
    for (const text of ['{}', '[]']) {
      expect(parseIndexDocument(text)).toEqual({
        ok: false,
        message: expect.stringContaining('schemaVersion'),
      });
    }
  });

  it.each([1, 2, 3])('parse_Schema%i_Unsupported', (version) => {
    expect(
      parseIndexDocument(documentText({ schemaVersion: version })),
    ).toEqual({
      ok: false,
      message: expect.stringContaining(`schema ${version}`),
    });
  });

  it.each([
    {
      given: 'entries not a list',
      fields: { entries: {} },
      problem: 'no entries list',
    },
    {
      given: 'an unknown source with a root not a string',
      fields: {
        entries: [{ ...entry({ path: '/s/a', source: 'scratch' }), root: 3 }],
      },
      problem: 'entry 0 is malformed: root',
    },
    {
      given: 'no walked',
      fields: { entries: [without(entry({ path: '/a' }), 'walked')] },
      problem: 'entry 0 is malformed: walked',
    },
    {
      given: 'walked not strings',
      fields: { entries: [{ ...entry({ path: '/a' }), walked: ['/l', 2] }] },
      problem: 'entry 0 is malformed: walked',
    },
    {
      given: 'no lastLoaded',
      fields: { entries: [without(entry({ path: '/a' }), 'lastLoaded')] },
      problem: 'entry 0 is malformed: lastLoaded',
    },
    {
      given: 'a number lastLoaded',
      fields: { entries: [{ ...entry({ path: '/a' }), lastLoaded: 3 }] },
      problem: 'entry 0 is malformed: lastLoaded',
    },
    {
      given: 'a lastLoaded not a time',
      fields: {
        entries: [{ ...entry({ path: '/a' }), lastLoaded: 'yesterday' }],
      },
      problem: 'entry 0 is malformed: lastLoaded',
    },
    {
      given: 'no owner',
      fields: { entries: [without(entry({ path: '/a' }), 'owner')] },
      problem: 'entry 0 is malformed: owner',
    },
    {
      given: 'an unknown owner',
      fields: { entries: [{ ...entry({ path: '/a' }), owner: 'theirs' }] },
      problem: 'entry 0 is malformed: owner',
    },
    {
      given: 'a repo entry without a root',
      fields: {
        entries: [entry({ path: '/a', source: 'repo', repo: 'r', root: null })],
      },
      problem: 'entry 0 is malformed: root',
    },
    {
      given: 'a global root not a string or null',
      fields: {
        entries: [{ ...entry({ path: '/a', source: 'global' }), root: 5 }],
      },
      problem: 'entry 0 is malformed: root',
    },
    {
      given: 'a context without a folder',
      fields: {
        contexts: [{ sessionId: null, loadedPlugins: {}, states: {} }],
      },
      problem: 'context 0 is malformed: folder',
    },
    {
      given: 'a context without loadedPlugins',
      fields: { contexts: [{ folder: '/u', sessionId: null, states: {} }] },
      problem: 'context 0 is malformed: loadedPlugins',
    },
    {
      given: 'loadedPlugins not strings',
      fields: {
        contexts: [
          {
            folder: '/u',
            sessionId: null,
            loadedPlugins: { 'w@m': 3 },
            states: {},
          },
        ],
      },
      problem: 'context 0 is malformed: loadedPlugins',
    },
  ])('parse with $given names $problem', ({ fields, problem }) => {
    expect(parseIndexDocument(documentText(fields))).toEqual({
      ok: false,
      message: expect.stringContaining(problem),
    });
  });

  it.each([
    {
      given: 'an unknown kind',
      fields: { entries: [entry({ path: '/a', kind: 'experiment' })] },
    },
    {
      given: 'an unknown source',
      fields: {
        entries: [entry({ path: '/s/a', source: 'scratch', root: '/s' })],
      },
    },
    {
      given: 'a null lastLoaded',
      fields: { entries: [entry({ path: '/a', lastLoaded: null })] },
    },
    {
      given: 'a lastLoaded time',
      fields: {
        entries: [
          entry({ path: '/a', lastLoaded: '2026-10-26T21:01:32.174Z' }),
        ],
      },
    },
    {
      given: 'a third-party owner',
      fields: { entries: [entry({ path: '/a', owner: 'third-party' })] },
    },
    {
      given: 'loadedPlugins',
      fields: {
        contexts: [
          {
            folder: '/u',
            sessionId: 's',
            loadedPlugins: { 'wigley@wigley-ai-marketplace': '1.9.1' },
            states: {},
          },
        ],
      },
    },
  ])('parse with $given loads it as written', ({ fields }) => {
    const parsed = parseIndexDocument(documentText(fields));

    expect(parsed).toMatchObject({ ok: true, document: fields });
  });
});

describe('installedCopies', () => {
  it.each([
    { given: 'no installed', meta: {}, expected: null },
    { given: 'an empty list', meta: { installed: [] }, expected: [] },
    { given: 'not a list', meta: { installed: 'x' }, expected: [] },
    {
      given: 'copies',
      meta: {
        installed: [
          { harness: 'claude', version: '1.9.1', path: '/c/a.md' },
          { harness: 'codex', version: '0.17.1', path: '/x/a.md' },
        ],
      },
      expected: [
        { harness: 'claude', version: '1.9.1', path: '/c/a.md' },
        { harness: 'codex', version: '0.17.1', path: '/x/a.md' },
      ],
    },
    {
      given: 'copies of the wrong shape',
      meta: {
        installed: [
          { harness: 'vim', version: '1', path: '/p' },
          { harness: 'claude', version: 2, path: '/p' },
          'x',
          null,
          { harness: 'codex', version: '1' },
          { harness: 'claude', version: '1.0.0', path: '/ok' },
        ],
      },
      expected: [{ harness: 'claude', version: '1.0.0', path: '/ok' }],
    },
  ])('installedCopies given $given → $expected', ({ meta, expected }) => {
    expect(installedCopies(entry({ path: '/a', meta }))).toEqual(expected);
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
