// Fails when a source file (`.ts` or `.js`) imports across a layer boundary
// LAYERS does not allow. A file belongs to the layer with the longest matching
// path; imports inside a file's own layer are always allowed, and a test file
// (`.test.ts`, a `.test-d.ts` type test or a `.test-support.ts` module of
// shared test cases) may also import the test packages. An import is allowed when the
// imported file's own layer is listed exactly: allowing `src/shared` does not
// admit `src/shared/page`.
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
  'src/shared': { layers: ['src/contracts', 'src/shared/paths'], packages: [] },
  'src/shared/paths': { layers: ['src/contracts'], packages: [] },
  'src/shared/followups': { layers: [], packages: [] },
  // The local channel transport the relay and the session host share.
  'src/shared/local-channel': {
    layers: ['src/contracts'],
    packages: ['node:'],
  },
  'src/shared/agent-forms': {
    layers: ['src/contracts', 'src/shared', 'src/shared/paths'],
    packages: ['node:'],
  },
  'src/shared/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page/ui',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  // Type-checks every owner's layout contract with the TypeScript compiler.
  'src/shared/layouts/layout-contracts.test.ts': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['node:', 'typescript'],
  },
  'src/shared/page/file-drop': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  // Finds chips through the real POSIX and Windows path adapters.
  'src/shared/page/file-drop/file-chips.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/shared/page/layout-host': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
    ],
    packages: [],
  },
  'src/shared/page/ui': {
    layers: ['src/contracts', 'src/shared', 'src/shared/page'],
    packages: ['@vscode/codicons'],
  },
  'src/declarations.d.ts': { layers: ['src/contracts'], packages: [] },
  'src/preload': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron'],
  },
  'src/main': {
    layers: ['src/contracts', 'src/shared', 'src/main/drive'],
    packages: ['electron', 'node:'],
  },
  'src/main/claude-code': {
    layers: ['src/contracts', 'src/shared', 'src/shared/paths'],
    packages: ['node:'],
  },
  'src/main/themes': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/main/config': {
    layers: ['src/contracts', 'src/shared', 'src/main/themes'],
    packages: ['node:'],
  },
  'src/main/ui-state': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/main/alerts': { layers: ['src/contracts'], packages: ['electron'] },
  'src/main/images': { layers: ['src/contracts'], packages: ['electron'] },
  'src/main/files': { layers: ['src/contracts'], packages: ['node:'] },
  // Runs the Files contract suite, which the memory adapter runs too.
  'src/main/files/node-files.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/main/files'],
    packages: ['node:'],
  },
  'src/main/processes': { layers: ['src/contracts'], packages: ['node:'] },
  'src/main/git': { layers: ['src/contracts'], packages: ['node:'] },
  // Over the shared fakes, and a commit in a real temporary clone through the
  // real process runner.
  'src/main/git/process-git.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/main/git',
      'src/main/processes',
    ],
    packages: ['node:'],
  },
  'src/main/data-protocol': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['electron', 'node:'],
  },
  'src/main/layouts': {
    layers: ['src/contracts', 'src/shared', 'src/shared/paths'],
    packages: [],
  },
  'src/main/plugins': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/main/layouts',
    ],
    packages: [],
  },
  'src/main/drive': {
    layers: ['src/contracts', 'src/shared', 'src/shared/paths'],
    packages: ['node:'],
  },
  // The app's client of the session host, over the local channel.
  'src/main/session-host': {
    layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'],
    packages: ['node:'],
  },
  // The session host process: no electron import (`docs/features/session-host/design.md`).
  'src/session-host': {
    layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'],
    packages: ['node:'],
  },
  'src/main/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/config',
      'src/main',
      'src/main/claude-code',
      'src/main/plugins',
      'src/main/themes',
      'src/main/config',
      'src/main/ui-state',
      'src/main/alerts',
      'src/main/images',
      'src/main/files',
      'src/main/processes',
      'src/main/git',
      'src/main/data-protocol',
      'src/main/drive',
      // Starts the session host client.
      'src/main/session-host',
      'src/plugins/main.ts',
      'src/plugins/manifests.ts',
      'src/plugins/keymap.ts',
      'src/main/layouts',
      'src/shared/page/layout-host',
      'src/renderer/shell/layouts',
    ],
    packages: ['electron', 'node:'],
  },
  // Checks the shipped themes against the loader and the title bar overlay.
  'src/main/built-in-themes.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/config',
      'src/main',
      'src/main/themes',
      'src/plugins/manifests.ts',
    ],
    packages: [],
  },
  // The default keymap, checked against the built-in manifests' types.
  'src/plugins/keymap.ts': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/manifests.ts'],
    packages: [],
  },
  // Merges the default keymap with the built-in manifests.
  'src/plugins/keymap.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/manifests.ts',
      'src/plugins/keymap.ts',
    ],
    packages: [],
  },
  // Checks the built-in manifests' setting declarations, and that the default
  // disabled list breaks none of their dependencies.
  'src/plugins/manifests.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/config',
      'src/plugins/manifests.ts',
    ],
    packages: [],
  },
  // Opens a round and a primer on one owned session through the three
  // plugins' drive actions over the real session list.
  'src/plugins/agent-form-drive.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/forms/main',
      'src/plugins/primer/main',
      'src/plugins/sessions/contract.ts',
      'src/plugins/sessions/main',
    ],
    packages: [],
  },
  'src/plugins': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/plugins/agent-lines': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/agent-lines/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/agent-lines/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agent-lines',
      'src/plugins/agent-lines/layouts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agent-lines/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/plugins/agent-lines',
      'src/plugins/agent-lines/layouts',
      'src/plugins/agents/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agent-skills': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/agent-skills/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/agent-skills/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agent-skills',
      'src/plugins/agent-skills/layouts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agent-skills/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/plugins/agent-skills',
      'src/plugins/agent-skills/layouts',
      'src/plugins/agents/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agent-strip': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/agent-strip/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/agent-strip/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agent-strip',
      'src/plugins/agent-strip/layouts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agent-strip/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/plugins/agent-strip',
      'src/plugins/agent-strip/layouts',
      'src/plugins/agents/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agents': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/agents/contract.ts'],
    packages: [],
  },
  'src/plugins/agents/contract.ts': { layers: ['src/contracts'], packages: [] },
  'src/plugins/agents/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agents',
      'src/plugins/agents/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/agents/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agents',
      'src/plugins/agents/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/auto-compact': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/auto-compact/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/auto-compact',
      'src/plugins/chat/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/chat': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/chat/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/chat',
      'src/plugins/chat/contract.ts',
      'src/plugins/chat/layouts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: ['node:'],
  },
  'src/plugins/chat/contract.ts': { layers: ['src/contracts'], packages: [] },
  'src/plugins/chat/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/chat/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/chat',
      'src/plugins/chat/contract.ts',
      'src/plugins/chat/layouts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/docs': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/docs/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/docs/contract.ts': {
    layers: ['src/contracts'],
    packages: [],
  },
  'src/plugins/docs/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/docs',
      'src/plugins/docs/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/docs/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/docs/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/docs/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/docs',
      'src/plugins/docs/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/docs/layouts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/backlog': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/backlog/contract.ts'],
    packages: [],
  },
  'src/plugins/backlog/contract.ts': {
    layers: ['src/contracts', 'src/shared/followups'],
    packages: [],
  },
  'src/plugins/backlog/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/backlog',
      'src/plugins/backlog/contract.ts',
      'src/plugins/docs/contract.ts',
      'src/plugins/backlog/layouts',
    ],
    packages: [],
  },
  'src/plugins/backlog/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/backlog/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/backlog',
      'src/plugins/backlog/contract.ts',
      'src/plugins/docs/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/backlog/layouts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/notes': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/plugins/notes/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/notes/contract.ts': {
    layers: ['src/contracts', 'src/plugins/sessions/contract.ts'],
    packages: [],
  },
  'src/plugins/notes/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/notes',
      'src/plugins/notes/contract.ts',
      'src/plugins/backlog/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/notes/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/notes/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/notes/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/notes',
      'src/plugins/notes/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/notes/layouts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/workflow/plan-reader.ts': { layers: [], packages: [] },
  'src/plugins/workflow/contract.ts': {
    layers: ['src/contracts', 'src/plugins/workflow/plan-reader.ts'],
    packages: [],
  },
  'src/plugins/workflow': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/plan-reader.ts',
      'src/plugins/workflow/stages',
    ],
    packages: [],
  },
  'src/plugins/workflow/stages': {
    layers: [
      'src/contracts',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/plan-reader.ts',
    ],
    packages: [],
  },
  'src/plugins/workflow/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/plan-reader.ts',
      'src/plugins/workflow/stages',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/workflow/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/workflow/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/workflow/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/plan-reader.ts',
      'src/plugins/workflow/stages',
      'src/plugins/chat/contract.ts',
      'src/plugins/docs/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/workflow/layouts',
      'src/shared/page/layout-host',
    ],
    packages: [],
  },
  'src/plugins/usage': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/usage/contract.ts': { layers: ['src/contracts'], packages: [] },
  'src/plugins/usage/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/plugins/usage',
      'src/plugins/usage/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/usage/layouts',
    ],
    packages: [],
  },
  'src/plugins/usage/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/usage/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/plugins/usage',
      'src/plugins/usage/contract.ts',
      'src/plugins/usage/layouts',
      'src/plugins/chat/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/usage-tab-line': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/usage-tab-line/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/usage-tab-line',
      'src/plugins/usage/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/visual': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/visual/contract.ts': { layers: ['src/contracts'], packages: [] },
  'src/plugins/visual/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/visual',
      'src/plugins/visual/contract.ts',
      'src/plugins/chat/contract.ts',
      'src/plugins/visual/layouts',
    ],
    packages: [],
  },
  'src/plugins/visual/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/visual/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/plugins/visual',
      'src/plugins/visual/contract.ts',
      'src/plugins/visual/layouts',
      'src/plugins/keys/contract.ts',
      'src/plugins/chat/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/settings': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/plugins/settings/contract.ts',
    ],
    packages: [],
  },
  'src/plugins/settings/contract.ts': {
    layers: ['src/contracts'],
    packages: [],
  },
  'src/plugins/settings/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/plugins/settings',
      'src/plugins/settings/contract.ts',
      'src/plugins/settings/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/settings/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/settings/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/settings',
      'src/plugins/settings/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/settings/layouts',
      'src/shared/page/layout-host',
    ],
    packages: [],
  },
  'src/plugins/forms': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: [],
  },
  'src/plugins/forms/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/agent-forms',
      'src/shared/paths',
      'src/plugins/forms',
      'src/plugins/forms/layouts',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
    ],
    packages: ['node:'],
  },
  'src/plugins/forms/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/forms/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/forms',
      'src/plugins/forms/layouts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/primer': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/primer/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/paths',
      'src/shared/agent-forms',
      'src/plugins/primer',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/primer/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/primer/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/primer/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/primer',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/primer/layouts',
      'src/shared/page/layout-host',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/plugins/gallery': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  'src/plugins/gallery/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/gallery/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/gallery',
      'src/plugins/gallery/layouts',
    ],
    packages: [],
  },
  'src/plugins/gallery/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/gallery',
      'src/plugins/keys/contract.ts',
      'src/plugins/gallery/layouts',
      'src/shared/page/layout-host',
    ],
    packages: [],
  },
  'src/plugins/keys': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/plugins/keys/contract.ts': {
    layers: ['src/contracts'],
    packages: [],
  },
  'src/plugins/keys/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/keys/main': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/keys',
      'src/plugins/keys/layouts',
    ],
    packages: [],
  },
  'src/plugins/keys/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/keys',
      'src/plugins/keys/contract.ts',
      'src/plugins/keys/layouts',
      'src/shared/page/layout-host',
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
      'src/shared/followups',
      // The relay's channel path.
      'src/shared/local-channel',
      'src/plugins/sessions',
      'src/plugins/sessions/contract.ts',
      'src/plugins/sessions/main/relay',
      'src/plugins/sessions/main/mcp',
      'src/plugins/sessions/layouts',
    ],
    packages: ['node:'],
  },
  'src/plugins/sessions/main/relay': {
    layers: [
      'src/contracts',
      'src/shared',
      // The relay's channel transport.
      'src/shared/local-channel',
      'src/plugins/sessions/contract.ts',
    ],
    packages: ['node:'],
  },
  'src/plugins/sessions/main/mcp': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'],
    packages: ['@modelcontextprotocol/server', 'node:'],
  },
  'src/plugins/sessions/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/plugins/sessions/page': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/followups',
      'src/shared/page',
      'src/shared/page/ui',
      'src/plugins/sessions',
      'src/plugins/sessions/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/layouts',
      'src/shared/page/layout-host',
    ],
    packages: [],
  },
  'src/plugins/main.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agent-lines',
      'src/plugins/agent-lines/main',
      'src/plugins/agent-skills',
      'src/plugins/agent-skills/main',
      'src/plugins/agent-strip',
      'src/plugins/agent-strip/main',
      'src/plugins/agents',
      'src/plugins/agents/main',
      'src/plugins/auto-compact',
      'src/plugins/auto-compact/main',
      'src/plugins/backlog',
      'src/plugins/backlog/main',
      'src/plugins/chat',
      'src/plugins/chat/main',
      'src/plugins/docs',
      'src/plugins/docs/main',
      'src/plugins/forms',
      'src/plugins/forms/main',
      'src/plugins/notes',
      'src/plugins/notes/main',
      'src/plugins/primer',
      'src/plugins/primer/main',
      'src/plugins/sessions',
      'src/plugins/sessions/main',
      'src/plugins/settings',
      'src/plugins/settings/main',
      'src/plugins/gallery',
      'src/plugins/gallery/main',
      'src/plugins/keys',
      'src/plugins/keys/main',
      'src/plugins/usage',
      'src/plugins/usage/main',
      'src/plugins/visual',
      'src/plugins/visual/main',
      'src/plugins/workflow',
      'src/plugins/workflow/main',
    ],
    packages: [],
  },
  'src/plugins/manifests.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/plugins/agent-lines',
      'src/plugins/agent-skills',
      'src/plugins/agent-strip',
      'src/plugins/agents',
      'src/plugins/auto-compact',
      'src/plugins/backlog',
      'src/plugins/chat',
      'src/plugins/docs',
      'src/plugins/forms',
      'src/plugins/gallery',
      'src/plugins/keys',
      'src/plugins/notes',
      'src/plugins/primer',
      'src/plugins/sessions',
      'src/plugins/settings',
      'src/plugins/usage',
      'src/plugins/usage-tab-line',
      'src/plugins/visual',
      'src/plugins/workflow',
    ],
    packages: [],
  },
  'src/plugins/page.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/plugins/agent-lines',
      'src/plugins/agent-lines/page',
      'src/plugins/agent-skills',
      'src/plugins/agent-skills/page',
      'src/plugins/agent-strip',
      'src/plugins/agent-strip/page',
      'src/plugins/agents',
      'src/plugins/agents/page',
      'src/plugins/backlog',
      'src/plugins/backlog/page',
      'src/plugins/chat',
      'src/plugins/chat/page',
      'src/plugins/docs',
      'src/plugins/docs/page',
      'src/plugins/forms',
      'src/plugins/forms/page',
      'src/plugins/gallery',
      'src/plugins/gallery/page',
      'src/plugins/keys',
      'src/plugins/keys/page',
      'src/plugins/notes',
      'src/plugins/notes/page',
      'src/plugins/primer',
      'src/plugins/primer/page',
      'src/plugins/sessions',
      'src/plugins/sessions/page',
      'src/plugins/settings',
      'src/plugins/settings/page',
      'src/plugins/usage',
      'src/plugins/usage/page',
      'src/plugins/usage-tab-line',
      'src/plugins/usage-tab-line/page',
      'src/plugins/visual',
      'src/plugins/visual/page',
      'src/plugins/workflow',
      'src/plugins/workflow/page',
    ],
    packages: [],
  },
  'src/renderer': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/renderer/shell/layouts',
      'src/shared/page/file-drop',
    ],
    packages: [],
  },
  'src/renderer/shell/layouts': {
    layers: ['src/shared/page/layout-host'],
    packages: [],
  },
  'src/renderer/codemirror-vim': {
    layers: ['src/contracts', 'src/shared', 'src/shared/page/file-drop'],
    packages: [
      'codemirror',
      '@codemirror/lang-markdown',
      '@codemirror/language-data',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/highlight',
      '@replit/codemirror-vim',
      '@codemirror/autocomplete',
    ],
  },
  'src/renderer/markdown-it': {
    layers: ['src/contracts'],
    packages: ['markdown-it'],
  },
  'src/renderer/fabric': {
    layers: ['src/contracts', 'src/shared'],
    packages: ['fabric'],
  },
  'src/renderer/visual-frames': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  // Drives the frames over the shared page fake DOM.
  'src/renderer/visual-frames/visual-frames.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/renderer/visual-frames',
    ],
    packages: [],
  },
  'src/renderer/renderer.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/renderer',
      'src/renderer/codemirror-vim',
      'src/renderer/markdown-it',
      'src/renderer/fabric',
      'src/renderer/visual-frames',
      'src/plugins/page.ts',
      'src/plugins/manifests.ts',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/renderer/shell/layouts',
    ],
    packages: ['@fontsource/jetbrains-mono'],
  },
};

const TEST_PACKAGES = ['vitest'];
const TEST_FILE_SUFFIXES = ['.test.ts', '.test-d.ts', '.test-support.ts'];

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
  const isTestFile = TEST_FILE_SUFFIXES.some((suffix) => file.endsWith(suffix));
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
    const target = path.posix.join(path.posix.dirname(file), specifier);
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
  .map((file) => `src/${file.replaceAll(path.sep, '/')}`);
const violations = files.flatMap(importViolations);
for (const violation of violations) {
  console.error(violation);
}
if (violations.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`layers: ${files.length} files clean`);
}
