// Fails when a source file (`.ts` or `.js`) imports across a layer boundary its
// rules do not allow. The rules are CORE_LAYERS, written here, and each plugin's
// entries, derived in `layer-rules.mts` from the plugin folders and each
// manifest's `dependsOn` and `reads`, with PLUGIN_EXTRAS added. A file belongs to
// the layer with the longest matching path, except that a plugin contract's
// `contract.test-support.ts` (fixtures of its records) belongs to that
// contract's layer; imports inside a file's own layer are always allowed, and a
// test file (`.test.ts`, a `.test-d.ts` type test or a `.test-support.ts` module
// of shared test cases) may also import the test packages. An import is allowed when the imported file's own layer is listed
// exactly: allowing `src/shared` does not admit `src/shared/page`. It also fails
// when `src/plugins/main.ts`, `page.ts` or `manifests.ts` misses a plugin
// folder's part or manifest, lists one twice, or lists anything else.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  compositionFailures,
  pluginLayers,
  readDependsOn,
  readReads,
  type LayerRule,
  type PluginExtra,
  type PluginFolder,
} from './layer-rules.mts';

const NODE_ONLY: Partial<LayerRule> = { packages: ['node:'] };

const LARGE_SUBLAYERS = ['src/plugins/workflow-large/stages'];

// Large's tests that run a stage rule through the engine's real fold.
const LARGE_FOLD_TEST_RULE: LayerRule = {
  layers: [
    'src/contracts',
    'src/shared',
    'src/plugins/workflow',
    'src/plugins/workflow/contract.ts',
    'src/plugins/workflow-large',
    'src/plugins/workflow-large/contract.ts',
    'src/plugins/workflow-large/stages',
    'src/plugins/chat/contract.ts',
    'src/plugins/workflow-large/main',
  ],
  packages: [],
};
const LARGE_FOLD_TESTS = [
  'large-state.test.ts',
  'main/actions.test.ts',
  'main/countdown.test.ts',
  'stages/main-stages.test.ts',
  'stages/page-stages.test.ts',
  'stages/reported-steps.test.ts',
  'stages/closed/main.test.ts',
  'stages/explore/main.test.ts',
  'stages/idle/main.test.ts',
  'stages/make/main.test.ts',
  'stages/plan-ready/main.test.ts',
  'stages/primer/main.test.ts',
  'stages/review/main.test.ts',
];

const PLUGIN_EXTRAS: Record<string, PluginExtra> = {
  'audio-picker': {
    // A picker is an agent form with a `node:crypto` fingerprint.
    main: { layers: ['src/shared/agent-forms'], packages: ['node:'] },
    sublayers: {
      // Starts the real sessions main, which refuses a tool name contributed twice.
      'src/plugins/audio-picker/main/start.test.ts': {
        layers: [
          'src/shared',
          'src/plugins/agent-form-fakes.test-support.ts',
          'src/plugins/audio-picker/main',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/main',
        ],
        packages: ['node:'],
      },
      // Starts the real sessions page, whose exports the picker files under.
      'src/plugins/audio-picker/page/start.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/page',
          'src/plugins/audio-picker/contract.ts',
          'src/plugins/audio-picker/page',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/page',
        ],
        packages: [],
      },
    },
  },
  // Its contract's records hold the follow-up file module's types.
  backlog: { contract: { layers: ['src/shared/followups'] } },
  chat: {
    // Its main joins paths with `node:path`.
    main: NODE_ONLY,
    sublayers: {
      // Checks that no default bind names a click's command.
      'src/plugins/chat/page/chat-commands.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/plugins/chat',
          'src/plugins/chat/contract.ts',
          'src/plugins/chat/page',
          'src/plugins/keymap.ts',
        ],
        packages: [],
      },
    },
  },
  // Its plugin status hashes files with `node:crypto`.
  docs: { main: NODE_ONLY },
  forms: {
    // Its contract imports NUMBER_KEY_COUNT from `./manifest`.
    contract: { layers: ['src/plugins/forms'] },
    // A round is an agent form with a `node:crypto` fingerprint.
    main: { layers: ['src/shared/agent-forms'], packages: ['node:'] },
    sublayers: {
      // Starts the real sessions main, which refuses a tool name contributed twice;
      // a real home folder holds what the stop rows open.
      'src/plugins/forms/main/start.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/plugins/agent-form-fakes.test-support.ts',
          'src/plugins/forms',
          'src/plugins/forms/main',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/main',
        ],
        packages: ['node:'],
      },
      // Starts the real sessions page, whose exports forms files under.
      'src/plugins/forms/page/start.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/page',
          'src/plugins/forms/contract.ts',
          'src/plugins/forms/page',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/page',
        ],
        packages: [],
      },
    },
  },
  // Its self-test script builds a PNG with `node:zlib`.
  notes: { main: NODE_ONLY },
  primer: {
    // A primer is an agent form with a `node:crypto` fingerprint.
    main: { layers: ['src/shared/agent-forms'], packages: ['node:'] },
    sublayers: {
      // Starts the real sessions main, which refuses a tool name contributed twice;
      // a real home folder holds what the stop rows open.
      'src/plugins/primer/main/start.test.ts': {
        layers: [
          'src/shared',
          'src/plugins/agent-form-fakes.test-support.ts',
          'src/plugins/primer/main',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/main',
        ],
        packages: ['node:'],
      },
      // Starts the real sessions page, whose exports primer files under.
      'src/plugins/primer/page/start.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/page',
          'src/plugins/primer/contract.ts',
          'src/plugins/primer/page',
          'src/plugins/sessions/contract.ts',
          'src/plugins/sessions/page',
        ],
        packages: [],
      },
    },
  },
  practice: {
    // Its contract names the problem types of `./problem`.
    contract: { layers: ['src/plugins/practice'] },
    sublayers: {
      // Compiles and runs generated drivers with the machine's clang++ through the real process and file adapters.
      'src/plugins/practice/main/judge.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/paths',
          'src/plugins/practice',
          'src/plugins/practice/contract.ts',
          'src/plugins/practice/main',
          'src/main/processes',
          'src/main/files',
        ],
        packages: ['node:'],
      },
      // Runs its host-id wait on the shared global timers under fake timers.
      'src/plugins/practice/main/practice-sessions.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/paths',
          'src/shared/agent-forms',
          'src/plugins/practice/contract.ts',
          'src/plugins/practice/main',
          'src/plugins/chat/contract.ts',
          'src/plugins/sessions/contract.ts',
        ],
        packages: [],
      },
    },
  },
  // Its relay's socket and its MCP adapter's SDK sit in sublayers of main; the
  // relay and its channel path use the shared local channel transport.
  sessions: {
    contract: { layers: ['src/shared'] },
    main: {
      layers: [
        'src/plugins/sessions/main/relay',
        'src/plugins/sessions/main/mcp',
        'src/shared/local-channel',
      ],
      packages: ['node:'],
    },
    sublayers: {
      'src/plugins/sessions/main/relay': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/shared/local-channel',
          'src/plugins/sessions/contract.ts',
        ],
        packages: ['node:'],
      },
      'src/plugins/sessions/main/mcp': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/plugins/sessions/contract.ts',
        ],
        packages: ['@modelcontextprotocol/server', 'node:'],
      },
    },
  },
  // Its contract names the layouts' types; main's agent signals use `node:path`.
  workflow: {
    contract: { layers: ['src/plugins/workflow/layouts'] },
    main: { packages: ['node:'] },
  },
  // Its root and parts share the stages; main uses `node:path`.
  'workflow-large': {
    root: { layers: LARGE_SUBLAYERS },
    contract: { layers: ['src/shared'] },
    main: { layers: LARGE_SUBLAYERS, packages: ['node:'] },
    page: { layers: LARGE_SUBLAYERS },
    sublayers: {
      'src/plugins/workflow-large/stages': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/plugins/workflow-large',
          'src/plugins/workflow-large/contract.ts',
          'src/plugins/workflow/contract.ts',
        ],
        packages: [],
      },
      ...Object.fromEntries(
        LARGE_FOLD_TESTS.map((file) => [
          `src/plugins/workflow-large/${file}`,
          LARGE_FOLD_TEST_RULE,
        ]),
      ),
      // Starts the real engine page part and Large's on it.
      'src/plugins/workflow-large/page/start.test.ts': {
        layers: [
          'src/contracts',
          'src/shared',
          'src/plugins/docs/contract.ts',
          'src/plugins/sessions/contract.ts',
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow/page',
          'src/plugins/workflow-large/contract.ts',
          'src/plugins/workflow-large/page',
        ],
        packages: [],
      },
      // Draws through the engine's layout types.
      'src/plugins/workflow-large/layouts/default/layout.test.ts': {
        layers: [
          'src/shared',
          'src/shared/page',
          'src/plugins/workflow-large/layouts',
          'src/plugins/workflow/layouts',
        ],
        packages: [],
      },
    },
  },
  'workflow-spike': {
    main: {
      layers: [
        'src/plugins/workflow-spike/stages',
        'src/plugins/workflow-spike/main/selftest-script.ts',
      ],
    },
    page: { layers: ['src/plugins/workflow-spike/stages'] },
    sublayers: {
      // Self-test support: Spike's script is built on the engine's level script.
      'src/plugins/workflow-spike/main/selftest-script.ts': {
        layers: ['src/contracts', 'src/plugins/workflow/main'],
        packages: [],
      },
      'src/plugins/workflow-spike/stages': {
        layers: [
          'src/contracts',
          'src/plugins/workflow-spike',
          'src/plugins/workflow-spike/contract.ts',
          'src/plugins/workflow/contract.ts',
        ],
        packages: [],
      },
      // Runs Spike's stage rules through the engine's real fold.
      'src/plugins/workflow-spike/stages/spike-stages.test.ts': {
        layers: [
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow-spike/contract.ts',
          'src/plugins/workflow-spike/stages',
        ],
        packages: [],
      },
      // Starts the real engine page part and Spike's on it.
      'src/plugins/workflow-spike/page/start.test.ts': {
        layers: [
          'src/shared',
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow/page',
          'src/plugins/workflow-spike',
          'src/plugins/workflow-spike/contract.ts',
          'src/plugins/workflow-spike/page',
          'src/plugins/workflow-spike/stages',
        ],
        packages: [],
      },
      // Draws with the engine's real kit.
      'src/plugins/workflow-spike/layouts/default/layout.test.ts': {
        layers: [
          'src/shared/page',
          'src/plugins/workflow-spike/layouts',
          'src/plugins/workflow/layouts',
          'src/plugins/workflow/page',
        ],
        packages: [],
      },
    },
  },
  'workflow-small': {
    main: {
      layers: [
        'src/plugins/workflow-small/stages',
        'src/plugins/workflow-small/main/selftest-script.ts',
      ],
    },
    page: { layers: ['src/plugins/workflow-small/stages'] },
    sublayers: {
      // Self-test support: Small's script is built on the engine's level script.
      'src/plugins/workflow-small/main/selftest-script.ts': {
        layers: ['src/contracts', 'src/plugins/workflow/main'],
        packages: [],
      },
      'src/plugins/workflow-small/stages': {
        layers: [
          'src/contracts',
          'src/plugins/workflow-small',
          'src/plugins/workflow-small/contract.ts',
          'src/plugins/workflow/contract.ts',
        ],
        packages: [],
      },
      // Runs Small's stage rules through the engine's real fold.
      'src/plugins/workflow-small/stages/small-stages.test.ts': {
        layers: [
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow-small/contract.ts',
          'src/plugins/workflow-small/stages',
        ],
        packages: [],
      },
      // Starts the real engine page part and Small's on it.
      'src/plugins/workflow-small/page/start.test.ts': {
        layers: [
          'src/shared',
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow/page',
          'src/plugins/workflow-small',
          'src/plugins/workflow-small/contract.ts',
          'src/plugins/workflow-small/page',
          'src/plugins/workflow-small/stages',
        ],
        packages: [],
      },
      // Draws with the engine's real kit.
      'src/plugins/workflow-small/layouts/default/layout.test.ts': {
        layers: [
          'src/shared/page',
          'src/plugins/workflow-small/layouts',
          'src/plugins/workflow/layouts',
          'src/plugins/workflow/page',
        ],
        packages: [],
      },
    },
  },
  'workflow-medium': {
    main: {
      layers: [
        'src/plugins/workflow-medium/stages',
        'src/plugins/workflow-medium/main/selftest-script.ts',
      ],
    },
    page: { layers: ['src/plugins/workflow-medium/stages'] },
    sublayers: {
      // Self-test support: Medium's script is built on the engine's level script.
      'src/plugins/workflow-medium/main/selftest-script.ts': {
        layers: ['src/contracts', 'src/plugins/workflow/main'],
        packages: [],
      },
      'src/plugins/workflow-medium/stages': {
        layers: [
          'src/contracts',
          'src/plugins/workflow-medium',
          'src/plugins/workflow-medium/contract.ts',
          'src/plugins/workflow/contract.ts',
        ],
        packages: [],
      },
      // Runs Medium's stage rules through the engine's real fold.
      'src/plugins/workflow-medium/stages/medium-stages.test.ts': {
        layers: [
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow-medium/contract.ts',
          'src/plugins/workflow-medium/stages',
        ],
        packages: [],
      },
      // Runs Medium's state rules through the engine's real fold.
      'src/plugins/workflow-medium/medium-state.test.ts': {
        layers: [
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow-medium',
          'src/plugins/workflow-medium/contract.ts',
          'src/plugins/workflow-medium/stages',
        ],
        packages: [],
      },
      // Starts the real engine page part and Medium's on it.
      'src/plugins/workflow-medium/page/start.test.ts': {
        layers: [
          'src/shared',
          'src/plugins/workflow',
          'src/plugins/workflow/contract.ts',
          'src/plugins/workflow/page',
          'src/plugins/workflow-medium',
          'src/plugins/workflow-medium/contract.ts',
          'src/plugins/workflow-medium/page',
          'src/plugins/workflow-medium/stages',
        ],
        packages: [],
      },
      // Draws with the engine's real kit.
      'src/plugins/workflow-medium/layouts/default/layout.test.ts': {
        layers: [
          'src/shared/page',
          'src/plugins/workflow-medium/layouts',
          'src/plugins/workflow/layouts',
          'src/plugins/workflow/page',
        ],
        packages: [],
      },
    },
  },
};

const CORE_LAYERS: Record<string, LayerRule> = {
  'src/contracts': { layers: [], packages: [] },
  'src/config': { layers: ['src/contracts'], packages: [] },
  'src/shared': { layers: ['src/contracts', 'src/shared/paths'], packages: [] },
  'src/shared/paths': { layers: ['src/contracts'], packages: [] },
  'src/shared/followups': { layers: ['src/shared'], packages: [] },
  // The local channel transport the relay and the session host share.
  'src/shared/local-channel': {
    layers: ['src/contracts'],
    packages: ['node:'],
  },
  // Open a real channel, named for the OS the tests run on.
  'src/shared/local-channel/local-channel.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'],
    packages: ['node:'],
  },
  'src/shared/local-channel/line-framing.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'],
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
  // The OS's own commands, through the ProcessRunner; no `node:` import.
  'src/main/system-stats': {
    layers: ['src/contracts', 'src/main/processes'],
    packages: [],
  },
  // Over the shared FakeProcesses.
  'src/main/system-stats/mac-system-stats.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/main/system-stats'],
    packages: [],
  },
  'src/main/system-stats/windows-system-stats.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/main/system-stats'],
    packages: [],
  },
  // Electron's capture sources and the OS's own commands, through the
  // ProcessRunner; no `node:` import.
  'src/main/screen-capture': {
    layers: ['src/contracts', 'src/main/processes'],
    packages: ['electron'],
  },
  // Over the shared FakeProcesses.
  'src/main/screen-capture/mac-window-list.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/main/screen-capture'],
    packages: [],
  },
  'src/main/screen-capture/windows-window-list.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/main/screen-capture'],
    packages: [],
  },
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
  // Pure: checks a user plugin's manifest with the shared plugin checks.
  'src/shared/plugin-catalog': {
    layers: ['src/contracts', 'src/shared'],
    packages: [],
  },
  // Loads user plugins from disk: reads, copies and imports their files.
  'src/main/plugin-catalog': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/shared/plugin-catalog',
    ],
    packages: ['node:'],
  },
  'src/main/plugins': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/shared/plugin-catalog',
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
      'src/main/system-stats',
      'src/main/screen-capture',
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
      'src/main/plugin-catalog',
      'src/shared/plugin-catalog',
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
  // Checks the order the built-in page parts start in.
  'src/plugins/page.test.ts': {
    layers: ['src/contracts', 'src/shared', 'src/plugins/page.ts'],
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
  // The chat and sessions fakes forms' and primer's main tests share.
  'src/plugins/agent-form-fakes.test-support.ts': {
    layers: [
      'src/shared',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
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
  // The real engine's main part and Large's on its exports.
  'src/plugins/workflow-large-main.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/paths',
      'src/plugins/chat/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/main',
      'src/plugins/workflow-large/contract.ts',
      'src/plugins/workflow-large/main',
      'src/plugins/workflow-large',
    ],
    packages: [],
  },
  // The real engine's page part and Large's on its exports.
  'src/plugins/workflow-large-page.test.ts': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/layout-host',
      'src/plugins/chat/contract.ts',
      'src/plugins/docs/contract.ts',
      'src/plugins/keys/contract.ts',
      'src/plugins/sessions/contract.ts',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/layouts',
      'src/plugins/workflow/page',
      'src/plugins/workflow-large/contract.ts',
      'src/plugins/workflow-large/layouts',
      'src/plugins/workflow-large/page',
    ],
    packages: [],
  },
  // The four level workflows' main rules through the engine's real fold, and
  // Small's, Medium's and Spike's main parts on the real engine.
  'src/plugins/workflow-levels.test.ts': {
    layers: [
      'src/shared',
      'src/plugins/workflow',
      'src/plugins/workflow/contract.ts',
      'src/plugins/workflow/main',
      'src/plugins/workflow-large',
      'src/plugins/workflow-large/contract.ts',
      'src/plugins/workflow-small/contract.ts',
      'src/plugins/workflow-small/main',
      'src/plugins/workflow-small/stages',
      'src/plugins/workflow-medium/contract.ts',
      'src/plugins/workflow-medium/main',
      'src/plugins/workflow-medium/stages',
      'src/plugins/workflow-spike/contract.ts',
      'src/plugins/workflow-spike/main',
      'src/plugins/workflow-spike/stages',
    ],
    packages: [],
  },
  'src/plugins': { layers: ['src/contracts', 'src/shared'], packages: [] },
  'src/renderer': {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/renderer/shell/layouts',
      'src/shared/page/file-drop',
      'src/shared/plugin-catalog',
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
  'src/renderer/fzf': {
    layers: ['src/contracts'],
    packages: ['fzf'],
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
      'src/renderer/fzf',
      'src/renderer/fabric',
      'src/renderer/visual-frames',
      'src/plugins/page.ts',
      'src/shared/page',
      'src/shared/page/ui',
      'src/shared/page/layout-host',
      'src/renderer/shell/layouts',
      'src/shared/plugin-catalog',
    ],
    packages: ['@fontsource/jetbrains-mono'],
  },
};

const TEST_PACKAGES = ['vitest'];
const TEST_FILE_SUFFIXES = ['.test.ts', '.test-d.ts', '.test-support.ts'];

type Layers = Record<string, LayerRule>;

const CONTRACT_SUPPORT = /\/contract\.test-support(\.ts)?$/;

function layerOf(file: string, layers: Layers): string | undefined {
  const contract = file.replace(CONTRACT_SUPPORT, '/contract.ts');
  if (contract !== file && contract in layers) {
    return contract;
  }
  return Object.keys(layers)
    .filter((layer) => file === layer || file.startsWith(`${layer}/`))
    .sort((a, b) => b.length - a.length)[0];
}

// An extensionless import of a single-file layer (a composition root) names that file.
function layerOfImport(target: string, layers: Layers): string | undefined {
  const asFile = `${target}.ts`;
  return layerOf(asFile in layers ? asFile : target, layers);
}

function allowsPackage(rule: LayerRule, specifier: string): boolean {
  return rule.packages.some((allowed) =>
    allowed.endsWith(':')
      ? specifier.startsWith(allowed)
      : specifier === allowed || specifier.startsWith(`${allowed}/`),
  );
}

function importViolations(file: string, layers: Layers): string[] {
  const layer = layerOf(file, layers);
  if (!layer) {
    return [`${file}: no layer covers this file`];
  }
  const rule = layers[layer];
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
    const targetLayer = layerOfImport(target, layers);
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

function printFailure(line: string): void {
  console.error(line);
  process.exitCode = 1;
}

function thrownText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPluginFolder(id: string): PluginFolder | undefined {
  const root = `src/plugins/${id}`;
  const manifest = `${root}/manifest.ts`;
  if (!existsSync(manifest)) {
    printFailure(`${root}: no manifest.ts`);
    return undefined;
  }
  try {
    const source = readFileSync(manifest, 'utf8');
    return {
      id,
      hasContract: existsSync(`${root}/contract.ts`),
      hasMain: existsSync(`${root}/main/start.ts`),
      hasPage: existsSync(`${root}/page/start.ts`),
      hasLayouts: existsSync(`${root}/layouts`),
      dependsOn: readDependsOn(manifest, source),
      reads: readReads(manifest, source),
    };
  } catch (error) {
    printFailure(thrownText(error));
    return undefined;
  }
}

// Undefined when a failure is already printed, which leaves no rules to check by.
function derivedPluginLayers(pluginIds: readonly string[]): Layers | undefined {
  const folders = pluginIds
    .map(readPluginFolder)
    .filter((folder) => folder !== undefined);
  if (folders.length < pluginIds.length) {
    return undefined;
  }
  try {
    return pluginLayers(folders, PLUGIN_EXTRAS);
  } catch (error) {
    printFailure(thrownText(error));
    return undefined;
  }
}

function startModules(pluginIds: readonly string[], part: string): string[] {
  return pluginIds
    .filter((id) => existsSync(`src/plugins/${id}/${part}/start.ts`))
    .map((id) => `./${id}/${part}/start`);
}

function checkCompositionRoots(pluginIds: readonly string[]): void {
  const roots = [
    {
      file: 'src/plugins/main.ts',
      arrayName: 'mainParts',
      expected: startModules(pluginIds, 'main'),
    },
    {
      file: 'src/plugins/page.ts',
      arrayName: 'pageParts',
      expected: startModules(pluginIds, 'page'),
    },
    {
      file: 'src/plugins/manifests.ts',
      arrayName: 'builtInManifests',
      expected: pluginIds.map((id) => `./${id}/manifest`),
    },
  ];
  for (const { file, arrayName, expected } of roots) {
    try {
      compositionFailures(
        file,
        readFileSync(file, 'utf8'),
        arrayName,
        expected,
      ).forEach(printFailure);
    } catch (error) {
      printFailure(thrownText(error));
    }
  }
}

function checkImports(layers: Layers): void {
  const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
    .map((file) => `src/${file.replaceAll(path.sep, '/')}`);
  files.flatMap((file) => importViolations(file, layers)).forEach(printFailure);
  if (process.exitCode === undefined) {
    console.log(`layers: ${files.length} files clean`);
  }
}

const pluginIds = readdirSync('src/plugins', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
checkCompositionRoots(pluginIds);
const pluginEntries = derivedPluginLayers(pluginIds);
if (pluginEntries) {
  checkImports({ ...CORE_LAYERS, ...pluginEntries });
}
