import { describe, expect, it } from 'vitest';
import type { EditorBind } from '../contracts/keymap';
import { editorBindInForce } from './editor-binds';

function bind(keys: string, scope: string, command: string): EditorBind {
  return { keys, scope, command };
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
