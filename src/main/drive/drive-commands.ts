import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import type { Disposable } from '../../contracts/disposable';
import { type Files, readIfPresent } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringList,
  requiredNumber,
  requiredString,
  stringList,
} from '../../shared/drive-args';
import { errorText } from '../../shared/error-text';
import { isJsonObject, type JsonObject } from '../../shared/json';
import type { DriveActions } from './action-registry';
import type { Box, ConsoleMessage, DrivenWindow } from './driven-window';
import type { FrameRecorder } from './frame-recorder';
import {
  boxOf,
  capturePng,
  click,
  cutOffAtWidth,
  drag,
  dragAndHold,
  isReadyForKeys,
  linesAfter,
  markLog,
  press,
  readLog,
  readStartFailure,
  release,
  SCREENSHOT_NAME,
  STEP_TIMEOUT_MS,
  typeText,
  waitFor,
  waitForNewLogLine,
  waitForRedraw,
  withPrimitiveEllipsis,
} from './page-driver';

// How long a command waits for the page to be ready for keys, long enough to
// wait out a dev-server reload.
const READY_TIMEOUT_MS = 30_000;
// The gap after each key `key` presses.
const KEY_GAP_MS = 30;
// The user config's settings file, under the home.
const SETTINGS_FILE = '.config/wigley-ai-gui/settings.json';

export interface DriveCommandsDeps {
  window: DrivenWindow;
  actions: DriveActions;
  // Rooted at the run's home.
  homeFiles: Files;
  // The run folder, absolute; `files` writes under it.
  runDir: string;
  files: Files;
  recorder: FrameRecorder;
  // Hears each config the app publishes after a settings change.
  configChanged(listener: () => void): Disposable;
  quit(): void;
  // The run's log, which hears when focus could not be emulated.
  log: Log;
}

// Every command a drive run serves, behind one entry point.
export interface DriveCommands {
  // Waits for the page to be ready for keys and gives it document focus (but
  // for an unqueued command), then runs `command` with `args`; rejects on an
  // unknown command, args of the wrong shape, a page start failure, and the
  // command's own failures. Focus that cannot be emulated is logged, and the
  // command runs without it.
  run(command: string, args: unknown): Promise<unknown>;
  // The commands that run as they arrive, beside the queue, without waiting
  // for the page.
  unqueued: readonly string[];
  // Stops collecting console messages.
  dispose(): void;
}

interface Command {
  args: string;
  description: string;
  // Runs as it arrives, beside the queue, without waiting for the page or
  // emulating focus, so a page that never loads cannot hold it.
  unqueued?: boolean;
  run(args: JsonObject): Promise<unknown>;
}

export function createDriveCommands(deps: DriveCommandsDeps): DriveCommands {
  const { window } = deps;
  const consoleMessages: ConsoleMessage[] = [];
  const listening = window.onConsole((message) =>
    consoleMessages.push(message),
  );
  // The drag `drag --hold` left with its button down, until `release`.
  let held: { selector: string; at: { x: number; y: number } } | null = null;

  // Rejects while a drag is held, since a new press would land mid-drag.
  const requireNothingHeld = () => {
    if (held !== null) {
      throw new Error(`A drag from ${held.selector} is held; release it first`);
    }
  };

  // Every page-log line `act` caused, oldest first, once the page has redrawn.
  const linesCausedBy = async (act: () => Promise<void>) => {
    const mark = await markLog(window);
    await act();
    await waitForRedraw(window);
    return { lines: await linesAfter(window, mark) };
  };

  // A capture rectangle with no width or height captures the whole window.
  const shownElementBox = async (selector: string): Promise<Box> => {
    const box = await boxOf(window, selector);
    if (box === null) {
      throw new Error(`No element matches ${selector}`);
    }
    if (box.width === 0 || box.height === 0) {
      throw new Error(`${selector} has no size: it is not shown`);
    }
    return box;
  };

  const commands: Record<string, Command> = {
    help: {
      args: '{}',
      description: 'lists every command with its args',
      run: async () =>
        Object.entries(commands).map(([command, { args, description }]) => ({
          command,
          args,
          description,
        })),
    },
    ready: {
      args: '{}',
      description: 'waits for the page to be ready for keys',
      run: async () => ({ ready: true }),
    },
    key: {
      args: '{ keys: string[] }',
      description:
        "presses each key or chord in turn; the space key is ' ', which the CLI spells Space",
      run: async (args) => {
        const keys = keyList(args);
        return linesCausedBy(async () => {
          window.focus();
          for (const key of keys) {
            press(window, key);
            await wait(KEY_GAP_MS);
          }
        });
      },
    },
    type: {
      args: '{ text: string }',
      description: 'types the text a key at a time',
      run: async (args) => {
        const text = requiredString(args, 'text');
        return linesCausedBy(async () => {
          window.focus();
          await typeText(window, text);
        });
      },
    },
    click: {
      args: "{ selector: string, button?: 'left' | 'right', count?: number }",
      description:
        "clicks the centre of the selector's first match; rejects, naming the cover, when another element covers that point, and while a drag is held",
      run: async (args) => {
        requireNothingHeld();
        const selector = requiredString(args, 'selector');
        const button = mouseButton(args);
        const count = optionalNumber(args, 'count') ?? 1;
        return linesCausedBy(async () => {
          window.focus();
          await click(window, selector, button, count);
        });
      },
    },
    drag: {
      args: '{ selector: string, dx: number, dy: number, hold?: boolean }',
      description:
        "drags with the left button from the centre of the selector's first match, leaving the button down until `release` with `hold`; rejects, naming the cover, when another element covers that point, and while a drag is held",
      run: async (args) => {
        requireNothingHeld();
        const selector = requiredString(args, 'selector');
        const dx = requiredNumber(args, 'dx');
        const dy = requiredNumber(args, 'dy');
        const isHeld = optionalBoolean(args, 'hold') ?? false;
        return linesCausedBy(async () => {
          window.focus();
          if (isHeld) {
            held = {
              selector,
              at: await dragAndHold(window, selector, dx, dy),
            };
          } else {
            await drag(window, selector, dx, dy);
          }
        });
      },
    },
    release: {
      args: '{}',
      description:
        'lifts the button a `drag` with `hold` left down, at its end point; rejects when no drag is held',
      run: async () => {
        const { at } = held ?? {};
        if (at === undefined) {
          throw new Error('No drag is held; drag --hold first');
        }
        return linesCausedBy(async () => {
          release(window, at);
          held = null;
        });
      },
    },
    resize: {
      args: '{ width: number, height: number }',
      description: 'sets the content size and returns the size it took',
      run: async (args) => {
        window.setSize(
          requiredNumber(args, 'width'),
          requiredNumber(args, 'height'),
        );
        await waitForRedraw(window);
        return window.contentSize();
      },
    },
    setting: {
      args: '{ name: string, value: unknown, plugin?: string }',
      description:
        "writes a top-level setting, or a plugin's, to the home's settings.json",
      run: async (args) => {
        const name = requiredString(args, 'name');
        const plugin = optionalString(args, 'plugin');
        const mark = await markLog(window);
        const applied = await whenConfigChanges(deps.configChanged, () =>
          writeSetting(deps.homeFiles, plugin, name, args.value),
        );
        await waitForRedraw(window);
        return { lines: await linesAfter(window, mark), applied };
      },
    },
    'wait-log': {
      args: '{ line: string, timeoutMs?: number }',
      description:
        'waits for a page log line, logged after the call, equal to the whole line, its source prefix included (`[page] …`)',
      run: async (args) => {
        const line = requiredString(args, 'line');
        const timeoutMs = optionalNumber(args, 'timeoutMs') ?? STEP_TIMEOUT_MS;
        const mark = await markLog(window);
        return {
          found: await waitForNewLogLine(window, line, mark, timeoutMs),
        };
      },
    },
    log: {
      args: '{ since?: number }',
      description: 'the page log lines from `since` on, oldest first',
      run: async (args) => {
        const since = optionalNumber(args, 'since') ?? 0;
        const lines = (await readLog(window)).reverse();
        const reloaded = lines.length < since;
        return {
          lines: reloaded ? lines : lines.slice(since),
          next: lines.length,
          reloaded,
        };
      },
    },
    console: {
      args: '{ since?: number }',
      description: 'the console messages from `since` on',
      run: async (args) => ({
        messages: consoleMessages.slice(optionalNumber(args, 'since') ?? 0),
        next: consoleMessages.length,
      }),
    },
    screenshot: {
      args: '{ name: string, selector?: string }',
      description:
        "saves the window, or the selector's first match, to screenshots/<name>.png",
      run: async (args) => {
        const name = requiredFileName(args, 'Screenshot');
        const selector = optionalString(args, 'selector');
        const box =
          selector === undefined
            ? undefined
            : wholePixels(await shownElementBox(selector));
        const png = await capturePng(window, box);
        if (typeof png === 'string') {
          throw new Error(`Screenshot ${name} failed: ${png}`);
        }
        const file = path.join(deps.runDir, 'screenshots', `${name}.png`);
        await deps.files.writeBytes(file, png);
        return { path: file };
      },
    },
    query: {
      args: '{ selector: string, styles?: string[] }',
      description:
        "every match's text, classes, box and computed styles, custom properties too",
      run: async (args) => ({
        matches: await window.run(
          queryScript(
            requiredString(args, 'selector'),
            optionalStringList(args, 'styles') ?? [],
          ),
        ),
      }),
    },
    fit: {
      args: '{ width?: number, scrollsItself?: string[] }',
      description:
        'lists what the page cuts off at the width, the minimum by default',
      run: async (args) => ({
        problems: await cutOffAtWidth(
          window,
          optionalNumber(args, 'width') ?? window.minimumWidth(),
          withPrimitiveEllipsis(
            optionalStringList(args, 'scrollsItself') ?? [],
          ),
        ),
      }),
    },
    eval: {
      args: '{ script: string }',
      description:
        "runs the script in a block of its own in the page and returns its last expression's value; its const, let and class stay in that block, its var and function reach the page's globals",
      run: async (args) => ({
        value: await window.run(inOwnBlock(requiredString(args, 'script'))),
      }),
    },
    record: {
      args: "{ action: 'start' | 'stop', name?: string }",
      description: 'starts or stops recording a video to videos/<name>.mp4',
      run: async (args) => {
        const action = requiredString(args, 'action');
        if (action === 'start') {
          deps.recorder.start(
            args.name === undefined
              ? undefined
              : requiredFileName(args, 'Recording'),
          );
          return {};
        }
        if (action === 'stop') {
          return { path: await deps.recorder.stop() };
        }
        throw new Error(`record action is start or stop, not ${action}`);
      },
    },
    actions: {
      args: '{}',
      description: "lists the plugins' drive actions",
      run: async () => deps.actions.list(),
    },
    do: {
      args: '{ name: string, args?: unknown }',
      description: 'runs a drive action and returns its result',
      run: async (args) =>
        deps.actions.run(requiredString(args, 'name'), args.args),
    },
    quit: {
      args: '{}',
      description: 'quits the app once the reply is sent',
      unqueued: true,
      run: async () => {
        setImmediate(deps.quit);
        return {};
      },
    },
  };

  return {
    run: async (name, args) => {
      const command = Object.hasOwn(commands, name) ? commands[name] : null;
      if (command === null) {
        throw new Error(`No command ${name}; \`help\` lists them`);
      }
      if (args !== undefined && !isJsonObject(args)) {
        throw new Error(`${name} takes an args object`);
      }
      if (command.unqueued !== true) {
        await waitForPage(window);
        // Every command asks again: a detached debugger takes the emulation
        // with it.
        await emulateFocusOrLog(window, deps.log);
      }
      return command.run(args ?? {});
    },
    unqueued: Object.entries(commands)
      .filter(([, command]) => command.unqueued === true)
      .map(([name]) => name),
    dispose: () => listening.dispose(),
  };
}

// Waits for the page to be ready for keys; rejects with the page's start
// failure, or when it is not ready in time, saying so apart when a check's
// script was still unanswered at that point. A script run mid-reload rejects,
// which counts as not ready yet.
async function waitForPage(window: DrivenWindow): Promise<void> {
  // A count, since a check left running past its cap overlaps the next and
  // can settle after it.
  let checksRunning = 0;
  const hasSettled = async () => {
    checksRunning += 1;
    try {
      return (
        (await isReadyForKeys(window)) ||
        (await readStartFailure(window)) !== null
      );
    } catch {
      return false;
    } finally {
      checksRunning -= 1;
    }
  };
  if (!(await waitFor(hasSettled, READY_TIMEOUT_MS))) {
    const seconds = READY_TIMEOUT_MS / 1000;
    throw new Error(
      checksRunning > 0
        ? `The page never finished loading within ${seconds} s: it stopped answering scripts run in it`
        : `The page was not ready for keys within ${seconds} s`,
    );
  }
  const startFailure = await readStartFailure(window);
  if (startFailure !== null) {
    throw new Error(startFailure);
  }
}

// Emulates focus on the page, or logs why it could not, such as another
// debugger holding the page.
async function emulateFocusOrLog(
  window: DrivenWindow,
  log: Log,
): Promise<void> {
  try {
    await window.emulateFocus();
  } catch (error) {
    log(
      'main',
      `drive: focus could not be emulated, so the page runs unfocused: ${errorText(error)}`,
    );
  }
}

// Runs `write`, then waits up to the step timeout for the next config change;
// whether one came. The listener is in place before the write.
async function whenConfigChanges(
  configChanged: DriveCommandsDeps['configChanged'],
  write: () => Promise<void>,
): Promise<boolean> {
  let settle: (hasChanged: boolean) => void = () => {};
  const changed = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const listening = configChanged(() => settle(true));
  let timer: NodeJS.Timeout | undefined;
  try {
    await write();
    timer = setTimeout(() => settle(false), STEP_TIMEOUT_MS);
    return await changed;
  } finally {
    clearTimeout(timer);
    listening.dispose();
  }
}

// Sets `name` to `value` at the top level of the home's settings.json, or
// under `plugin` when given, and writes the file back whole; a missing file
// starts as `{}`.
async function writeSetting(
  homeFiles: Files,
  plugin: string | undefined,
  name: string,
  value: unknown,
): Promise<void> {
  const text = await readIfPresent(homeFiles, SETTINGS_FILE);
  const settings: unknown = text === null ? {} : JSON.parse(text);
  if (!isJsonObject(settings)) {
    throw new Error(`${SETTINGS_FILE} is not a JSON object`);
  }
  if (plugin === undefined) {
    settings[name] = value;
  } else {
    const pluginSettings = settings[plugin] ?? {};
    if (!isJsonObject(pluginSettings)) {
      throw new Error(`${SETTINGS_FILE}'s ${plugin} is not a JSON object`);
    }
    settings[plugin] = { ...pluginSettings, [name]: value };
  }
  await homeFiles.write(
    SETTINGS_FILE,
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

// `args.name`, refused unless it is lowercase letters and digits in words
// joined by -, so the file it names stays in its folder; `kind` opens the
// error.
function requiredFileName(args: JsonObject, kind: string): string {
  const name = requiredString(args, 'name');
  if (!SCREENSHOT_NAME.test(name)) {
    throw new Error(
      `${kind} name "${name}" is not lowercase letters and digits in words joined by -`,
    );
  }
  return name;
}

// `box` grown outward to whole pixels, as a capture rectangle must be.
function wholePixels(box: Box): Box {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return {
    x,
    y,
    width: Math.ceil(box.x + box.width) - x,
    height: Math.ceil(box.y + box.height) - y,
  };
}

// `script` wrapped in a block, so its top-level const, let and class
// declarations end with the run while the block's completion value stays the
// script's last expression's value. The newlines keep a closing line comment
// from swallowing the brace.
function inOwnBlock(script: string): string {
  return `{\n${script}\n}`;
}

// For every element `selector` matches: its trimmed text, classes, bounding
// box, and each of `styles` as `getComputedStyle` gives it.
function queryScript(selector: string, styles: string[]): string {
  return `(() => {
  const styles = ${JSON.stringify(styles)};
  return [...document.querySelectorAll(${JSON.stringify(selector)})].map((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    const computed = getComputedStyle(node);
    return {
      text: (node.textContent ?? '').trim(),
      classes: [...node.classList],
      box: { x, y, width, height },
      styles: Object.fromEntries(
        styles.map((name) => [name, computed.getPropertyValue(name)]),
      ),
    };
  });
})()`;
}

// The `keys` list, rejecting an empty list and an empty key, which would
// press nothing.
function keyList(args: JsonObject): string[] {
  const keys = stringList(args, 'keys');
  if (keys.length === 0 || keys.includes('')) {
    throw new Error(
      "keys must name at least one key, none empty; the space key is ' ', which the CLI spells Space",
    );
  }
  return keys;
}

function mouseButton(args: JsonObject): 'left' | 'right' {
  const button = optionalString(args, 'button') ?? 'left';
  if (button !== 'left' && button !== 'right') {
    throw new Error(`button is left or right, not ${button}`);
  }
  return button;
}
