import type { Disposable } from '../../../contracts/disposable';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type {
  UserConfig,
  UserConfigRead,
} from '../../../contracts/user-config';

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

// Open empties both user files, then settings mode shows on the first
// section, Core, with focus on the side bar. Space k , hides the side bar,
// focusing the rows, and again shows it. / and sequence filter Core to the key
// sequence timeout first; Enter opens its box and 750 writes it. Enter again,
// abc is refused under the box, and Esc closes it. 800 written on disk redraws
// the rows, and r resets the row. Enter opens the box again, and a key the
// settings do not declare breaks settings.json and closes it; {} mends the
// file. Enter opens the box, 900 written on disk makes the box's 600 stale,
// and Esc closes it. / and theme filter Core to the Theme row first, whose
// Enter shows the theme picker. Esc, Option+h, G and Enter open Keymap; / and
// help filter it to the help command first, where a and <Leader>zh open the
// scope picker, and Enter picks the preselected scope. d picks the user bind,
// listed last, to remove; r then finds nothing to reset. Option+h, gg and
// Enter open Core, where / and sequence filter to the timeout again and r
// clears the 900.
const STEPS: SelfTestStep[] = [
  { keys: [' ', 'k', ','], expect: '[page] side bar hidden' },
  { keys: [' ', 'k', ','], expect: '[page] side bar shown' },
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
  },
  {
    writeFile: { path: SETTINGS_FILE, text: '{}' },
    keys: [],
    expect: '[settings] redrawn',
  },
  { keys: ['Enter'], expect: '[settings] box open keySequenceTimeoutMs' },
  {
    writeFile: { path: SETTINGS_FILE, text: '{"keySequenceTimeoutMs": 900}' },
    keys: [...'600', 'Enter'],
    expect: '[settings] changed on disk settings.json',
  },
  { keys: ['Escape'], expect: '[settings] box closed keySequenceTimeoutMs' },
  {
    keys: ['/', ...'theme', 'Enter'],
    expect: '[settings] filter "theme" first row theme',
  },
  { keys: ['Enter'], expect: '[settings] picker shown: Theme' },
  {
    keys: ['Escape', '<A-h>', 'G', 'Enter'],
    expect: '[settings] section keymap',
    checksFit: true,
    screenshot: 'keymap',
  },
  {
    keys: ['/', ...'help', 'Enter'],
    expect: '[settings] filter "help" first row keys.toggleHelp',
  },
  { keys: ['a'], expect: '[settings] box open keys.toggleHelp' },
  {
    keys: [...ADDED_KEYS, 'Enter'],
    expect: '[settings] picker shown: Scope',
  },
  { keys: ['Enter'], expect: '[settings] wrote keymap.json' },
  { keys: ['d'], expect: '[settings] picker shown: Key to remove' },
  { keys: ['j', 'Enter'], expect: '[settings] wrote keymap.json' },
  { keys: ['r'], expect: '[settings] unchanged' },
  { keys: ['<A-h>', 'g', 'g', 'Enter'], expect: '[settings] section core' },
  {
    keys: ['/', ...'sequence', 'Enter', 'r'],
    expect: '[settings] wrote settings.json',
  },
];

function isEmptyLayer(layer: unknown): boolean {
  return JSON.stringify(layer) === '{}';
}

// Whether both files hold an empty user layer: the state the steps start
// from and end in.
function isEmptyConfig(read: UserConfigRead): boolean {
  return (
    read.settings.state === 'ok' &&
    isEmptyLayer(read.settings.layer) &&
    read.keymap.state === 'ok' &&
    isEmptyLayer(read.keymap.layer)
  );
}

// Whether keymap.json holds the bind the keymap steps add.
function holdsAddedBind(read: UserConfigRead): boolean {
  return (
    read.keymap.state === 'ok' &&
    (read.keymap.layer?.binds ?? []).some((bind) => bind.keys === ADDED_KEYS)
  );
}

// Writes an empty layer to both user files, whatever a run before this one
// left in them, broken text included.
async function emptyUserFiles(
  userConfig: SettingsSelfTestDeps['userConfig'],
): Promise<void> {
  const read = await userConfig.read();
  const results = [
    await userConfig.writeSettings({}, read.settings.text),
    await userConfig.writeKeymap({}, read.keymap.text),
  ];
  const failed = results.find((result) => result.type !== 'written');
  if (failed !== undefined) {
    throw new Error(
      `Emptying the user files before the settings steps failed: ${JSON.stringify(failed)}`,
    );
  }
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
  } else {
    const added = (keymap.layer?.binds ?? []).filter(
      (bind) => bind.keys === ADDED_KEYS,
    );
    if (added.length > 0) {
      problems.push(`keymap.json held ${JSON.stringify(added)}`);
    }
  }
  return problems;
}

// `open` empties both user files, then shows Settings mode as
// `settings.show` does. The result is the user config read on the first
// change after which both layers are empty that follows one where keymap.json
// held the added bind: the steps reach that state only at the last step,
// whatever the files held before. It rejects when emptying the files fails.
export function settingsSelfTestScript(
  deps: SettingsSelfTestDeps,
): SelfTestScript {
  const { userConfig } = deps;
  let watching: Disposable | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.settings-sheet'],
    open() {
      watching?.dispose();
      let hasSeenAddedBind = false;
      const result = new Promise<UserConfigRead>((resolve, reject) => {
        const watch = userConfig.onChanged(() => {
          userConfig.read().then((read) => {
            if (watching !== watch) {
              return;
            }
            hasSeenAddedBind ||= holdsAddedBind(read);
            if (hasSeenAddedBind && isEmptyConfig(read)) {
              watch.dispose();
              watching = null;
              resolve(read);
            }
          }, reject);
        });
        watching = watch;
        emptyUserFiles(userConfig).then(deps.show, reject);
      });
      return { shownLine: '[settings] shown', result };
    },
    steps: STEPS,
    problems: (result) => resultProblems(result as UserConfigRead),
  };
}
