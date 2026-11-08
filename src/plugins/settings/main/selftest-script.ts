import type { Disposable } from '../../../contracts/disposable';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import type {
  UserConfig,
  UserConfigRead,
} from '../../../contracts/user-config';
import { emptyUserFiles } from '../../../shared/empty-user-files';

export interface SettingsSelfTestDeps {
  userConfig: Pick<
    UserConfig,
    'read' | 'onChanged' | 'writeSettings' | 'writeKeymap'
  >;
  // What `settings.show` runs: brings the window forward and shows the mode.
  show(): void;
}

// Relative to the self-test's temp home, as `writeFile` takes it.
const SETTINGS_FILE = '.config/wigley-ai-gui/settings.json';

// A key no default binds, added to the help command and removed again.
const ADDED_KEYS = '<Leader>zh';

// The key sequence timeout written on disk under the open box; it stays in
// settings.json until the timeout reset group resets it.
const STALE_TIMEOUT_MS = 900;

// Settings mode opens on the first section, Core, with focus on the side bar.
const SIDE_BAR_STEPS: SelfTestStep[] = [
  { keys: [' ', 'k', ','], expect: '[page] side bar hidden' },
  { keys: [' ', 'k', ','], expect: '[page] side bar shown' },
  {
    keys: ['<A-h>'],
    expect: '[settings] sections focused',
    why: "Option+h at the rows' left edge reaches the side bar through the mode's focusSideBar.",
  },
  { keys: ['<A-l>'], expect: '[settings] rows focused' },
  { keys: ['<A-h>', 'G', 'l'], expect: '[settings] section keymap' },
  {
    keys: ['g', 'g', 'Enter'],
    expect: '[settings] section core',
    alsoExpect: [/^\[settings\] rows focused$/],
    why: 'l kept focus in the sections, so G and gg moved the sections cursor; Enter opens Core and focuses its rows.',
  },
  { keys: [' ', 'k', ','], expect: '[page] side bar hidden' },
  {
    keys: ['<A-h>'],
    expect: '[page] no pane left',
    why: 'A hidden side bar is no stop.',
  },
  { keys: [' ', 'k', ','], expect: '[page] side bar shown' },
];

const NUMBER_BOX_STEPS: SelfTestStep[] = [
  {
    keys: ['/', ...'sequence', 'Enter'],
    expect: '[settings] filter "sequence" first row keySequenceTimeoutMs',
    checksFit: true,
    screenshot: 'core-filtered',
  },
  { keys: ['Enter'], expect: '[settings] box open keySequenceTimeoutMs' },
  { keys: [...'750', 'Enter'], expect: '[settings] wrote settings.json' },
  { keys: ['Enter'], expect: '[settings] box open keySequenceTimeoutMs' },
  {
    keys: [...'abc', 'Enter'],
    expect: '[settings] box problem keySequenceTimeoutMs: Enter a number',
    screenshot: 'box-problem',
  },
  { keys: ['Escape'], expect: '[settings] box closed keySequenceTimeoutMs' },
];

const OUTSIDE_EDITS_STEPS: SelfTestStep[] = [
  {
    writeFile: { path: SETTINGS_FILE, text: '{"keySequenceTimeoutMs": 800}' },
    keys: [],
    expect: '[settings] redrawn',
  },
  { keys: ['r'], expect: '[settings] wrote settings.json' },
  { keys: ['Enter'], expect: '[settings] box open keySequenceTimeoutMs' },
  {
    writeFile: { path: SETTINGS_FILE, text: '{"nope": 1}' },
    keys: [],
    expect: '[settings] box closed keySequenceTimeoutMs',
    screenshot: 'broken',
    why: 'A key the settings do not declare breaks settings.json, which closes the open box.',
  },
  {
    writeFile: { path: SETTINGS_FILE, text: '{}' },
    keys: [],
    expect: '[settings] redrawn',
  },
  { keys: ['Enter'], expect: '[settings] box open keySequenceTimeoutMs' },
  {
    writeFile: {
      path: SETTINGS_FILE,
      text: JSON.stringify({ keySequenceTimeoutMs: STALE_TIMEOUT_MS }),
    },
    keys: [...'600', 'Enter'],
    expect: '[settings] changed on disk settings.json',
    why: "The timeout written on disk under the open box makes the box's 600 stale.",
  },
  { keys: ['Escape'], expect: '[settings] box closed keySequenceTimeoutMs' },
];

const THEME_PICKER_STEPS: SelfTestStep[] = [
  {
    keys: ['/', ...'theme', 'Enter'],
    expect: '[settings] filter "theme" first row theme',
  },
  { keys: ['Enter'], expect: '[settings] picker shown: Theme' },
];

const KEYMAP_STEPS: SelfTestStep[] = [
  {
    keys: ['Escape', '<A-h>', 'G', 'Enter'],
    expect: '[settings] section keymap',
    checksFit: true,
    screenshot: 'keymap',
  },
  {
    keys: ['/', ...'togglehelp', 'Enter'],
    expect: '[settings] filter "togglehelp" first row keys.toggleHelp',
  },
  { keys: ['a'], expect: '[settings] box open keys.toggleHelp' },
  {
    keys: [...ADDED_KEYS, 'Enter'],
    expect: '[settings] picker shown: Scope',
  },
  {
    keys: ['Enter'],
    expect: '[config] applied a new config',
    why: 'Enter picks the preselected scope, writing keymap.json. The step waits for the apply that follows the write, since the page keys it rebuilds drop a pending key sequence.',
  },
  { keys: ['d'], expect: '[settings] picker shown: Key to remove' },
  {
    keys: ['j', 'Enter'],
    expect: '[config] applied a new config',
    why: 'The user bind is listed last, and removing it writes keymap.json. The step waits for the apply that follows the write, since the page keys it rebuilds drop a pending key sequence.',
  },
  { keys: ['r'], expect: '[settings] unchanged' },
];

const TIMEOUT_RESET_STEPS: SelfTestStep[] = [
  { keys: ['<A-h>', 'g', 'g', 'Enter'], expect: '[settings] section core' },
  {
    keys: ['/', ...'sequence', 'Enter', 'r'],
    expect: '[settings] wrote settings.json',
  },
];

const DISABLED_PLUGINS_STEPS: SelfTestStep[] = [
  {
    keys: ['/', ...'disabled', 'Enter'],
    expect: '[settings] filter "disabled" first row plugins.disabled',
  },
];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'side bar',
    why: 'Space k , hides the side bar, focusing the rows, and shows it again; Option+h and Option+l move between the rows and the sections, Enter on a section opens it and focuses the rows, l opens it keeping focus, and with the side bar hidden Option+h stays put.',
    steps: SIDE_BAR_STEPS,
  },
  {
    name: 'number box',
    why: 'Filtering Core to the key sequence timeout, its box writes a number to settings.json, refuses text that is not a number under the box, and Esc closes it.',
    steps: NUMBER_BOX_STEPS,
  },
  {
    name: 'outside edits',
    why: 'settings.json written on disk redraws the rows, breaking it closes the open box and mending it redraws them, and a write under the open box makes its value stale; r resets a row.',
    steps: OUTSIDE_EDITS_STEPS,
  },
  {
    name: 'theme picker',
    why: 'Filtering Core to the Theme row, Enter shows the theme picker.',
    steps: THEME_PICKER_STEPS,
  },
  {
    name: 'keymap',
    why: 'In the Keymap section, a adds a key to the help command under a picked scope and d removes the user bind, each writing keymap.json, and r then finds nothing to reset.',
    steps: KEYMAP_STEPS,
  },
  {
    name: 'timeout reset',
    why: 'Back in Core, r on the key sequence timeout clears the stale timeout from settings.json.',
    steps: TIMEOUT_RESET_STEPS,
  },
  {
    name: 'disabled plugins',
    why: 'Filtering Core on disabled finds the plugins.disabled row.',
    steps: DISABLED_PLUGINS_STEPS,
  },
];

function isEmptyLayer(layer: unknown): boolean {
  return JSON.stringify(layer) === '{}';
}

// Whether settings.json holds the timeout written on disk under the box.
function holdsStaleTimeout(read: UserConfigRead): boolean {
  return (
    read.settings.state === 'ok' &&
    read.settings.layer?.keySequenceTimeoutMs === STALE_TIMEOUT_MS
  );
}

function resultProblems(read: UserConfigRead): string[] {
  const problems: string[] = [];
  const { settings, keymap } = read;
  if (settings.state === 'broken') {
    problems.push(`settings.json broken: ${settings.problem}`);
  } else if (!isEmptyLayer(settings.layer)) {
    problems.push(`settings.json held ${JSON.stringify(settings.layer)}`);
  }
  if (keymap.state === 'broken') {
    problems.push(`keymap.json broken: ${keymap.problem}`);
  } else if (!isEmptyLayer(keymap.layer)) {
    problems.push(`keymap.json held ${JSON.stringify(keymap.layer)}`);
  }
  return problems;
}

// `open` empties both user files, then shows Settings mode as
// `settings.show` does. The result is the user config read on the first
// change after which settings.json no longer holds the stale timeout that
// follows one where it did: only the timeout reset group's last step, the
// last step that writes, changes it, and `problems` expects both layers empty
// then. It rejects when this open's emptying fails.
// An open superseded by a later one before its files are emptied shows
// nothing, and its result settles only by rejecting, when its own emptying
// fails.
export function settingsSelfTestScript(
  deps: SettingsSelfTestDeps,
): SelfTestScript {
  const { userConfig } = deps;
  let watching: Disposable | null = null;
  let latestOpen = 0;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.settings-sheet'],
    open() {
      const thisOpen = ++latestOpen;
      watching?.dispose();
      let hasSeenStaleTimeout = false;
      const result = new Promise<UserConfigRead>((resolve, reject) => {
        const watch = userConfig.onChanged(() => {
          userConfig.read().then((read) => {
            if (watching !== watch) {
              return;
            }
            const holdsStale = holdsStaleTimeout(read);
            hasSeenStaleTimeout ||= holdsStale;
            if (hasSeenStaleTimeout && !holdsStale) {
              watch.dispose();
              watching = null;
              resolve(read);
            }
          }, reject);
        });
        watching = watch;
        emptyUserFiles(userConfig).then(() => {
          if (thisOpen === latestOpen) {
            deps.show();
          }
        }, reject);
      });
      return { shownLine: '[settings] shown', result };
    },
    groups: GROUPS,
    problems: (result) => resultProblems(result as UserConfigRead),
  };
}
