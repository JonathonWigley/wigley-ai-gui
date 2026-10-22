import { describe, expect, it } from 'vitest';
import { acceleratorProblem, canonicalAccelerator } from './accelerator';

describe('acceleratorProblem', () => {
  it.each([
    'A',
    'Control+Alt+W',
    'CmdOrCtrl+Shift+F12',
    'cmd+option+space',
    'Super+num7',
    'AltGr+Plus',
    'Command+/',
    "Command+'",
    'Meta+MediaPlayPause',
    'F24',
  ])('accepts %s', (accelerator) => {
    expect(acceleratorProblem(accelerator)).toBeNull();
  });

  it('names a key it does not know', () => {
    expect(acceleratorProblem('Command+Nope')).toBe('"Nope" is not a key');
  });

  it('names a modifier it does not know', () => {
    expect(acceleratorProblem('Hyper+A')).toBe('"Hyper" is not a modifier');
  });

  it('rejects a second key where a modifier belongs', () => {
    expect(acceleratorProblem('A+B')).toBe('"A" is not a modifier');
  });

  it('rejects modifiers with no key', () => {
    expect(acceleratorProblem('Control+Shift')).toBe(
      'it ends on a modifier, not a key',
    );
  });

  it.each(['Command++', 'Command+', '+A', ''])(
    'rejects the empty part in "%s"',
    (accelerator) => {
      expect(acceleratorProblem(accelerator)).toBe(
        'it has an empty part; the + key is written "Plus"',
      );
    },
  );

  it.each(['F25', 'num10', 'F0'])('rejects %s', (accelerator) => {
    expect(acceleratorProblem(accelerator)).toBe(
      `"${accelerator}" is not a key`,
    );
  });
});

describe('canonicalAccelerator', () => {
  it.each([
    ['Cmd+K', 'Command+K'],
    ['Ctrl+Alt+A', 'control+option+a'],
    ['CmdOrCtrl+Esc', 'CommandOrControl+Escape'],
    ['Meta+Return', 'Super+Enter'],
    ['Shift+Command+K', 'command+shift+K'],
    ['Cmd+Command+K', 'Command+K'],
  ])('reads %s and %s as one chord', (a, b) => {
    expect(canonicalAccelerator(a)).toBe(canonicalAccelerator(b));
  });

  it.each([
    ['CommandOrControl+K', 'Command+K'],
    ['CommandOrControl+K', 'Control+K'],
    ['Command+K', 'Super+K'],
    ['AltGr+K', 'Alt+K'],
    ['Shift+K', 'K'],
  ])('keeps %s and %s apart', (a, b) => {
    expect(canonicalAccelerator(a)).not.toBe(canonicalAccelerator(b));
  });
});
