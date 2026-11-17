import { describe, expect, it } from 'vitest';
import type { EditorBind } from '../contracts/keymap';
import { CHORD_NOTATION_RULE } from './chord-notation';
import {
  requireUnambiguousBinds,
  requireUnambiguousEditorBinds,
  requireWellFormedChords,
} from './keymap-checks';

function bind(keys: string, scope: string, command: string): EditorBind {
  return { keys, scope, command };
}

function insertBind(keys: string, scope: string, command: string): EditorBind {
  return { keys, scope, command, mode: 'insert' };
}

describe('requireUnambiguousBinds', () => {
  it('rejects the same keys twice in one scope, naming both binds', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['x'], scope: 'review', command: 'test.first' },
        { keys: ['x'], scope: 'review', command: 'test.second' },
      ]),
    ).toThrow(/test\.first.*test\.second/);
  });

  it('rejects a bind whose keys begin another bind in one scope', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['z'], scope: 'forms', command: 'test.short' },
        { keys: ['z', 'a'], scope: 'forms', command: 'test.long' },
      ]),
    ).toThrow(/test\.short.*test\.long/);
  });

  it('rejects an any-scope bind that shares keys with a scoped one', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['?'], scope: 'help', command: 'test.close' },
        { keys: ['?'], scope: 'any', command: 'test.help' },
      ]),
    ).toThrow(/test\.close.*test\.help/);
  });

  it('accepts the same keys in different scopes', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['Escape'], scope: 'review', command: 'test.back' },
        { keys: ['Escape'], scope: 'help', command: 'test.close' },
      ]),
    ).not.toThrow();
  });

  it('rejects a bind with no keys', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: [], scope: 'forms', command: 'test.empty' },
      ]),
    ).toThrow(/test\.empty/);
  });

  it('rejects a chord bound twice in one scope', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['<C-h>'], scope: 'forms', command: 'test.first' },
        { keys: ['<C-h>'], scope: 'forms', command: 'test.second' },
      ]),
    ).toThrow(/test\.first.*test\.second/);
  });
});

describe('requireUnambiguousEditorBinds', () => {
  it('requireUnambiguousEditorBinds rejects the same keys in one scope, naming both', () => {
    const binds = [
      bind('<Leader>x', 'a.one', 'a.x'),
      bind('<Leader>x', 'a.one', 'a.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      /a\.x.*a\.y/,
    );
  });

  it('requireUnambiguousEditorBinds rejects an any bind sharing keys with a scoped one', () => {
    const binds = [bind('<Esc>', 'any', 'a.x'), bind('<Esc>', 'a.one', 'a.y')];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow();
  });

  it('requireUnambiguousEditorBinds rejects keys that begin a longer bind in another scope', () => {
    const binds = [
      bind('<Leader>d', 'a.one', 'a.x'),
      bind('<Leader>dd', 'b.two', 'b.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      'vim runs the shorter at once',
    );
  });

  it('requireUnambiguousEditorBinds accepts the same keys in different scopes', () => {
    const binds = [
      bind('<Esc>', 'a.one', 'a.x'),
      bind('<Esc>', 'a.two', 'a.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).not.toThrow();
  });

  it('requireUnambiguousEditorBinds compares keys with the leader spelled', () => {
    const binds = [
      bind('<Leader>x', 'a.one', 'a.x'),
      bind('<Space>x', 'a.one', 'a.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow();
  });

  it('requireUnambiguousEditorBinds accepts an insert and a normal bind on the same keys in one scope', () => {
    const binds = [
      bind('<CR>', 'a.one', 'a.pick'),
      insertBind('<CR>', 'a.one', 'a.pick'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).not.toThrow();
  });

  it('requireUnambiguousEditorBinds rejects two insert binds on the same keys in one scope', () => {
    const binds = [
      insertBind('<CR>', 'a.one', 'a.x'),
      insertBind('<CR>', 'a.one', 'a.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      /a\.x.*a\.y/,
    );
  });

  it("requireUnambiguousEditorBinds accepts a normal bind beginning with an insert bind's key", () => {
    const binds = [
      insertBind('<CR>', 'a.one', 'a.x'),
      bind('<CR>x', 'b.two', 'b.y'),
    ];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).not.toThrow();
  });

  it('requireUnambiguousEditorBinds rejects an insert bind of more than one key', () => {
    const binds = [insertBind('<Leader>x', 'a.one', 'a.x')];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      'must be one key',
    );
  });

  it('requireUnambiguousEditorBinds rejects an insert bind on a key outside the unbound insert keys', () => {
    const binds = [insertBind('<C-a>', 'a.one', 'a.x')];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      'insert binds take <CR>',
    );
  });
});

describe('requireWellFormedChords', () => {
  it.each(['<Ctrl-h>', '<C-S-/>'])(
    'requireWellFormedChords rejects %s',
    (token) => {
      expect(() =>
        requireWellFormedChords([
          { keys: [token], scope: 'forms', command: 'test.x' },
        ]),
      ).toThrow(CHORD_NOTATION_RULE);
    },
  );
});
