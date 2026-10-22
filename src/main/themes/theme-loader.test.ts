import { describe, expect, it } from 'vitest';
import {
  resolveTheme,
  type ThemeFileText,
  type ThemeTokenRegistry,
} from './theme-loader';

const registry: ThemeTokenRegistry = {
  core: {
    fg: 'color',
    accent: 'color',
    'focus-border': 'color',
    'window-background': 'color',
    'space-2': 'length',
    'duration-fast': 'duration',
    'leading-ui': 'number',
    'focus-ring': 'shadow',
    'material-chrome-filter': 'filter',
    'font-ui': 'raw',
  },
  plugins: {
    'forms.origin-caused': { kind: 'color', default: 'var(--wg-accent)' },
  },
};

const PALETTE = {
  mauve: '#cba6f7',
  base: '#1e1e2e',
  crust: '#11111b',
  glass: '#11111b80',
};

// A root theme setting every core token in `registry` to a valid value.
function rootTheme(name: string, tokens: Record<string, unknown> = {}) {
  return {
    name,
    colorScheme: 'dark',
    palette: PALETTE,
    tokens: {
      fg: 'mauve',
      accent: '#CBA6F7',
      'focus-border': 'transparent',
      'window-background': 'crust',
      'space-2': '8px',
      'duration-fast': '90ms',
      'leading-ui': '1.4',
      'focus-ring': '0 0 0 1px var(--wg-focus-border)',
      'material-chrome-filter': 'blur(24px) saturate(160%)',
      'font-ui': 'system-ui, sans-serif',
      ...tokens,
    },
  };
}

function userFile(json: unknown, file?: string): ThemeFileText {
  const name = (json as { name: string }).name;
  return { file: file ?? `${name}.json`, text: JSON.stringify(json) };
}

// Resolves `name` with `json` as the only user theme.
function resolveMine(json: unknown, name = 'mine') {
  return resolveTheme(name, [], [userFile(json)], registry);
}

describe('resolveTheme', () => {
  it('resolves palette names, hex in any case, transparent and aliases', () => {
    const theme = resolveMine(rootTheme('mine'));

    expect(theme.name).toBe('mine');
    expect(theme.colorScheme).toBe('dark');
    expect(theme.tokens.fg).toBe('#cba6f7');
    expect(theme.tokens.accent).toBe('#cba6f7');
    expect(theme.tokens['focus-border']).toBe('transparent');
    expect(theme.tokens['focus-ring']).toBe('0 0 0 1px var(--wg-focus-border)');
  });

  it.each([
    ['mauve / 0.16', '#cba6f729'],
    ['mauve/0.5', '#cba6f780'],
    ['mauve / 1', '#cba6f7ff'],
    ['mauve / 0', '#cba6f700'],
  ])('resolves a palette name with alpha: %s', (value, resolved) => {
    const theme = resolveMine(rootTheme('mine', { fg: value }));

    expect(theme.tokens.fg).toBe(resolved);
  });

  it('rejects alpha on a palette entry that has one', () => {
    expect(() => resolveMine(rootTheme('mine', { fg: 'glass / 0.5' }))).toThrow(
      'mine.json: token "fg": palette "glass" already has an alpha',
    );
  });

  it.each<[string, string, string, boolean]>([
    ['space-2', 'length', '8px', true],
    ['space-2', 'length', '0', true],
    ['space-2', 'length', '76ch', true],
    ['space-2', 'length', '8', false],
    ['duration-fast', 'duration', '90ms', true],
    ['duration-fast', 'duration', '0.2s', true],
    ['duration-fast', 'duration', '90', false],
    ['leading-ui', 'number', '1.4', true],
    ['leading-ui', 'number', '1.4px', false],
    ['material-chrome-filter', 'filter', 'blur(24px) saturate(160%)', true],
    ['material-chrome-filter', 'filter', 'none', true],
    ['material-chrome-filter', 'filter', 'blur(24px', false],
    ['focus-ring', 'shadow', '0 1px 2px rgb(0 0 0 / 0.30)', true],
    ['focus-ring', 'shadow', 'a; b', false],
    ['fg', 'color', 'mauve / 1.5', false],
    ['fg', 'color', 'Mauve', false],
  ])(
    'accepts and rejects values by kind: %s %s %s',
    (token, kind, value, ok) => {
      const resolve = () => resolveMine(rootTheme('mine', { [token]: value }));

      if (ok) {
        expect(resolve().tokens[token]).toBe(value);
      } else {
        expect(resolve).toThrow(
          `mine.json: token "${token}": "${value}" is not a ${kind} value`,
        );
      }
    },
  );

  it('names a missing core token', () => {
    const json = rootTheme('mine');
    delete (json.tokens as Record<string, unknown>).accent;

    expect(() => resolveMine(json)).toThrow(
      'mine.json: token "accent" is missing; a theme with no "extends" sets every core token',
    );
  });

  it('names an unknown token in tokens and in reduced', () => {
    expect(() =>
      resolveMine(rootTheme('mine', { 'accent-glow': 'mauve' })),
    ).toThrow('mine.json: unknown token "accent-glow"');
    expect(() =>
      resolveMine({
        ...rootTheme('mine'),
        reduced: { 'accent-glow': 'mauve' },
      }),
    ).toThrow('mine.json: unknown token "accent-glow" in reduced');
  });

  it('names an alias to no token and an alias of the wrong kind', () => {
    expect(() =>
      resolveMine(rootTheme('mine', { 'focus-border': 'var(--wg-nope)' })),
    ).toThrow('mine.json: token "focus-border": var(--wg-nope) names no token');
    expect(() =>
      resolveMine(rootTheme('mine', { 'focus-border': 'var(--wg-space-2)' })),
    ).toThrow(
      'mine.json: token "focus-border": var(--wg-space-2) is a length token, not a color token',
    );
  });

  it("names the base's file for a bad value set in the base", () => {
    const base = userFile(rootTheme('base', { 'space-2': '8' }));
    const child = userFile({ name: 'child', extends: 'base' });

    expect(() => resolveTheme('child', [], [base, child], registry)).toThrow(
      'base.json: token "space-2": "8" is not a length value',
    );
  });

  it('names an alias cycle', () => {
    const json = rootTheme('mine', {
      fg: 'var(--wg-accent)',
      accent: 'var(--wg-fg)',
    });

    expect(() => resolveMine(json)).toThrow(
      'mine.json: alias cycle: fg → accent → fg',
    );
  });

  it('merges an extended theme over its base', () => {
    const child = userFile({
      name: 'child',
      extends: 'mine',
      palette: { mauve: '#ff0000' },
      tokens: { 'space-2': '10px' },
      reduced: { 'material-chrome-filter': 'none' },
    });

    const theme = resolveTheme(
      'child',
      [],
      [userFile(rootTheme('mine')), child],
      registry,
    );

    expect(theme.name).toBe('child');
    expect(theme.colorScheme).toBe('dark');
    expect(theme.tokens.fg).toBe('#ff0000');
    expect(theme.tokens['space-2']).toBe('10px');
    expect(theme.reduced).toEqual({ 'material-chrome-filter': 'none' });
  });

  it('extends the built-in of its own name', () => {
    const user = userFile({
      name: 'mine',
      extends: 'mine',
      tokens: { 'space-2': '12px' },
    });

    const theme = resolveTheme('mine', [rootTheme('mine')], [user], registry);

    expect(theme.tokens['space-2']).toBe('12px');
    expect(theme.tokens.fg).toBe('#cba6f7');
  });

  it('lets a user theme replace a built-in of the same name', () => {
    const user = userFile(rootTheme('mine', { fg: 'base' }));

    const theme = resolveTheme('mine', [rootTheme('mine')], [user], registry);

    expect(theme.tokens.fg).toBe('#1e1e2e');
  });

  it('names an extends cycle and an unknown base', () => {
    const a = userFile({ name: 'a', extends: 'b' });
    const b = userFile({ name: 'b', extends: 'a' });

    expect(() => resolveTheme('a', [], [a, b], registry)).toThrow(
      'b.json: "extends" cycle: a → b → a',
    );
    expect(() =>
      resolveTheme(
        'a',
        [],
        [userFile({ name: 'a', extends: 'nope' })],
        registry,
      ),
    ).toThrow('a.json: "extends" names "nope", which no theme has');
  });

  it('names a theme nothing provides', () => {
    expect(() =>
      resolveTheme('nope', [rootTheme('mine')], [], registry),
    ).toThrow('settings.json: "theme" names "nope", which no theme has');
  });

  it('gives an unset plugin token its default and lets a theme set it', () => {
    expect(resolveMine(rootTheme('mine')).tokens['forms.origin-caused']).toBe(
      'var(--wg-accent)',
    );
    const set = rootTheme('mine', { 'forms.origin-caused': 'base' });
    expect(resolveMine(set).tokens['forms.origin-caused']).toBe('#1e1e2e');
  });

  it('names a user file whose JSON does not parse', () => {
    expect(() =>
      resolveTheme(
        'mine',
        [rootTheme('mine')],
        [{ file: 'bad.json', text: '{' }],
        registry,
      ),
    ).toThrow(/^bad\.json: /);
  });

  it('skips a broken user theme outside the chain', () => {
    const other = userFile(rootTheme('other', { 'accent-glow': 'mauve' }));

    const theme = resolveTheme(
      'mine',
      [],
      [userFile(rootTheme('mine')), other],
      registry,
    );

    expect(theme.name).toBe('mine');
  });

  it('names two user files with the selected name', () => {
    const first = userFile(rootTheme('mine'), 'a.json');
    const second = userFile(rootTheme('mine'), 'b.json');

    expect(() => resolveTheme('mine', [], [first, second], registry)).toThrow(
      'b.json: two theme files are named "mine": a.json and b.json',
    );
  });

  it.each(['glass', 'var(--wg-fg)'])(
    'rejects a window background that is not opaque hex: %s',
    (value) => {
      const json = rootTheme('mine', { 'window-background': value });

      expect(() => resolveMine(json)).toThrow(
        'mine.json: token "window-background": must be an opaque #rrggbb colour or a palette name holding one, since the native window paints it',
      );
    },
  );

  it.each(['glass', 'var(--wg-fg)'])(
    'rejects a reduced window background that is not opaque hex: %s',
    (value) => {
      const json = {
        ...rootTheme('mine'),
        reduced: { 'window-background': value },
      };

      expect(() => resolveMine(json)).toThrow(
        'mine.json: token "window-background": must be an opaque #rrggbb colour or a palette name holding one, since the native window paints it',
      );
    },
  );

  it('names an unknown key and a bad colorScheme', () => {
    expect(() => resolveMine({ ...rootTheme('mine'), foo: 1 })).toThrow(
      'mine.json: unknown key "foo"; a theme has only name, extends, colorScheme, palette, tokens and reduced',
    );
    expect(() =>
      resolveMine({ ...rootTheme('mine'), colorScheme: 'dim' }),
    ).toThrow('mine.json: "colorScheme" must be "dark" or "light"');
  });
});
