import type {
  ColorScheme,
  Theme,
  TokenDecl,
  TokenKind,
} from '../../contracts/theme';
import { errorText } from '../../shared/error-text';
import { themeVariable } from '../../shared/theme-variables';

// A user theme file's text, and the file it came from for error messages.
export interface ThemeFileText {
  file: string;
  text: string;
}

// The tokens a theme may set: the core's by name, the plugins' by qualified
// name (`forms.origin-caused`).
export interface ThemeTokenRegistry {
  core: Readonly<Record<string, TokenKind>>;
  plugins: Readonly<Record<string, TokenDecl>>;
}

// `message` is `<file>: <problem>`.
export class ThemeError extends Error {
  readonly file: string;
  readonly problem: string;

  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`);
    this.name = 'ThemeError';
    this.file = file;
    this.problem = problem;
  }
}

type JsonObject = Record<string, unknown>;

// A theme file found by its name, before any of its tokens are checked.
interface ThemeSource {
  file: string;
  name: string;
  json: JsonObject;
}

// A merged token value and the file that set it.
interface SetValue {
  value: unknown;
  file: string;
}

const THEME_KEYS: ReadonlySet<string> = new Set([
  'name',
  'extends',
  'colorScheme',
  'palette',
  'tokens',
  'reduced',
]);
const COLOR_SCHEMES: ReadonlySet<string> = new Set(['dark', 'light']);
const WINDOW_BACKGROUND = 'window-background';

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const HEX_COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const OPAQUE_HEX = /^#[0-9a-f]{6}$/;
const ALPHA_COLOUR = /^([^\s/]+)\s*\/\s*(0|1|1\.0+|0?\.\d+)$/;
const WHOLE_ALIAS = /^var\(--wg-([^\s,()]+)\)$/;
const ALIAS = /var\(--wg-([^\s,()]+)\)/g;
const LENGTH = new RegExp(`^(?:0|-?${NUMBER}(?:px|rem|em|ch|%|vh|vw))$`);
const DURATION = new RegExp(`^${NUMBER}(?:ms|s)$`);
const NUMBER_VALUE = new RegExp(`^-?${NUMBER}$`);
const FILTER_FUNCTION_NAME = /^[a-z-]+\(/;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readableName(json: unknown): string | null {
  const hasName =
    isJsonObject(json) && typeof json.name === 'string' && json.name !== '';
  return hasName ? (json.name as string) : null;
}

function requireName(json: unknown, file: string): ThemeSource {
  const name = readableName(json);
  if (name === null) {
    throw new ThemeError(file, '"name" must be a non-empty string');
  }
  return { file, name, json: json as JsonObject };
}

function builtInSources(
  builtIns: readonly unknown[],
): Map<string, ThemeSource> {
  const sources = new Map<string, ThemeSource>();
  for (const [index, json] of builtIns.entries()) {
    const name = readableName(json);
    const file =
      name === null
        ? `built-in theme ${index + 1}`
        : `built-in theme "${name}"`;
    const source = requireName(json, file);
    sources.set(source.name, source);
  }
  return sources;
}

// Each user theme by name, the first file holding it, and every name two
// files hold with those two files. Throws on a file whose JSON does not parse
// or that has no readable name, since it could be any theme in the chain.
function userSources(userThemes: readonly ThemeFileText[]): {
  sources: Map<string, ThemeSource>;
  duplicates: Map<string, [string, string]>;
} {
  const sources = new Map<string, ThemeSource>();
  const duplicates = new Map<string, [string, string]>();
  for (const { file, text } of userThemes) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new ThemeError(file, errorText(error));
    }
    const source = requireName(json, file);
    const first = sources.get(source.name);
    if (first === undefined) {
      sources.set(source.name, source);
    } else if (!duplicates.has(source.name)) {
      duplicates.set(source.name, [first.file, file]);
    }
  }
  return { sources, duplicates };
}

function optionalObject(
  source: ThemeSource,
  key: 'palette' | 'tokens' | 'reduced',
): JsonObject {
  const value = source.json[key];
  if (value === undefined) {
    return {};
  }
  if (!isJsonObject(value)) {
    throw new ThemeError(source.file, `"${key}" must be a JSON object`);
  }
  return value;
}

// The theme's `extends`, or null for a root. Throws on a key a theme does not
// have, or on a key holding the wrong type.
function checkThemeShape(source: ThemeSource): string | null {
  const { json, file } = source;
  for (const key of Object.keys(json)) {
    if (!THEME_KEYS.has(key)) {
      throw new ThemeError(
        file,
        `unknown key "${key}"; a theme has only name, extends, colorScheme, palette, tokens and reduced`,
      );
    }
  }
  const base = json.extends;
  if (base !== undefined && typeof base !== 'string') {
    throw new ThemeError(file, '"extends" must be a string');
  }
  const isRoot = base === undefined;
  if (json.colorScheme === undefined && isRoot) {
    throw new ThemeError(
      file,
      '"colorScheme" is missing; a theme with no "extends" sets it',
    );
  }
  if (
    json.colorScheme !== undefined &&
    !COLOR_SCHEMES.has(json.colorScheme as string)
  ) {
    throw new ThemeError(file, '"colorScheme" must be "dark" or "light"');
  }
  if (json.tokens === undefined && isRoot) {
    throw new ThemeError(
      file,
      '"tokens" is missing; a theme with no "extends" sets every core token',
    );
  }
  for (const [colourName, colour] of Object.entries(
    optionalObject(source, 'palette'),
  )) {
    if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
      throw new ThemeError(
        file,
        `palette "${colourName}": ${JSON.stringify(colour)} is not a #rrggbb or #rrggbbaa colour`,
      );
    }
  }
  optionalObject(source, 'tokens');
  optionalObject(source, 'reduced');
  return isRoot ? null : base;
}

// The selected theme first and its root last. `extends` naming the theme's
// own name finds the built-in of that name; any other name finds a user theme
// first, then a built-in.
function extendsChain(
  name: string,
  builtIns: Map<string, ThemeSource>,
  users: ReturnType<typeof userSources>,
): ThemeSource[] {
  const findUserFirst = (wanted: string): ThemeSource | undefined => {
    const user = users.sources.get(wanted);
    const duplicate = users.duplicates.get(wanted);
    if (user !== undefined && duplicate !== undefined) {
      const [firstFile, secondFile] = duplicate;
      throw new ThemeError(
        secondFile,
        `two theme files are named "${wanted}": ${firstFile} and ${secondFile}`,
      );
    }
    return user ?? builtIns.get(wanted);
  };

  const selected = findUserFirst(name);
  if (selected === undefined) {
    throw new ThemeError(
      'settings.json',
      `"theme" names "${name}", which no theme has`,
    );
  }
  const chain = [selected];
  let current = selected;
  let base = checkThemeShape(current);
  while (base !== null) {
    const next =
      base === current.name ? builtIns.get(base) : findUserFirst(base);
    if (next === undefined) {
      throw new ThemeError(
        current.file,
        `"extends" names "${base}", which no theme has`,
      );
    }
    const seenAt = chain.indexOf(next);
    if (seenAt !== -1) {
      const loop = [...chain.slice(seenAt), next].map((theme) => theme.name);
      throw new ThemeError(
        current.file,
        `"extends" cycle: ${loop.join(' → ')}`,
      );
    }
    chain.push(next);
    current = next;
    base = checkThemeShape(current);
  }
  return chain;
}

function kindOf(token: string, registry: ThemeTokenRegistry): TokenKind | null {
  if (Object.hasOwn(registry.core, token)) {
    return registry.core[token];
  }
  if (Object.hasOwn(registry.plugins, token)) {
    return registry.plugins[token].kind;
  }
  return null;
}

function checkTokenEntries(
  entries: JsonObject,
  where: string,
  file: string,
  registry: ThemeTokenRegistry,
): void {
  for (const [token, value] of Object.entries(entries)) {
    const kind = kindOf(token, registry);
    if (kind === null) {
      throw new ThemeError(file, `unknown token "${token}"${where}`);
    }
    if (typeof value !== 'string') {
      throw new ThemeError(
        file,
        `token "${token}": ${JSON.stringify(value)} is not a ${kind} value`,
      );
    }
  }
}

function checkChainTokens(
  chain: readonly ThemeSource[],
  registry: ThemeTokenRegistry,
): void {
  for (const source of chain) {
    const tokens = optionalObject(source, 'tokens');
    checkTokenEntries(tokens, '', source.file, registry);
    checkTokenEntries(
      optionalObject(source, 'reduced'),
      ' in reduced',
      source.file,
      registry,
    );
  }
  const root = chain[chain.length - 1];
  const rootTokens = optionalObject(root, 'tokens');
  const missing = Object.keys(registry.core).find(
    (token) => !Object.hasOwn(rootTokens, token),
  );
  if (missing !== undefined) {
    throw new ThemeError(
      root.file,
      `token "${missing}" is missing; a theme with no "extends" sets every core token`,
    );
  }
}

// `key`'s entries from root to selected theme, each later one over the
// earlier, with the file that set each.
function mergeSet(
  chain: readonly ThemeSource[],
  key: 'tokens' | 'reduced',
): Map<string, SetValue> {
  const merged = new Map<string, SetValue>();
  for (const source of [...chain].reverse()) {
    for (const [token, value] of Object.entries(optionalObject(source, key))) {
      merged.set(token, { value, file: source.file });
    }
  }
  return merged;
}

function mergePalette(chain: readonly ThemeSource[]): Map<string, string> {
  const palette = new Map<string, string>();
  for (const source of [...chain].reverse()) {
    for (const [name, colour] of Object.entries(
      optionalObject(source, 'palette'),
    )) {
      palette.set(name, (colour as string).toLowerCase());
    }
  }
  return palette;
}

function nearestColorScheme(chain: readonly ThemeSource[]): ColorScheme {
  const setter = chain.find((source) => source.json.colorScheme !== undefined);
  // `checkThemeShape` requires the root to set it.
  return setter?.json.colorScheme as ColorScheme;
}

function hasBalancedParentheses(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function isCssText(value: string): boolean {
  const hasForbidden = /[;{}]/.test(value);
  return value.trim() !== '' && !hasForbidden && hasBalancedParentheses(value);
}

// `none`, or a run of `<name>(…)` functions; parentheses already balance.
function isFilterValue(value: string): boolean {
  let rest = value.trim();
  if (rest === 'none') {
    return true;
  }
  while (rest !== '') {
    const name = FILTER_FUNCTION_NAME.exec(rest);
    if (name === null) {
      return false;
    }
    let depth = 0;
    let end = name[0].length - 1;
    for (; end < rest.length; end++) {
      depth += rest[end] === '(' ? 1 : rest[end] === ')' ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    rest = rest.slice(end + 1).trimStart();
  }
  return true;
}

// Two lower-case hex digits for an alpha in [0, 1].
function alphaHex(alpha: number): string {
  return Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
}

// The colour's CSS text, or null when `value` is not a colour value.
function resolveColour(
  token: string,
  value: string,
  palette: Map<string, string>,
  file: string,
): string | null {
  const named = palette.get(value);
  if (named !== undefined) {
    return named;
  }
  if (HEX_COLOUR.test(value)) {
    return value.toLowerCase();
  }
  if (value === 'transparent' || WHOLE_ALIAS.test(value)) {
    return value;
  }
  const withAlpha = ALPHA_COLOUR.exec(value);
  const base = withAlpha === null ? undefined : palette.get(withAlpha[1]);
  if (withAlpha === null || base === undefined) {
    return null;
  }
  if (base.length !== 7) {
    throw new ThemeError(
      file,
      `token "${token}": palette "${withAlpha[1]}" already has an alpha`,
    );
  }
  return base + alphaHex(Number(withAlpha[2]));
}

function resolveValue(
  token: string,
  kind: TokenKind,
  set: SetValue,
  palette: Map<string, string>,
): string {
  const value = set.value as string;
  const resolved = resolveByKind(token, kind, value, palette, set.file);
  if (resolved === null) {
    throw new ThemeError(
      set.file,
      `token "${token}": ${JSON.stringify(value)} is not a ${kind} value`,
    );
  }
  return resolved;
}

function resolveByKind(
  token: string,
  kind: TokenKind,
  value: string,
  palette: Map<string, string>,
  file: string,
): string | null {
  switch (kind) {
    case 'color':
      return resolveColour(token, value, palette, file);
    case 'length':
      return LENGTH.test(value) ? value : null;
    case 'duration':
      return DURATION.test(value) ? value : null;
    case 'number':
      return NUMBER_VALUE.test(value) ? value : null;
    case 'filter':
      return isCssText(value) && isFilterValue(value) ? value : null;
    case 'shadow':
    case 'raw':
      return isCssText(value) ? value : null;
  }
}

// Each set value resolved by its token's kind.
function resolveSet(
  merged: Map<string, SetValue>,
  palette: Map<string, string>,
  registry: ThemeTokenRegistry,
): Map<string, SetValue & { value: string }> {
  const resolved = new Map<string, SetValue & { value: string }>();
  for (const [token, set] of merged) {
    const kind = kindOf(token, registry) as TokenKind;
    resolved.set(token, {
      value: resolveValue(token, kind, set, palette),
      file: set.file,
    });
  }
  return resolved;
}

// Every token by its CSS variable's name after `--wg-`.
function tokensByVariable(registry: ThemeTokenRegistry): Map<string, string> {
  const tokens = [
    ...Object.keys(registry.core),
    ...Object.keys(registry.plugins),
  ];
  return new Map(
    tokens.map((token) => [themeVariable(token).slice('--wg-'.length), token]),
  );
}

// The tokens `value` names through `var(--wg-…)`, in order. Throws on one that
// names no token, and on a colour that is a whole alias of another kind.
function referencedTokens(
  token: string,
  set: SetValue & { value: string },
  registry: ThemeTokenRegistry,
  byVariable: Map<string, string>,
): string[] {
  const referenced: string[] = [];
  for (const match of set.value.matchAll(ALIAS)) {
    const target = byVariable.get(match[1]);
    if (target === undefined) {
      throw new ThemeError(
        set.file,
        `token "${token}": ${match[0]} names no token`,
      );
    }
    referenced.push(target);
  }
  const isWholeAlias = WHOLE_ALIAS.test(set.value);
  const targetKind = isWholeAlias ? kindOf(referenced[0], registry) : null;
  const isColourAliasOfOtherKind =
    kindOf(token, registry) === 'color' &&
    targetKind !== null &&
    targetKind !== 'color';
  if (isColourAliasOfOtherKind) {
    throw new ThemeError(
      set.file,
      `token "${token}": ${set.value} is a ${targetKind} token, not a color token`,
    );
  }
  return referenced;
}

// The first alias cycle met walking `order`, as the tokens on it from where
// the walk entered it back to that token, or null when there is none.
function findAliasCycle(
  order: readonly string[],
  references: Map<string, string[]>,
): string[] | null {
  const done = new Set<string>();
  for (const start of order) {
    if (done.has(start)) {
      continue;
    }
    const path: string[] = [];
    const pending: { token: string; depth: number }[] = [
      { token: start, depth: 0 },
    ];
    while (pending.length > 0) {
      const { token, depth } = pending.pop() as {
        token: string;
        depth: number;
      };
      // Every token past `depth` on the path has had its whole walk.
      for (const finished of path.splice(depth)) {
        done.add(finished);
      }
      const onPath = path.indexOf(token);
      if (onPath !== -1) {
        return [...path.slice(onPath), token];
      }
      if (done.has(token)) {
        continue;
      }
      path.push(token);
      for (const target of [...(references.get(token) ?? [])].reverse()) {
        pending.push({ token: target, depth: depth + 1 });
      }
    }
    for (const finished of path) {
      done.add(finished);
    }
  }
  return null;
}

function checkReferences(
  values: Map<string, SetValue & { value: string }>,
  registry: ThemeTokenRegistry,
  byVariable: Map<string, string>,
  order: readonly string[],
  selectedFile: string,
): void {
  const references = new Map<string, string[]>();
  for (const [token, set] of values) {
    references.set(token, referencedTokens(token, set, registry, byVariable));
  }
  const cycle = findAliasCycle(order, references);
  if (cycle !== null) {
    throw new ThemeError(selectedFile, `alias cycle: ${cycle.join(' → ')}`);
  }
}

function checkWindowBackground(
  tokens: Map<string, SetValue & { value: string }>,
): void {
  const background = tokens.get(WINDOW_BACKGROUND);
  if (background !== undefined && !OPAQUE_HEX.test(background.value)) {
    throw new ThemeError(
      background.file,
      `token "${WINDOW_BACKGROUND}": must be an opaque #rrggbb colour or a palette name holding one, since the native window paints it`,
    );
  }
}

function plainValues(
  values: Map<string, SetValue & { value: string }>,
): Record<string, string> {
  return Object.fromEntries(
    [...values].map(([token, set]) => [token, set.value]),
  );
}

// The theme `name` names, its `extends` chain merged and every token resolved
// by its kind. `builtIns` are the built-in themes' parsed JSON; `userThemes`
// the user's theme files, which win over a built-in of the same name except
// for a theme extending its own name. Only the chain is checked, beyond a user
// file that does not parse or has no name. Throws `ThemeError` on any
// failure, naming the file that set the bad value.
export function resolveTheme(
  name: string,
  builtIns: readonly unknown[],
  userThemes: readonly ThemeFileText[],
  tokens: ThemeTokenRegistry,
): Theme {
  const builtInByName = builtInSources(builtIns);
  const users = userSources(userThemes);
  const chain = extendsChain(name, builtInByName, users);
  checkChainTokens(chain, tokens);

  const mergedTokens = mergeSet(chain, 'tokens');
  for (const [token, decl] of Object.entries(tokens.plugins)) {
    if (!mergedTokens.has(token)) {
      const pluginId = token.slice(0, token.indexOf('.'));
      mergedTokens.set(token, {
        value: decl.default,
        file: `plugin ${pluginId}`,
      });
    }
  }
  const palette = mergePalette(chain);
  const resolvedTokens = resolveSet(mergedTokens, palette, tokens);
  const resolvedReduced = resolveSet(
    mergeSet(chain, 'reduced'),
    palette,
    tokens,
  );

  const byVariable = tokensByVariable(tokens);
  const order = [...Object.keys(tokens.core), ...Object.keys(tokens.plugins)];
  const selectedFile = chain[0].file;
  checkReferences(resolvedTokens, tokens, byVariable, order, selectedFile);
  const tokensUnderReduced = new Map([...resolvedTokens, ...resolvedReduced]);
  checkReferences(tokensUnderReduced, tokens, byVariable, order, selectedFile);
  checkWindowBackground(resolvedTokens);
  checkWindowBackground(resolvedReduced);

  return {
    name: chain[0].name,
    colorScheme: nearestColorScheme(chain),
    tokens: plainValues(resolvedTokens),
    reduced: plainValues(resolvedReduced),
  };
}
