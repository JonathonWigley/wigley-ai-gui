import { setTimeout as wait } from 'node:timers/promises';
import {
  type Chord,
  CHORD_NOTATION_RULE,
  isChordToken,
  parseChord,
} from '../../shared/chord-notation';
import { errorText } from '../../shared/error-text';
import {
  type Box,
  type DrivenWindow,
  type HeldButton,
  type Modifier,
  PageNavigatedError,
} from './driven-window';

// Drives the page through a `DrivenWindow`, as the self-test and a drive run
// both do: presses keys and types text, clicks and drags, reads the page's
// log, waits for its lines and frames, resizes and captures it, and lists what
// it cuts off at a given width.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
export const STEP_TIMEOUT_MS = 5000;
// The longest `waitFor` waits on one check before polling again.
const CHECK_TIMEOUT_MS = 2000;
// The gap between typed keys, and between a drag's moves.
const KEY_GAP_MS = 30;
const DRAG_MOVES = 10;

// A chord sends no `char`: its modifiers make it a command, not typed text.
function pressChord(window: DrivenWindow, chord: Chord) {
  const keyCode = chord.key;
  const modifiers: Modifier[] = [
    ...(chord.ctrl ? ['control' as const] : []),
    ...(chord.alt ? ['alt' as const] : []),
    ...(chord.shift ? ['shift' as const] : []),
    ...(chord.meta ? ['meta' as const] : []),
  ];
  window.sendInput({ type: 'keyDown', keyCode, modifiers });
  window.sendInput({ type: 'keyUp', keyCode, modifiers });
}

// Presses a KeyboardEvent.key value, or a chord in the page keymap's notation;
// throws on a chord token that does not fit the notation.
export function press(window: DrivenWindow, key: string): void {
  if (isChordToken(key)) {
    const chord = parseChord(key);
    if (!chord) {
      throw new Error(
        `Cannot press the malformed chord ${key}: ${CHORD_NOTATION_RULE}`,
      );
    }
    pressChord(window, chord);
    return;
  }
  const keyCode = KEY_CODES[key] ?? key;
  // A capital letter's key event says Shift, as the keyboard's does.
  const modifiers: Modifier[] = /^[A-Z]$/.test(key) ? ['shift'] : [];
  window.sendInput({ type: 'keyDown', keyCode, modifiers });
  if (key.length === 1) {
    window.sendInput({ type: 'char', keyCode: key });
  }
  window.sendInput({ type: 'keyUp', keyCode, modifiers });
}

// Presses each character of `text` in turn, waiting the key gap after each.
export async function typeText(
  window: DrivenWindow,
  text: string,
): Promise<void> {
  for (const character of text) {
    press(window, character);
    await wait(KEY_GAP_MS);
  }
}

// The button-held modifier a press of `button` carries until its release.
const HELD_BUTTONS: Record<'left' | 'right', HeldButton> = {
  left: 'leftbuttondown',
  right: 'rightbuttondown',
};

// Where a press on the first element `selector` matches lands: its box's
// centre. Throws when nothing matches, when the match has no size (it is not
// shown), when the centre lies outside the window, or when another element
// covers it, naming the cover, since the press would reach that element
// instead.
async function pressPointOf(
  window: DrivenWindow,
  selector: string,
): Promise<{ x: number; y: number }> {
  const target = await window.run<{
    x: number;
    y: number;
    isShown: boolean;
    isInWindow: boolean;
    cover: string | null;
  } | null>(`(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (node === null) return null;
  const { x, y, width, height } = node.getBoundingClientRect();
  const centre = { x: x + width / 2, y: y + height / 2 };
  const hit = document.elementFromPoint(centre.x, centre.y);
  const isCovered = hit !== null && !node.contains(hit);
  return {
    ...centre,
    isShown: width > 0 || height > 0,
    isInWindow: hit !== null,
    cover: isCovered ? [hit.tagName.toLowerCase(), ...hit.classList].join('.') : null,
  };
})()`);
  if (target === null) {
    throw new Error(`No element matches ${selector}`);
  }
  if (!target.isShown) {
    throw new Error(`${selector} has no size: it is not shown`);
  }
  if (!target.isInWindow) {
    throw new Error(`The centre of ${selector} lies outside the window`);
  }
  if (target.cover !== null) {
    throw new Error(`${selector} is covered at its centre by ${target.cover}`);
  }
  return { x: target.x, y: target.y };
}

// Moves the mouse to the centre of the first element `selector` matches and
// presses and releases `button` there, `count` being the click count (2 for a
// double click); throws as `pressPointOf` does before sending anything.
export async function click(
  window: DrivenWindow,
  selector: string,
  button: 'left' | 'right',
  count: number,
): Promise<void> {
  const { x, y } = await pressPointOf(window, selector);
  const pointer = { x, y, button, clickCount: count };
  window.sendInput({ type: 'mouseMove', ...pointer, modifiers: [] });
  window.sendInput({
    type: 'mouseDown',
    ...pointer,
    modifiers: [HELD_BUTTONS[button]],
  });
  window.sendInput({ type: 'mouseUp', ...pointer, modifiers: [] });
}

// The pointer fields every input of a left-button drag carries.
const DRAG_POINTER = { button: 'left' as const, clickCount: 1 };

// Presses the left button at the centre of the first element `selector`
// matches and moves by `(dx, dy)` in ten even steps a key gap apart with the
// button held, leaving it held; resolves to the end point, where `release`
// lifts it. Throws as `pressPointOf` does before sending anything.
export async function dragAndHold(
  window: DrivenWindow,
  selector: string,
  dx: number,
  dy: number,
): Promise<{ x: number; y: number }> {
  const start = await pressPointOf(window, selector);
  const held: HeldButton[] = [HELD_BUTTONS.left];
  window.sendInput({
    type: 'mouseDown',
    ...start,
    ...DRAG_POINTER,
    modifiers: held,
  });
  for (let move = 1; move <= DRAG_MOVES; move++) {
    await wait(KEY_GAP_MS);
    const x = start.x + (dx * move) / DRAG_MOVES;
    const y = start.y + (dy * move) / DRAG_MOVES;
    window.sendInput({
      type: 'mouseMove',
      x,
      y,
      ...DRAG_POINTER,
      modifiers: held,
    });
  }
  return { x: start.x + dx, y: start.y + dy };
}

// Lifts the left button a `dragAndHold` left held, at `at`.
export function release(
  window: DrivenWindow,
  at: { x: number; y: number },
): void {
  window.sendInput({ type: 'mouseUp', ...at, ...DRAG_POINTER, modifiers: [] });
}

// Drags as `dragAndHold` does and releases the button at the end point.
export async function drag(
  window: DrivenWindow,
  selector: string,
  dx: number,
  dy: number,
): Promise<void> {
  release(window, await dragAndHold(window, selector, dx, dy));
}

// The bounding box of the first element `selector` matches, or null when
// none does.
export function boxOf(
  window: DrivenWindow,
  selector: string,
): Promise<Box | null> {
  return window.run(`(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (node === null) return null;
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
})()`);
}

// The page's log lines, newest first, as the page holds them.
export function readLog(window: DrivenWindow): Promise<string[]> {
  return window.run(
    `[...document.querySelectorAll('#log li')].map((li) => li.textContent)`,
  );
}

// Whether the page has drawn since its navigation and says it is ready.
export async function isReadyForKeys(window: DrivenWindow): Promise<boolean> {
  return (
    window.hasPaintedSinceNavigation() &&
    (await window.run<boolean>(`document.body.dataset.ready === 'true'`))
  );
}

// The error the page's start failed with, or null while it has not failed.
export function readStartFailure(window: DrivenWindow): Promise<string | null> {
  return window.run(`document.body.dataset.startFailed ?? null`);
}

// The core shell's elements that clip their own text with an ellipsis.
const CORE_SCROLLS_ITSELF = ['.title-bar-context'];

// The design primitives' parts that clip their text with an ellipsis on
// purpose, which the fit check lets clip in every script.
export const PRIMITIVE_ELLIPSIS_SELECTORS: readonly string[] = [
  '.ui-row-label',
  '.ui-row-detail',
  '.ui-tab-label',
  '.ui-collapsible-summary',
];

// A script's `scrollsItself` followed by each primitive ellipsis selector it
// does not already hold.
export function withPrimitiveEllipsis(
  scrollsItself: readonly string[],
): string[] {
  return [
    ...scrollsItself,
    ...PRIMITIVE_ELLIPSIS_SELECTORS.filter(
      (selector) => !scrollsItself.includes(selector),
    ),
  ];
}

// A screenshot name: lowercase letters and digits in words joined by `-`.
export const SCREENSHOT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Lists what the page cuts off on the right: an element whose content is wider
// than its box, or that ends past the window, skipping the elements the
// `scrollsItself` selectors and the core's own match, and everything inside
// them.
function cutOffScript(scrollsItself: string[]): string {
  return `(() => {
  const scrollsItself = ${JSON.stringify([...CORE_SCROLLS_ITSELF, ...scrollsItself])};
  const isScroller = (node) => scrollsItself.some((selector) => node.matches(selector));
  const name = (node) => [node.tagName.toLowerCase(), ...node.classList].join('.');
  const problems = [];
  const page = document.documentElement;
  if (page.scrollWidth > innerWidth) {
    problems.push('page is ' + page.scrollWidth + 'px wide');
  }
  for (const node of document.querySelectorAll('#app *')) {
    const right = node.getBoundingClientRect().right;
    const isInScroller = scrollsItself.some(
      (selector) => node.parentElement.closest(selector) !== null,
    );
    if (isInScroller || node.getClientRects().length === 0) {
      continue;
    }
    const isOverfull =
      node.clientWidth > 0 &&
      node.scrollWidth > node.clientWidth + 1 &&
      !isScroller(node);
    if (isOverfull) {
      problems.push(name(node) + ' holds ' + node.scrollWidth + 'px in ' + node.clientWidth + 'px');
    } else if (right > innerWidth + 1) {
      problems.push(name(node) + ' ends at ' + Math.round(right) + 'px');
    }
  }
  return problems;
})()`;
}

// Polls `check` every 50 ms; true once it holds, false when it has not within
// `timeoutMs`, a check still unanswered at that point included. A check
// unanswered after `CHECK_TIMEOUT_MS`, or rejected with `PageNavigatedError`,
// counts as not holding and the next poll runs; any other rejection rejects
// the wait.
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checkDeadline = Math.min(deadline, Date.now() + CHECK_TIMEOUT_MS);
    if (await holdsBefore(check(), checkDeadline)) {
      return true;
    }
    await wait(50);
  }
  return false;
}

// What `check` answers, or false when `deadline` passes first or the check
// rejects with `PageNavigatedError`; a check still running at `deadline` is
// left running.
async function holdsBefore(
  check: Promise<boolean>,
  deadline: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), deadline - Date.now());
  });
  try {
    return await Promise.race([check, timedOut]);
  } catch (error) {
    if (error instanceof PageNavigatedError) {
      return false;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// The page's log as it stood at one navigation: that navigation's count and
// how many lines the log held.
export interface LogMark {
  readonly navigation: number;
  readonly length: number;
}

// Marks where the page's log stands now, so a later read can tell which lines
// came after. A reload during the read gives the mark the navigation count
// read before it, already stale, and a length of 0, so every line of the
// reloaded log counts as new.
export async function markLog(window: DrivenWindow): Promise<LogMark> {
  const navigation = window.navigationCount();
  try {
    const { length } = await readLog(window);
    return { navigation, length };
  } catch (error) {
    if (error instanceof PageNavigatedError) {
      return { navigation, length: 0 };
    }
    throw error;
  }
}

// The lines of `lines` (the log as read, newest first) logged after `mark`,
// newest first: all of them when the page has navigated since the mark, which
// `navigation` (counted before the read) says, or when the log holds fewer
// lines than the mark did.
function linesSince(
  lines: string[],
  mark: LogMark,
  navigation: number,
): string[] {
  const isReloaded =
    navigation !== mark.navigation || lines.length < mark.length;
  return isReloaded ? lines : lines.slice(0, lines.length - mark.length);
}

// Waits for any of `lines` among those logged after `mark`, or among all of
// them once the page has navigated since the mark or its log holds fewer
// lines than the mark's. Resolves to the first of `lines`, in the order given,
// that one read found logged, or to null when none was within `timeoutMs`.
export async function waitForAnyNewLogLine(
  window: DrivenWindow,
  lines: readonly string[],
  mark: LogMark,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<string | null> {
  // Set only to a line found logged, so a check left running past its cap
  // never clears what a later check found.
  let found: string | null = null;
  const isLogged = await waitFor(async () => {
    // Counted before the read, so an old log is never taken as all new.
    const navigation = window.navigationCount();
    const logged = linesSince(await readLog(window), mark, navigation);
    const line = lines.find((candidate) => logged.includes(candidate));
    if (line !== undefined) {
      found = line;
    }
    return line !== undefined;
  }, timeoutMs);
  return isLogged ? found : null;
}

// Waits for the line among those logged after `mark`, as
// `waitForAnyNewLogLine` does; true once it is logged.
export async function waitForNewLogLine(
  window: DrivenWindow,
  line: string,
  mark: LogMark,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<boolean> {
  return (await waitForAnyNewLogLine(window, [line], mark, timeoutMs)) !== null;
}

// The page-log lines logged after `mark`, oldest first: every line once the
// page has navigated since the mark or its log holds fewer lines than the
// mark's. A reload during the read reads the log once more, the reloaded log
// then counting as all new; a second reload during that read rejects.
export async function linesAfter(
  window: DrivenWindow,
  mark: LogMark,
): Promise<string[]> {
  try {
    return await readLinesSince(window, mark);
  } catch (error) {
    if (error instanceof PageNavigatedError) {
      return readLinesSince(window, mark);
    }
    throw error;
  }
}

// One read of the lines logged after `mark`, oldest first, as `linesAfter`
// gives them.
async function readLinesSince(
  window: DrivenWindow,
  mark: LogMark,
): Promise<string[]> {
  // Counted before the read, so an old log is never taken as all new.
  const navigation = window.navigationCount();
  const lines = await readLog(window);
  return linesSince(lines, mark, navigation).reverse();
}

function waitForPageWidth(window: DrivenWindow, width: number) {
  return waitFor(
    async () => (await window.run<number>('innerWidth')) === width,
  );
}

// Waits for three of the page's frames, true once they have run and false when
// they have not within the step timeout (a page that stops producing frames).
// A navigation since the wait began ends it with false at the next poll, the
// reloaded page holding no frame count. The fit check waits after a resize,
// and a screenshot before its capture: a change reaches the editors'
// ResizeObserver in the first frame, which asks vim to redraw its cursor in
// the next, and the third starts after that redraw.
export async function waitForRedraw(window: DrivenWindow): Promise<boolean> {
  const navigation = window.navigationCount();
  try {
    await window.run(`{
  window.redrawFrames = 0;
  const frame = () => {
    window.redrawFrames += 1;
    if (window.redrawFrames < 3) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}`);
  } catch (error) {
    if (error instanceof PageNavigatedError) {
      return false;
    }
    throw error;
  }
  let hasNavigated = false;
  const isSettled = await waitFor(async () => {
    if (window.navigationCount() !== navigation) {
      hasNavigated = true;
      return true;
    }
    return (await window.run<number>('window.redrawFrames')) >= 3;
  });
  return isSettled && !hasNavigated;
}

// Sets the window's content width to `width` and waits for the page to report
// that width and then redraw at it, so the next keys reach a page laid out at
// it. False when the page never reports `width`, the window having taken
// another, or produces no frames after it.
export async function resizeContentWidth(
  window: DrivenWindow,
  width: number,
): Promise<boolean> {
  window.setContentWidth(width);
  return (
    (await waitForPageWidth(window, width)) && (await waitForRedraw(window))
  );
}

// Shrinks the window's content to `width`, lists what the page cuts off there
// once the page has redrawn at that width, then restores the content width it
// read and waits for the page to redraw at it, listing a restore that never
// lands, and a page that navigates while its cut-off is listed, as problems
// too. `isCurrent` says whether the caller's run still owns the window: when
// it is false at the call, nothing is resized and the one problem says so;
// once it turns false after the list, the restore is skipped, the run that set
// the width having been replaced by one that sets its own. Chromium reports
// media query changes in the frame before its animation-frame callbacks, so
// the redraw wait holds the next step's keys until the page's `change`
// listeners have seen each width.
export async function cutOffAtWidth(
  window: DrivenWindow,
  width: number,
  scrollsItself: string[],
  isCurrent: () => boolean = () => true,
): Promise<string[]> {
  if (!isCurrent()) {
    return [`the run stood down before narrowing to ${width}px`];
  }
  const oldWidth = window.contentSize().width;
  window.setContentWidth(width);
  const narrowWidth = window.contentSize().width;
  const hasNarrowed = await waitForPageWidth(window, narrowWidth);
  const hasRedrawn = hasNarrowed && (await waitForRedraw(window));
  let problems: string[];
  if (!hasNarrowed) {
    problems = [`the page never narrowed to ${narrowWidth}px`];
  } else if (!hasRedrawn) {
    problems = [
      `the page produced no frames after narrowing to ${narrowWidth}px`,
    ];
  } else {
    problems = await listCutOff(window, scrollsItself, narrowWidth);
  }
  if (!isCurrent()) {
    return problems;
  }
  window.setContentWidth(oldWidth);
  const restoredWidth = window.contentSize().width;
  const hasRestored = await waitForPageWidth(window, restoredWidth);
  const hasRedrawnRestored = hasRestored && (await waitForRedraw(window));
  if (!hasRestored) {
    problems.push(`the page never widened back to ${restoredWidth}px`);
  } else if (!hasRedrawnRestored) {
    problems.push(
      `the page produced no frames after widening back to ${restoredWidth}px`,
    );
  }
  return problems;
}

// What the page cuts off, as `cutOffScript` lists it, or one problem saying
// the page navigated while the list was read at `narrowWidth`.
async function listCutOff(
  window: DrivenWindow,
  scrollsItself: string[],
  narrowWidth: number,
): Promise<string[]> {
  try {
    return await window.run<string[]>(cutOffScript(scrollsItself));
  } catch (error) {
    if (error instanceof PageNavigatedError) {
      return [
        `the page navigated while listing what it cuts off at ${narrowWidth}px`,
      ];
    }
    throw error;
  }
}

// A PNG of the window, or of `box` in it, once the page has redrawn; a string
// says why there is none.
export async function capturePng(
  window: DrivenWindow,
  box?: Box,
): Promise<Uint8Array | string> {
  if (!(await waitForRedraw(window))) {
    return 'the page produced no frames';
  }
  try {
    return (await window.capture(box)) ?? 'the capture came back empty';
  } catch (error) {
    return errorText(error);
  }
}
