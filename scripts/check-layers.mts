// Fails when a source file imports across a layer boundary LAYERS does not allow.
// A file belongs to the layer with the longest matching path; imports inside a
// file's own layer are always allowed, and a `.test.ts` file may also import the
// test packages.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
  'src/main/themes': { layers: ['src/contracts'], packages: ['node:'] },
  'src/main/alerts': { layers: ['src/contracts'], packages: ['electron'] },
  'src/main/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/config',
      'src/main',
      'src/main/acp',
      'src/main/plugins',
      'src/main/themes',
      'src/main/alerts',
      'src/plugins/main.ts',
    ],
    packages: ['electron', 'electron-squirrel-startup', 'node:'],
  },
  'src/plugins': { layers: ['src/contracts', 'src/shared'], packages: [] },
  // Re-exports src/contracts' forms and relay contracts through contract.ts.
  'src/plugins/forms': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/forms/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms',
      'src/plugins/forms/main/mcp',
    ],
    packages: ['node:'],
  },
  'src/plugins/forms/main/mcp': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/forms'],
    packages: ['@modelcontextprotocol/server', 'node:'],
  },
  'src/plugins/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms',
      'src/plugins/forms/main',
      'src/plugins/forms/main/mcp',
    ],
    packages: [],
  },
  'src/renderer': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/renderer/codemirror-vim': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['codemirror', '@replit/codemirror-vim'],
  },
  'src/renderer/markdown-it': {
    layers: ['src/contracts'],
    packages: ['markdown-it'],
  },
  'src/renderer/renderer.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/renderer',
      'src/renderer/codemirror-vim',
      'src/renderer/markdown-it',
    ],
    packages: [],
  },
  'src/mock-agent': {
    layers: [],
    packages: ['@agentclientprotocol/sdk', 'node:'],
  },
};

const TEST_PACKAGES = ['vitest'];

function layerOf(file: string): string | undefined {
  return Object.keys(LAYERS)
    .filter((layer) => file === layer || file.startsWith(`${layer}/`))
    .sort((a, b) => b.length - a.length)[0];
}

// An extensionless import of a single-file layer (a composition root) names that file.
function layerOfImport(target: string): string | undefined {
  const asFile = `${target}.ts`;
  return layerOf(asFile in LAYERS ? asFile : target);
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
  const isTestFile = file.endsWith('.test.ts');
  const violations: string[] = [];
  const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  for (const { fileName: specifier } of imports.importedFiles) {
    if (!specifier.startsWith('.')) {
      const isTestPackage = isTestFile && TEST_PACKAGES.includes(specifier);
      if (!isTestPackage && !allowsPackage(rule, specifier)) {
        violations.push(`${file}: layer ${layer} may not import ${specifier}`);
      }
      continue;
    }
    const target = path.join(path.dirname(file), specifier);
    const targetLayer = layerOfImport(target);
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
