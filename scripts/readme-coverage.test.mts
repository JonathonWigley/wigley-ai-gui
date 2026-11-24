// The README is the app's setup guide and its one list of what the app ships
// (`AGENTS.md` § README, changelog and boundary): each name below appears in it
// in backticks, or a row fails naming the name and the README section it
// belongs in. Tool names come from a text scan of the tool definitions, since
// several tool modules import Electron and some names are module-private.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { settingInfo } from '../src/config/settings.ts';
import { builtInManifests } from '../src/plugins/manifests.ts';
import { pluginSettingInfo } from '../src/shared/plugin-manifests.ts';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGINS_DIR = path.join(APP_ROOT, 'src/plugins');
const AGENT_PLUGIN_DIR = path.join(APP_ROOT, 'agent-plugin');

const README = readFileSync(path.join(APP_ROOT, 'README.md'), 'utf8');

// The contributed tools at the last count; a scan that silently finds fewer
// fails here. Update it with the README's MCP tools table.
const TOOL_COUNT = 35;

function expectInReadme(name: string, section: string): void {
  expect(
    README.includes(`\`${name}\``),
    `README.md § ${section} lacks \`${name}\``,
  ).toBe(true);
}

const SNAKE_CASE = '[a-z][a-z0-9_]*';
const NAME_LITERAL = new RegExp(`^\\s*name: '(${SNAKE_CASE})',?$`, 'gm');
const NAME_IDENTIFIER = /^\s*name: ([A-Z][A-Z0-9_]*),?$/gm;
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;

function isSourceFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.test.ts') &&
    !file.endsWith('.test-d.ts') &&
    !file.endsWith('.test-support.ts')
  );
}

// The snake_case value of `const <identifier> = '…'` in `source`, or null.
function constantIn(source: string, identifier: string): string | null {
  const declared = new RegExp(
    `(?:^|\\s)const ${identifier} = '(${SNAKE_CASE})'`,
  ).exec(source);
  return declared === null ? null : declared[1];
}

// `identifier`'s value: a constant in `file`, or in the module `file` imports
// it from.
function resolveIdentifier(
  file: string,
  source: string,
  identifier: string,
): string | null {
  const local = constantIn(source, identifier);
  if (local !== null) {
    return local;
  }
  for (const [, names, specifier] of source.matchAll(NAMED_IMPORT)) {
    const imported = names
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .map((name) => name.split(/\s+as\s+/))
      .find((parts) => (parts[1] ?? parts[0]) === identifier);
    if (imported === undefined || !specifier.startsWith('.')) {
      continue;
    }
    const target = path.resolve(path.dirname(file), specifier);
    const targetFile = target.endsWith('.ts') ? target : `${target}.ts`;
    return constantIn(readFileSync(targetFile, 'utf8'), imported[0]);
  }
  return null;
}

// Every tool name the non-test `src/plugins` files holding a `ToolDefinition`
// define, and each `name:` identifier that resolved to no constant.
function scanToolNames(): { names: string[]; unresolved: string[] } {
  const files = readdirSync(PLUGINS_DIR, { recursive: true, encoding: 'utf8' })
    .filter(isSourceFile)
    .map((file) => path.join(PLUGINS_DIR, file));
  const names = new Set<string>();
  const unresolved: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('ToolDefinition')) {
      continue;
    }
    for (const [, name] of source.matchAll(NAME_LITERAL)) {
      names.add(name);
    }
    for (const [, identifier] of source.matchAll(NAME_IDENTIFIER)) {
      const name = resolveIdentifier(file, source, identifier);
      if (name === null) {
        unresolved.push(`${path.relative(APP_ROOT, file)}: ${identifier}`);
      } else {
        names.add(name);
      }
    }
  }
  return { names: [...names].sort(), unresolved };
}

const TOOLS = scanToolNames();

// Each leaf setting's qualified path, as Settings mode and `settings.json`
// name it: `work.signals.branch`, not `work.signals`.
const PLUGIN_SETTINGS = Object.keys(pluginSettingInfo(builtInManifests));

const SKILL_NAMES = readdirSync(path.join(AGENT_PLUGIN_DIR, 'skills'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => `auri:${entry.name}`);

interface HooksFile {
  hooks: Record<string, { hooks: { command: string }[] }[]>;
}

const HOOKS_FILE: HooksFile = JSON.parse(
  readFileSync(path.join(AGENT_PLUGIN_DIR, 'hooks/hooks.json'), 'utf8'),
);
const HOOK_EVENTS = Object.keys(HOOKS_FILE.hooks);
const HOOK_SCRIPT_FOLDERS = [
  ...new Set(
    Object.values(HOOKS_FILE.hooks)
      .flat()
      .flatMap((entry) => entry.hooks)
      .map(({ command }) => /scripts\/([^/]+)\//.exec(command)?.[1] ?? command)
      .map((folder) => `scripts/${folder}/`),
  ),
];

describe('README coverage', () => {
  it.each(builtInManifests.map((manifest) => manifest.id))(
    'names the built-in plugin %s',
    (id) => expectInReadme(id, 'Built-in plugins'),
  );

  it.each(PLUGIN_SETTINGS)('names the plugin setting %s', (settingPath) =>
    expectInReadme(settingPath, 'Settings'),
  );

  it.each(Object.keys(settingInfo))('names the core setting %s', (key) =>
    expectInReadme(key, 'Settings'),
  );

  it.each(TOOLS.names)('names the tool %s', (name) =>
    expectInReadme(name, 'MCP tools'),
  );

  it('resolves every tool name identifier', () => {
    expect(TOOLS.unresolved).toEqual([]);
  });

  it('finds every contributed tool', () => {
    expect(TOOLS.names).toHaveLength(TOOL_COUNT);
  });

  it.each(SKILL_NAMES)('names the skill %s', (name) =>
    expectInReadme(name, 'Skills'),
  );

  it.each(HOOK_EVENTS)('names the hook event %s', (event) =>
    expectInReadme(event, 'Hooks'),
  );

  it.each(HOOK_SCRIPT_FOLDERS)('names the hook script %s', (folder) =>
    expectInReadme(folder, 'Hooks'),
  );
});
