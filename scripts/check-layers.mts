// Fails when a source file (`.ts` or `.js`) imports across a layer boundary LAYERS does not allow.
// A file belongs to the layer with the longest matching path; imports inside a
// file's own layer are always allowed, and a `.test.ts` file may also import the
// test packages. An import is allowed when the imported file's own layer is
// listed exactly: allowing `src/shared` does not admit `src/shared/page`.
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
  'src/shared/page': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/declarations.d.ts': { layers: ['src/contracts'], packages: [] },
  'src/preload': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron'],
  },
  'src/main': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron', 'node:'],
  },
  'src/main/acp': {
    layers: ['src/contracts'],
    packages: ['@agentclientprotocol/sdk', 'node:'],
  },
  'src/main/themes': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['node:'],
  },
  'src/main/alerts': { layers: ['src/contracts'], packages: ['electron'] },
  'src/main/files': { layers: ['src/contracts'], packages: ['node:'] },
  'src/main/data-protocol': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron', 'node:'],
  },
  'src/main/plugins': { layers: ['src/contracts', 'src/shared'], packages: [] },
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
      'src/main/files',
      'src/main/data-protocol',
      'src/plugins/main.ts',
      'src/plugins/manifests.ts',
    ],
    packages: ['electron', 'electron-squirrel-startup', 'node:'],
  },
  'src/plugins': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/plugins/forms': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: [],
  },
  'src/plugins/forms/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms',
      'src/plugins/forms/layouts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: ['node:'],
  },
  'src/plugins/forms/layouts': { layers: [], packages: [] },
  'src/plugins/forms/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/plugins/forms',
      'src/plugins/forms/layouts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/keys': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/plugins/keys/contract.ts': {
    layers: ['src/contracts'],
    packages: [],
  },
  'src/plugins/keys/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/plugins/keys',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/sessions': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: [],
  },
  'src/plugins/sessions/contract.ts': {
    layers: ['src/contracts'],
    packages: [],
  },
  'src/plugins/sessions/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/sessions',
      'src/plugins/sessions/contract.ts',
      'src/plugins/sessions/main/relay',
      'src/plugins/sessions/main/mcp',
    ],
    packages: ['node:'],
  },
  'src/plugins/sessions/main/relay': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: ['node:'],
  },
  'src/plugins/sessions/main/mcp': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: ['@modelcontextprotocol/server', 'node:'],
  },
  'src/plugins/sessions/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/plugins/sessions',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms',
      'src/plugins/forms/main',
      'src/plugins/sessions',
      'src/plugins/sessions/main',
    ],
    packages: [],
  },
  'src/plugins/manifests.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms',
      'src/plugins/keys',
      'src/plugins/sessions',
    ],
    packages: [],
  },
  'src/plugins/page.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/plugins/forms',
      'src/plugins/forms/page',
      'src/plugins/keys',
      'src/plugins/keys/page',
      'src/plugins/sessions',
      'src/plugins/sessions/page',
    ],
    packages: [],
  },
  'src/renderer': {
    layers: ['src/contracts', 'src/shared', 'src/shared/page'],
    packages: [],
  },
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
      'src/plugins/page.ts',
      'src/plugins/manifests.ts',
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
  for (const { fileName } of imports.importedFiles) {
    // A Vite query (`./x.js?raw`) names the same file.
    const specifier = fileName.split('?')[0];
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
  .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
  .map((file) => path.join('src', file));
const violations = files.flatMap(importViolations);
for (const violation of violations) {
  console.error(violation);
}
if (violations.length > 0) {
  process.exit(1);
}
console.log(`layers: ${files.length} files clean`);
