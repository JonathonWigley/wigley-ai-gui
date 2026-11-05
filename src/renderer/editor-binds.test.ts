import { describe, expect, it } from 'vitest';
import type { EditorBind } from '../contracts/keymap';
import type { TextEditor } from '../contracts/editor';
import { editorBindInForce, runEditorBind } from './editor-binds';

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

  it('editorBindInForce reports none, naming the keys, when no bind is in force', () => {
    const binds = [
      bind('<Leader>x', 'forms.forms', 'forms.toggleNotApplicable'),
    ];

    expect(editorBindInForce(binds, 'keys.help')).toEqual({
      kind: 'none',
      message: expect.stringContaining('<Leader>x'),
    });
  });
});

describe('runEditorBind', () => {
  const fired = {} as TextEditor;

  function run(binds: EditorBind[], scope: string, hasHandler = true) {
    const ran: [EditorBind, TextEditor][] = [];
    const logs: string[] = [];
    const result = runEditorBind(binds, fired, {
      scope: () => scope,
      run(each, editor) {
        ran.push([each, editor]);
        return hasHandler;
      },
      log: (source, message) => void logs.push(`${source}: ${message}`),
    });
    return { result, ran, logs };
  }

  it('runEditorBind_BindInForce_RunsAndReturnsTrue', () => {
    const close = bind('<Esc>', 'b.two', 'b.close');

    const { result, ran, logs } = run(
      [bind('<Esc>', 'a.one', 'a.leave'), close],
      'b.two',
    );

    expect(result).toBe(true);
    expect(ran).toEqual([[close, fired]]);
    expect(logs).toEqual([]);
  });

  it.each([
    { row: 'normal mode', mode: undefined },
    { row: 'insert mode', mode: 'insert' as const },
  ])('runEditorBind_RunFindsNoHandler_ReturnsFalse: $row', ({ mode }) => {
    const stale = { ...bind('<CR>', 'a.one', 'a.gone'), mode };

    const { result } = run([stale], 'a.one', false);

    expect(result).toBe(false);
  });

  it('runEditorBind_NormalModeMiss_LogsAndReturnsFalse', () => {
    const { result, ran, logs } = run([bind('<Esc>', 'a.one', 'a.x')], 'b.two');

    expect(result).toBe(false);
    expect(ran).toEqual([]);
    expect(logs).toEqual([expect.stringContaining('<Esc>')]);
  });

  it('runEditorBind_InsertModeMiss_ReturnsFalseAndLogsNothing', () => {
    const { result, logs } = run(
      [{ ...bind('<CR>', 'a.one', 'a.x'), mode: 'insert' }],
      'b.two',
    );

    expect(result).toBe(false);
    expect(logs).toEqual([]);
  });
});
