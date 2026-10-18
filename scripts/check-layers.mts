// Fails when a source file imports across a layer boundary LAYERS does not allow.
// A file belongs to the layer with the longest matching path; imports inside a
// file's own layer are always allowed.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface LayerRule {
  layers: string[];
  // A package name, or a prefix ending in `:` such as `node:`.
  packages: string[];
}

const LAYERS: Record<string, LayerRule> = {
  'src/contracts': { layers: [], packages: [] },
  'src/config': { layers: ['src/contracts'], packages: [] },
  'src/shared': { layers: ['src/contracts'], packages: [] },
  'src/declarations.d.ts': { layers: ['src/contracts'], packages: [] },
  'src/preload': { layers: ['src/contracts'], packages: ['electron'] },
  'src/main': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron', 'node:'],
  },
  'src/main/acp': {
    layers: ['src/contracts'],
    packages: ['@agentclientprotocol/sdk', 'node:'],
  },
  'src/main/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/config',
      'src/main',
      'src/main/acp',
    ],
    packages: ['electron', 'electron-squirrel-startup', 'node:'],
  },
  'src/renderer': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/renderer/codemirror-vim': {
    layers: ['src/contracts'],
    packages: ['codemirror', '@replit/codemirror-vim'],
  },
  'src/renderer/renderer.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/renderer',
      'src/renderer/codemirror-vim',
    ],
    packages: [],
  },
  'src/mock-agent': {
    layers: [],
    packages: ['@agentclientprotocol/sdk', 'node:'],
  },
};

const IMPORT_PATTERN = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function layerOf(file: string): string | undefined {
  return Object.keys(LAYERS)
    .filter((layer) => file === layer || file.startsWith(`${layer}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function allowsPackage(rule: LayerRule, specifier: string): boolean {
  return rule.packages.some((allowed) =>
    allowed.endsWith(':')
      ? specifier.startsWith(allowed)
      : specifier === allowed || specifier.startsWith(`${allowed}/`),
  );
}

function importViolations(file: string): string[] {
  const layer = layerOf(file);
  if (!layer) {
    return [`${file}: no layer in LAYERS covers this file`];
  }
  const rule = LAYERS[layer];
  const violations: string[] = [];
  for (const [, specifier] of readFileSync(file, 'utf8').matchAll(
    IMPORT_PATTERN,
  )) {
    if (!specifier.startsWith('.')) {
      if (!allowsPackage(rule, specifier)) {
        violations.push(`${file}: layer ${layer} may not import ${specifier}`);
      }
      continue;
    }
    const target = path.join(path.dirname(file), specifier);
    const targetLayer = layerOf(target);
    const isAllowed =
      targetLayer === layer ||
      (targetLayer !== undefined && rule.layers.includes(targetLayer));
    if (!isAllowed) {
      violations.push(
        `${file}: layer ${layer} may not import ${specifier} (layer ${targetLayer ?? 'none'})`,
      );
    }
  }
  return violations;
}

const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.join('src', file));
const violations = files.flatMap(importViolations);
for (const violation of violations) {
  console.error(violation);
}
if (violations.length > 0) {
  process.exit(1);
}
console.log(`layers: ${files.length} files clean`);
