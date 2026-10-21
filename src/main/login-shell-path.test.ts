import { describe, expect, it } from 'vitest';
import { pathFromMarkedOutput } from './login-shell-path';

const START = '__WIGLEY_LOGIN_PATH_START__';
const END = '__WIGLEY_LOGIN_PATH_END__';

describe('pathFromMarkedOutput', () => {
  it('reads the PATH between the markers, ignoring what the profile prints around it', () => {
    const output = `Welcome back\n${START}/opt/homebrew/bin:/usr/bin${END}\nbye\n`;

    expect(pathFromMarkedOutput(output)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('reads the first marked PATH when the shell prints the markers twice', () => {
    const output = `${START}/a:/b${END}${START}/c${END}`;

    expect(pathFromMarkedOutput(output)).toBe('/a:/b');
  });

  it.each([
    ['no markers', '/usr/bin:/bin'],
    ['no end marker, as when the shell was killed', `${START}/usr/bin`],
    ['an end marker only', `/usr/bin${END}`],
    ['an end marker before the start marker', `${END}/usr/bin${START}`],
    ['nothing between the markers', `${START}  ${END}`],
    ['empty output', ''],
  ])('returns null for %s', (_case, output) => {
    expect(pathFromMarkedOutput(output)).toBeNull();
  });
});
