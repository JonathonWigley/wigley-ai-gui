import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMissingFile } from '../../contracts/files';
import {
  THEME_TOKENS,
  type Theme,
  type ThemeChoice,
  type ThemeToken,
} from '../../contracts/theme';
import { errorText } from '../../shared/error-text';

// The theme every failure falls back to; it must be a built-in.
const FALLBACK_THEME = 'catppuccin-mocha';
const THEME_KEYS: ReadonlySet<string> = new Set(['name', 'palette', 'tokens']);
const KNOWN_TOKENS: ReadonlySet<string> = new Set(THEME_TOKENS);
const HEX_COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

export class ThemeError extends Error {
  constructor(source: string, problem: string) {
    super(`${source}: ${problem}`);
    this.name = 'ThemeError';
  }
}

type JsonObject = Record<string, unknown>;

type UserThemeFile =
  | { kind: 'theme'; theme: Theme }
  // `name` is the file's own name field, when it is readable.
  | { kind: 'broken'; name: string | null; error: string };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(
  value: unknown,
  what: string,
  source: string,
): JsonObject {
  if (!isJsonObject(value)) {
    throw new ThemeError(source, `${what} must be a JSON object`);
  }
  return value;
}

function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}

function parsePalette(value: unknown, source: string): Map<string, string> {
  const palette = new Map<string, string>();
  const entries = Object.entries(requireObject(value, '"palette"', source));
  for (const [name, colour] of entries) {
    if (!isHexColour(colour)) {
      throw new ThemeError(
        source,
        `palette "${name}": ${JSON.stringify(colour)} is not a #rrggbb or #rrggbbaa colour`,
      );
    }
    palette.set(name, colour.toLowerCase());
  }
  return palette;
}

function resolveToken(
  token: ThemeToken,
  value: unknown,
  palette: Map<string, string>,
  source: string,
): string {
  const named = typeof value === 'string' ? palette.get(value) : undefined;
  if (named) {
    return named;
  }
  if (isHexColour(value)) {
    return value.toLowerCase();
  }
  throw new ThemeError(
    source,
    `token "${token}": ${JSON.stringify(value)} is neither a palette name nor a #rrggbb or #rrggbbaa colour`,
  );
}

function parseTokens(
  value: unknown,
  palette: Map<string, string>,
  source: string,
): Record<ThemeToken, string> {
  const entries = requireObject(value, '"tokens"', source);
  for (const key of Object.keys(entries)) {
    if (!KNOWN_TOKENS.has(key)) {
      throw new ThemeError(source, `unknown token "${key}"`);
    }
  }
  const resolved = THEME_TOKENS.map((token) => {
    if (!Object.hasOwn(entries, token)) {
      throw new ThemeError(source, `token "${token}" is missing`);
    }
    return [
      token,
      resolveToken(token, entries[token], palette, source),
    ] as const;
  });
  return Object.fromEntries(resolved) as Record<ThemeToken, string>;
}

// `source` names where the JSON came from, for the error message.
export function parseTheme(json: unknown, source: string): Theme {
  const theme = requireObject(json, 'the theme', source);
  for (const key of Object.keys(theme)) {
    if (!THEME_KEYS.has(key)) {
      throw new ThemeError(
        source,
        `unknown key "${key}"; a theme has only name, palette and tokens`,
      );
    }
  }
  if (typeof theme.name !== 'string' || theme.name === '') {
    throw new ThemeError(source, '"name" must be a non-empty string');
  }
  const palette = parsePalette(theme.palette, source);
  return {
    name: theme.name,
    tokens: parseTokens(theme.tokens, palette, source),
  };
}

function themeFileNames(userDir: string): string[] {
  try {
    return readdirSync(userDir, { withFileTypes: true })
      .filter(
        (entry) =>
          !entry.isDirectory() &&
          path.extname(entry.name).toLowerCase() === '.json',
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

function readableName(json: unknown): string | null {
  return isJsonObject(json) && typeof json.name === 'string' ? json.name : null;
}

function readUserTheme(file: string): UserThemeFile {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      kind: 'broken',
      name: null,
      error: new ThemeError(file, errorText(error)).message,
    };
  }
  try {
    return { kind: 'theme', theme: parseTheme(json, file) };
  } catch (error) {
    if (!(error instanceof ThemeError)) {
      throw error;
    }
    return { kind: 'broken', name: readableName(json), error: error.message };
  }
}

// Picks the theme the settings name from the built-ins and the user's
// themes folder; any failure falls back to the built-in Mocha with an error.
export function chooseTheme(
  name: string,
  builtIns: unknown[],
  userDir: string,
): ThemeChoice {
  const themes = new Map<string, Theme>();
  for (const [index, json] of builtIns.entries()) {
    const theme = parseTheme(json, `built-in theme ${index + 1}`);
    themes.set(theme.name, theme);
  }
  const fallback = themes.get(FALLBACK_THEME);
  if (!fallback) {
    throw new Error(`No built-in theme is named "${FALLBACK_THEME}"`);
  }

  let fileNames: string[];
  try {
    fileNames = themeFileNames(userDir);
  } catch (error) {
    return {
      theme: fallback,
      error: new ThemeError(userDir, errorText(error)).message,
    };
  }

  let problem: string | null = null;
  for (const fileName of fileNames) {
    const file = readUserTheme(path.join(userDir, fileName));
    if (file.kind === 'theme') {
      themes.set(file.theme.name, file.theme);
      continue;
    }
    const couldBeSelected = file.name === null || file.name === name;
    if (couldBeSelected) {
      problem ??= file.error;
    }
  }
  if (problem !== null) {
    return { theme: fallback, error: problem };
  }

  const chosen = themes.get(name);
  if (!chosen) {
    return {
      theme: fallback,
      error: `No theme is named "${name}": not a built-in, and not in ${userDir}`,
    };
  }
  return { theme: chosen, error: null };
}
