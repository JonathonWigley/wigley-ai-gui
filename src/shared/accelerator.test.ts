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
    expect(acceleratorProblem('Command+Nope')).toContain('"Nope"');
  });

  it('names a modifier it does not know', () => {
    expect(acceleratorProblem('Hyper+A')).toContain('"Hyper"');
  });

  it('rejects a second key where a modifier belongs', () => {
    expect(acceleratorProblem('A+B')).toContain('"A"');
  });

  it('rejects modifiers with no key', () => {
    expect(acceleratorProblem('Control+Shift')).not.toBeNull();
  });

  it.each(['Command++', 'Command+', '+A', ''])(
    'rejects the empty part in "%s"',
    (accelerator) => {
      expect(acceleratorProblem(accelerator)).not.toBeNull();
    },
  );

  it.each(['F25', 'num10', 'F0'])('rejects %s', (accelerator) => {
    expect(acceleratorProblem(accelerator)).toContain(`"${accelerator}"`);
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
