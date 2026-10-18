import { app, type BrowserWindow } from 'electron';

// Drives keys into the page through Electron's input pipeline and checks the
// lines the page logs. Run with `npm run selftest`; exits non-zero on failure.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
const STEP_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Step {
  keys: string[];
  modifiers?: ('control' | 'meta')[];
  expect: string;
}

const STEPS: Step[] = [
  { keys: [' ', 'j'], expect: '[vim] focused box 2' },
  { keys: [' ', 'k'], expect: '[vim] focused box 1' },
  { keys: ['i', 'a', 'b', 'j', 'k', ' ', 'j'], expect: '[vim] focused box 2' },
  { keys: [' ', 'k'], expect: '[vim] focused box 1' },
  { keys: [' ', ' '], expect: '[acp] turn ended: end_turn' },
  { keys: [' ', 'q'], expect: '[vim] :leave dropped focus to the page' },
  { keys: ['i'], expect: '[page] i focused box 1' },
  {
    keys: ['Tab'],
    modifiers: ['control'],
    expect: '[input] Ctrl+Tab caught before the page',
  },
];

function press(
  window: BrowserWindow,
  key: string,
  modifiers: Step['modifiers'],
) {
  const keyCode = KEY_CODES[key] ?? key;
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (key.length === 1) {
    window.webContents.sendInputEvent({
      type: 'char',
      keyCode: key,
      modifiers,
    });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

function readLog(window: BrowserWindow): Promise<string[]> {
  return window.webContents.executeJavaScript(
    `[...document.querySelectorAll('#log li')].map((li) => li.textContent)`,
  );
}

async function waitForLogLine(window: BrowserWindow, line: string) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await readLog(window)).includes(line)) {
      return true;
    }
    await wait(50);
  }
  return false;
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;

async function runStep(
  window: BrowserWindow,
  step: Step,
  isCurrent: () => boolean,
): Promise<boolean> {
  for (const key of step.keys) {
    if (!isCurrent()) {
      return false;
    }
    press(window, key, step.modifiers);
    await wait(30);
  }
  const passed = await waitForLogLine(window, step.expect);
  if (isCurrent()) {
    const keys = step.keys.join('').replaceAll(' ', '␣');
    console.log(
      `[selftest] ${passed ? 'PASS' : 'FAIL'} ${keys} -> ${step.expect}`,
    );
  }
  return passed;
}

async function runAllSteps(window: BrowserWindow) {
  const run = ++latestRun;
  const isCurrent = () => run === latestRun;
  window.webContents.focus();
  let failures = 0;
  for (const step of STEPS) {
    if (!(await runStep(window, step, isCurrent))) {
      failures++;
    }
  }
  if (!isCurrent()) {
    return;
  }
  console.log(
    `[selftest] ${failures === 0 ? 'all passed' : `${failures} failed`}`,
  );
  app.exit(failures === 0 ? 0 : 1);
}

export function startSelfTest(window: BrowserWindow) {
  window.webContents.on('did-finish-load', () => void runAllSteps(window));
}
