import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_TOKENS } from '../../contracts/theme';
import { chooseTheme, parseTheme, ThemeError } from './theme-loader';

const BASE = '#1e1e2e';
const TEXT = '#cdd6f4';

// Every token names `base` unless the test overrides it.
function themeJson(name: string, tokens: Record<string, unknown> = {}) {
  return {
    name,
    palette: { base: BASE, text: TEXT },
    tokens: {
      ...Object.fromEntries(
        THEME_TOKENS.map((token) => [token, 'base'] as const),
      ),
      ...tokens,
    },
  };
}

function withoutToken(json: ReturnType<typeof themeJson>, token: string) {
  const tokens: Record<string, unknown> = { ...json.tokens };
  delete tokens[token];
  return { ...json, tokens };
}

describe('parseTheme', () => {
  it('resolves palette names and hex values to lowercase colours', () => {
    const theme = parseTheme(
      themeJson('mine', { accent: 'text', selection: '#9399B240' }),
      'mine.json',
    );

    expect(theme.name).toBe('mine');
    expect(theme.tokens['bg.base']).toBe(BASE);
    expect(theme.tokens.accent).toBe(TEXT);
    expect(theme.tokens.selection).toBe('#9399b240');
  });

  it('names the source and token of a value that is neither a palette name nor a colour', () => {
    const json = themeJson('mine', { accent: 'Base' });

    expect(() => parseTheme(json, 'mine.json')).toThrow(
      'mine.json: token "accent": "Base" is neither a palette name',
    );
  });

  it('names a missing token', () => {
    const json = withoutToken(themeJson('mine'), 'cursor');

    expect(() => parseTheme(json, 'mine.json')).toThrow(
      'mine.json: token "cursor" is missing',
    );
  });

  it('names an unknown token', () => {
    const json = themeJson('mine', { 'accent.hover': 'base' });

    expect(() => parseTheme(json, 'mine.json')).toThrow(
      'mine.json: unknown token "accent.hover"',
    );
  });

  it.each(['blue', '#fff', '#1e1e2'])(
    'names a palette entry whose value %s is not a full hex colour',
    (colour) => {
      const json = { ...themeJson('mine'), palette: { base: colour } };

      expect(() => parseTheme(json, 'mine.json')).toThrow(
        'mine.json: palette "base"',
      );
    },
  );

  it.each([
    ['not an object', []],
    ['no name', { palette: {}, tokens: {} }],
    ['an empty name', { ...themeJson('mine'), name: '' }],
    ['no palette', { name: 'mine', tokens: themeJson('mine').tokens }],
    ['an unknown key', { ...themeJson('mine'), author: 'someone' }],
  ])('rejects a theme with %s', (_case, json) => {
    expect(() => parseTheme(json, 'mine.json')).toThrow(ThemeError);
  });
});

describe('chooseTheme', () => {
  // The built-in fallback; every token resolves to BASE.
  const mocha = themeJson('catppuccin-mocha');
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wigley-themes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeUserFile(fileName: string, content: unknown) {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content);
    writeFileSync(path.join(dir, fileName), text);
  }

  it('picks the named built-in when the themes folder is missing', () => {
    const choice = chooseTheme(
      'catppuccin-mocha',
      [mocha],
      path.join(dir, 'absent'),
    );

    expect(choice.theme.name).toBe('catppuccin-mocha');
    expect(choice.error).toBeNull();
  });

  it('lets a user theme override the built-in of the same name', () => {
    writeUserFile(
      'mocha.json',
      themeJson('catppuccin-mocha', { accent: 'text' }),
    );

    const choice = chooseTheme('catppuccin-mocha', [mocha], dir);

    expect(choice.theme.tokens.accent).toBe(TEXT);
    expect(choice.error).toBeNull();
  });

  it('picks a user theme by its name, not its file name', () => {
    writeUserFile('one.json', themeJson('nord', { accent: 'text' }));

    const choice = chooseTheme('nord', [mocha], dir);

    expect(choice.theme.name).toBe('nord');
    expect(choice.theme.tokens.accent).toBe(TEXT);
    expect(choice.error).toBeNull();
  });

  it('falls back to Mocha and names a theme nothing provides', () => {
    const choice = chooseTheme('nord', [mocha], dir);

    expect(choice.theme.name).toBe('catppuccin-mocha');
    expect(choice.error).toContain('No theme is named "nord"');
  });

  it('falls back to the built-in Mocha and names the file and token of a broken selected theme', () => {
    writeUserFile('nord.json', themeJson('nord', { accent: 'frost' }));

    const choice = chooseTheme('nord', [mocha], dir);

    expect(choice.theme).toEqual(parseTheme(mocha, 'mocha'));
    expect(choice.error).toContain(path.join(dir, 'nord.json'));
    expect(choice.error).toContain('token "accent"');
  });

  it('skips a broken theme whose name the settings do not pick', () => {
    writeUserFile('other.json', themeJson('other', { accent: 'frost' }));

    const choice = chooseTheme('catppuccin-mocha', [mocha], dir);

    expect(choice.error).toBeNull();
  });

  it.each([
    ['is not JSON', '{ "name": '],
    ['has no name', { palette: {}, tokens: {} }],
  ])('reports a file that %s whichever theme is selected', (_case, content) => {
    writeUserFile('broken.json', content);

    const choice = chooseTheme('catppuccin-mocha', [mocha], dir);

    expect(choice.theme.name).toBe('catppuccin-mocha');
    expect(choice.error).toContain(path.join(dir, 'broken.json'));
  });

  it('reads only .json files and skips folders', () => {
    writeUserFile('notes.txt', 'not a theme');
    mkdirSync(path.join(dir, 'drafts.json'));

    const choice = chooseTheme('catppuccin-mocha', [mocha], dir);

    expect(choice.error).toBeNull();
  });

  it('falls back to Mocha with the error when the themes folder cannot be read', () => {
    const notAFolder = path.join(dir, 'themes');
    writeFileSync(notAFolder, 'a file where the folder should be');

    const choice = chooseTheme('nord', [mocha], notAFolder);

    expect(choice.theme.name).toBe('catppuccin-mocha');
    expect(choice.error).toContain(notAFolder);
    expect(choice.error).toContain('ENOTDIR');
  });

  it('throws when no built-in is the Mocha fallback', () => {
    expect(() => chooseTheme('nord', [themeJson('nord')], dir)).toThrow(
      'No built-in theme is named "catppuccin-mocha"',
    );
  });
});
