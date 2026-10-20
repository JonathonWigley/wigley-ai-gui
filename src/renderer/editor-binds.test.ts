import { describe, expect, it } from 'vitest';
import type { EditorBind } from '../contracts/keymap';
import {
  editorBindInForce,
  requireUnambiguousEditorBinds,
} from './editor-binds';

function bind(keys: string, scope: string, command: string): EditorBind {
  return { keys, scope, command };
}

function insertBind(keys: string, scope: string, command: string): EditorBind {
  return { keys, scope, command, mode: 'insert' };
}

describe('editorBindInForce', () => {
  it('editorBindInForce picks the bind whose scope is in force', () => {
    const close = bind('<Esc>', 'b.two', 'b.close');
    const binds = [bind('<Esc>', 'a.one', 'a.leave'), close];

    expect(editorBindInForce(binds, 'b.two')).toEqual({
      kind: 'run',
      bind: close,
    });
  });

  it('editorBindInForce takes an any bind in every scope', () => {
    const help = bind('<Leader>?', 'any', 'k.help');

    expect(editorBindInForce([help], 'z.q')).toEqual({
      kind: 'run',
      bind: help,
    });
  });

  it('editorBindInForce names the keys and scope when no bind is in force', () => {
    const binds = [
      bind('<Leader>x', 'forms.forms', 'forms.toggleNotApplicable'),
    ];

    expect(editorBindInForce(binds, 'keys.help')).toEqual({
      kind: 'none',
      message: '<Leader>x has no bind in keys.help',
    });
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
    const binds = [insertBind('g', 'a.one', 'a.x'), bind('gx', 'b.two', 'b.y')];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).not.toThrow();
  });

  it('requireUnambiguousEditorBinds rejects an insert bind of more than one key', () => {
    const binds = [insertBind('<Leader>x', 'a.one', 'a.x')];

    expect(() => requireUnambiguousEditorBinds(binds, '<Space>')).toThrow(
      'must be one key',
    );
  });
});
