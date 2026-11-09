import type { Disposable } from '../contracts/disposable';
import { type Files, isMissingFile } from '../contracts/files';
import type { PageBind } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { Paths } from '../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../contracts/plugin';
import type { PluginCatalog, PluginOrigin } from '../contracts/plugin-catalog';

// The self-test's fixture user plugin, and the core script that loads,
// reloads, breaks, replaces a built-in with and removes user plugins through
// the user-folder source, as an outside editor's saves would.

export const SELFTEST_USER_ID = 'selftest-user';

// The built-in a user folder of the same id replaces in the script.
const GALLERY_ID = 'gallery';

// Relative to the self-test's temp home, as a step's `writeFile` takes it.
const PLUGINS_FOLDER = '.config/wigley-ai-gui/plugins';
const FIXTURE_FOLDER = `${PLUGINS_FOLDER}/${SELFTEST_USER_ID}`;
const GALLERY_FOLDER = `${PLUGINS_FOLDER}/${GALLERY_ID}`;

// The user-folder source reloads no plugin for a save under it.
const LAYOUTS_PREFIX = 'layouts/';

const MANIFEST_FILE = 'manifest.json';
const MAIN_FILE = 'main.js';
const PAGE_FILE = 'page.js';
const LAYOUT_FILE = 'layouts/default/layout.js';

const EMPTY_MANIFEST_FIELDS = {
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
};

const FIXTURE_MANIFEST = manifestText({
  $schema: '../_types/manifest.schema.json',
  id: SELFTEST_USER_ID,
  label: 'Self-test user plugin',
  description:
    'A user plugin the self-test loads, reloads, breaks and removes.',
  ...EMPTY_MANIFEST_FIELDS,
  commands: {
    hello: { label: 'say hello', group: 'selftest', runsIn: 'page' },
  },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

// Fails `validateManifest`: no label, description or other field.
const BAD_MANIFEST = `{"id": "${SELFTEST_USER_ID}"}`;

const GALLERY_MANIFEST = manifestText({
  $schema: '../_types/manifest.schema.json',
  id: GALLERY_ID,
  label: 'Gallery (user)',
  description: 'Replaces the built-in gallery in the self-test.',
  ...EMPTY_MANIFEST_FIELDS,
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const GALLERY_PAGE = `// @ts-check
/** @import { UserPageApi, UserPageStart } from '../_types/plugin' */

/**
 * @param {UserPageApi} api
 * @returns {UserPageStart}
 */
export function start(api) {
  api.services.log('replaced by a user plugin');
  return { commands: {} };
}
`;

function manifestText(manifest: object): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function mainText(version: string): string {
  return `// @ts-check
/** @import { UserMainApi, UserMainStart } from '../_types/plugin' */

// The layout contract main writes to the plugin's layouts folder.
const layoutTypes = [
  "import type { BaseKit } from '../kit';",
  '',
  'export interface Layout {',
  '  hello?(',
  '    parent: HTMLElement,',
  '    input: { text: string },',
  '    kit: BaseKit,',
  '  ): { element: HTMLElement };',
  '}',
  '',
].join('\\n');

/**
 * @param {UserMainApi} api
 * @returns {UserMainStart}
 */
export function start(api) {
  api.services.log('main started ${version}');
  api.layouts.register({ layoutTypes });
  return { commands: {} };
}
`;
}

// Draws its default layout's `hello` into a holder it never mounts, so no
// other script's screen changes, and again on each set of its layouts.
function pageText(version: string): string {
  return `// @ts-check
/** @import { UserPageApi, UserPageStart } from '../_types/plugin' */

/**
 * @param {UserPageApi} api
 * @returns {UserPageStart}
 */
export function start(api) {
  const log = api.services.log;
  log('page started ${version}');
  const holder = document.createElement('div');
  /** @type {{ dispose(): void } | null} */
  let drawn = null;
  const show = api.layouts.show({
    defaultLayout: {
      /**
       * @param {HTMLElement} parent
       * @param {{ text: string }} _input
       * @param {{ el(parent: HTMLElement, tag: string, className?: string, text?: string): HTMLElement }} kit
       */
      hello: (parent, _input, kit) => ({
        element: kit.el(parent, 'span', '', 'fallback'),
      }),
    },
    defaultStylesheet: null,
    read(module) {
      const layout = /** @type {{ default?: { hello?: unknown } }} */ (module)
        .default;
      if (typeof layout?.hello !== 'function') {
        throw new Error('layout has no hello');
      }
      return /** @type {any} */ (layout);
    },
    userLayout: () => 'default',
    setLayouts: () => redraw(),
  });
  function redraw() {
    drawn?.dispose();
    holder.replaceChildren();
    const part = show.draw('hello', holder, { text: 'v1' });
    drawn = part;
    log(\`layout \${part.layoutName} drew: \${part.built.element.textContent}\`);
  }
  redraw();
  return { commands: { hello: () => log('hello from ${version}') } };
}
`;
}

function layoutText(version: string): string {
  return `// @ts-check

// The fixture's own default look: it ignores \`input\`, so the text shows which
// saved version drew.
export default {
  /**
   * @param {HTMLElement} parent
   * @param {unknown} _input
   * @param {{ el(parent: HTMLElement, tag: string, className?: string, text?: string): HTMLElement }} kit
   */
  hello(parent, _input, kit) {
    return {
      element: kit.el(parent, 'span', 'selftest-user-hello', 'layout ${version}'),
    };
  },
};
`;
}

// The fixture's first version, by path in its folder.
const FIRST_VERSION: readonly (readonly [string, string])[] = [
  [MANIFEST_FILE, FIXTURE_MANIFEST],
  [MAIN_FILE, mainText('v1')],
  [PAGE_FILE, pageText('v1')],
  [LAYOUT_FILE, layoutText('v1')],
];

// Writes the fixture's first version (manifest.json, main.js, page.js,
// layouts/default/layout.js) into `<pluginsFolder>/selftest-user/`.
export async function seedSelfTestUserPlugin(deps: {
  files: Files;
  paths: Paths;
  pluginsFolder: string;
}): Promise<void> {
  const { files, paths, pluginsFolder } = deps;
  for (const [file, text] of FIRST_VERSION) {
    await files.write(
      paths.join(pluginsFolder, SELFTEST_USER_ID, ...file.split('/')),
      text,
    );
  }
}

export interface UserPluginSelfTestDeps {
  homeFiles: Files; // rooted at the temp home, as the runner's `homeFiles`
  catalog: Pick<PluginCatalog, 'entry' | 'reload' | 'onChanged'>;
  settled(): Promise<void>; // resolves once the plugin switch's queue holds no work
  log: Log;
}

// What the script checks once the fixture's folder went.
interface UserPluginResult {
  loadedAtStart: boolean;
  galleryOrigin: PluginOrigin | null;
  isStillHeld: boolean;
}

const HELLO_KEYS = [' ', 'z', 'u'];

// Exists only for the self-test; `applySelfTestConfig` drops it once the
// fixture is no longer loaded.
const PAGE_BINDS: PageBind[] = [
  {
    keys: HELLO_KEYS,
    scope: 'any',
    command: `${SELFTEST_USER_ID}.hello`,
  },
];

function fixtureFile(file: string, text: string) {
  return { path: `${FIXTURE_FOLDER}/${file}`, text };
}

const GROUPS: SelfTestGroup[] = [
  {
    name: 'load at start',
    why: 'The fixture in the config folder at start loaded, and its page command runs from a key.',
    steps: [
      {
        keys: HELLO_KEYS,
        expect: '[selftest-user] hello from v1',
        why: 'The page part loaded from wigley-plugin: started deferred and registered hello.',
      },
    ],
  },
  {
    name: 'reload on save',
    why: 'Saving main.js and page.js reloads each with the new code.',
    steps: [
      {
        writeFile: fixtureFile(MAIN_FILE, mainText('v2')),
        keys: [],
        expect: '[selftest-user] main started v2',
        why: 'A settled save reloads main from a new revision copy.',
      },
      {
        writeFile: fixtureFile(PAGE_FILE, pageText('v2')),
        keys: [],
        expect: '[selftest-user] page started v2',
      },
      {
        keys: HELLO_KEYS,
        expect: '[selftest-user] hello from v2',
        why: "The bind reaches the reloaded page part's handler.",
      },
    ],
  },
  {
    name: 'layout draws through its kit',
    why: "The plugin's own default layout draws through its layout kit, and a save of it redraws with no plugin reload.",
    steps: [
      {
        writeFile: fixtureFile(LAYOUT_FILE, layoutText('v2')),
        keys: [],
        expect: '[selftest-user] layout default drew: layout v2',
        why: "A save of the user's default layout reloads it alone, and the page part draws it with its base kit.",
      },
    ],
  },
  {
    name: 'bad manifest',
    why: 'A manifest that fails its checks shows a config problem and keeps the last good version running, and a good save loads again.',
    steps: [
      {
        writeFile: fixtureFile(MANIFEST_FILE, BAD_MANIFEST),
        keys: [],
        expect: '[config] applied a new config',
        alsoExpect: [/^\[config\] plugins\/selftest-user: /],
      },
      {
        keys: HELLO_KEYS,
        expect: '[selftest-user] hello from v2',
        why: 'The failed load kept the last good version running.',
      },
      {
        writeFile: fixtureFile(MANIFEST_FILE, FIXTURE_MANIFEST),
        keys: [],
        expect: '[selftest-user] main started v2',
        why: "A good save loads again, with v2's main.js still on disk.",
      },
    ],
  },
  {
    name: 'replace a built-in',
    why: "A user plugin with gallery's id replaces the built-in, and the built-in comes back when its folder goes.",
    steps: [
      {
        writeFile: {
          path: `${GALLERY_FOLDER}/${PAGE_FILE}`,
          text: GALLERY_PAGE,
        },
        keys: HELLO_KEYS,
        expect: '[selftest-user] hello from v2',
        why: "A save in another plugin's folder leaves the fixture running.",
      },
      {
        writeFile: {
          path: `${GALLERY_FOLDER}/${MANIFEST_FILE}`,
          text: GALLERY_MANIFEST,
        },
        keys: [],
        expect: '[gallery] replaced by a user plugin',
        why: "The user plugin with the built-in's id starts in its place.",
      },
      {
        remove: GALLERY_FOLDER,
        keys: [],
        expect: '[plugin-switch] reloaded gallery',
        why: 'The built-in comes back, and its parts run again; the result checks its origin.',
      },
    ],
  },
  {
    name: 'delete',
    why: "Deleting the fixture's folder takes it out of the catalog.",
    steps: [
      {
        remove: FIXTURE_FOLDER,
        keys: [],
        expect: '[plugin-switch] removed selftest-user',
        why: "The folder going stops the plugin's parts and takes it out; the result checks the catalog.",
      },
    ],
  },
];

// The first catalog change, from the call on, that adds or reloads the
// fixture; `dispose` stops listening for it.
function fixtureLoaded(
  catalog: UserPluginSelfTestDeps['catalog'],
): Disposable & { loaded: Promise<void> } {
  let listening: Disposable | null = null;
  const loaded = new Promise<void>((resolve) => {
    listening = catalog.onChanged((change) => {
      const isFixture =
        change.added.includes(SELFTEST_USER_ID) ||
        change.reloaded.includes(SELFTEST_USER_ID);
      if (isFixture) {
        listening?.dispose();
        resolve();
      }
    });
  });
  return { loaded, dispose: () => listening?.dispose() };
}

// Writes each first-version file that is missing or differs on disk; returns
// the paths written, relative to the fixture's folder.
async function writeChangedFiles(homeFiles: Files): Promise<string[]> {
  const written: string[] = [];
  for (const [file, text] of FIRST_VERSION) {
    const path = `${FIXTURE_FOLDER}/${file}`;
    if ((await readOrNull(homeFiles, path)) !== text) {
      await homeFiles.write(path, text);
      written.push(file);
    }
  }
  return written;
}

async function readOrNull(files: Files, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

// Puts the fixture's first version back, gallery's user folder gone, with
// exactly one load of the fixture after it: the watcher's, when a file
// outside `layouts/` was written, else a `catalog.reload`. Logs the ready
// line once the switch has started the reloaded parts.
async function putBackFirstVersion(
  deps: UserPluginSelfTestDeps,
  run: number,
): Promise<void> {
  const { homeFiles, catalog, settled, log } = deps;
  await settled();
  if ((await homeFiles.stat(GALLERY_FOLDER)) !== null) {
    await homeFiles.trash(GALLERY_FOLDER);
  }
  const watcherLoad = fixtureLoaded(catalog);
  const written = await writeChangedFiles(homeFiles);
  const isWatcherLoading = written.some(
    (file) => !file.startsWith(LAYOUTS_PREFIX),
  );
  if (isWatcherLoading) {
    await watcherLoad.loaded;
  } else {
    watcherLoad.dispose();
    await catalog.reload(SELFTEST_USER_ID);
  }
  await settled();
  log(SELFTEST_USER_ID, `fixture ready for run ${run}`);
}

function resultProblems(result: UserPluginResult): string[] {
  const problems: string[] = [];
  if (!result.loadedAtStart) {
    problems.push(`${SELFTEST_USER_ID} was not loaded at start`);
  }
  if (result.galleryOrigin !== 'built-in') {
    problems.push(
      `${GALLERY_ID} is ${result.galleryOrigin ?? 'none'} after its user folder went, not built-in`,
    );
  }
  if (result.isStillHeld) {
    problems.push(
      `${SELFTEST_USER_ID} is still in the catalog after its folder went`,
    );
  }
  return problems;
}

// The core script over the fixture, handed over under `SELFTEST_USER_ID`.
// Reads whether the catalog loaded the fixture at start when called, during
// the handover. `open` puts the first version back (`putBackFirstVersion`)
// and shows once its ready line is logged; the result settles on the first
// change after it that removes the fixture, and rejects when putting it back
// fails.
export function userPluginSelfTestScript(
  deps: UserPluginSelfTestDeps,
): SelfTestScript {
  const { catalog } = deps;
  const atStart = catalog.entry(SELFTEST_USER_ID);
  const loadedAtStart = atStart?.origin === 'user' && atStart.revision === 1;
  let watching: Disposable | null = null;
  return {
    pageBinds: PAGE_BINDS,
    settings: {},
    scrollsItself: [],
    open(run) {
      watching?.dispose();
      const result = new Promise<UserPluginResult>((resolve, reject) => {
        const watch = catalog.onChanged((change) => {
          if (!change.removed.includes(SELFTEST_USER_ID)) {
            return;
          }
          watch.dispose();
          if (watching === watch) {
            watching = null;
          }
          resolve({
            loadedAtStart,
            galleryOrigin: catalog.entry(GALLERY_ID)?.origin ?? null,
            isStillHeld: catalog.entry(SELFTEST_USER_ID) !== undefined,
          });
        });
        watching = watch;
        putBackFirstVersion(deps, run).catch(reject);
      });
      return {
        shownLine: `[${SELFTEST_USER_ID}] fixture ready for run ${run}`,
        result,
      };
    },
    groups: GROUPS,
    problems: (result) => resultProblems(result as UserPluginResult),
  };
}
