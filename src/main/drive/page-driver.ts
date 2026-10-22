import { setTimeout as wait } from 'node:timers/promises';
import {
  type Chord,
  CHORD_NOTATION_RULE,
  isChordToken,
  parseChord,
} from '../../shared/chord-notation';
import { errorText } from '../../shared/error-text';
import type { Box, DrivenWindow, HeldButton, Modifier } from './driven-window';

// Drives the page through a `DrivenWindow`, as the self-test and a drive run
// both do: presses keys and types text, clicks and drags, reads the page's
// log, waits for its lines and frames, captures it, and lists what it cuts off
// at a given width.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
export const STEP_TIMEOUT_MS = 5000;
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

// Presses the left button at the centre of the first element `selector`
// matches, moves by `(dx, dy)` in ten even steps a key gap apart with the
// button held, and releases there; throws as `pressPointOf` does before
// sending anything.
export async function drag(
  window: DrivenWindow,
  selector: string,
  dx: number,
  dy: number,
): Promise<void> {
  const start = await pressPointOf(window, selector);
  const pointer = { button: 'left' as const, clickCount: 1 };
  const held: HeldButton[] = [HELD_BUTTONS.left];
  window.sendInput({
    type: 'mouseDown',
    ...start,
    ...pointer,
    modifiers: held,
  });
  for (let move = 1; move <= DRAG_MOVES; move++) {
    await wait(KEY_GAP_MS);
    const x = start.x + (dx * move) / DRAG_MOVES;
    const y = start.y + (dy * move) / DRAG_MOVES;
    window.sendInput({ type: 'mouseMove', x, y, ...pointer, modifiers: held });
  }
  window.sendInput({
    type: 'mouseUp',
    x: start.x + dx,
    y: start.y + dy,
    ...pointer,
    modifiers: [],
  });
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
// `timeoutMs`.
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await wait(50);
  }
  return false;
}

// Waits for the line among those logged after `seen` lines; the log is newest first.
export function waitForNewLogLine(
  window: DrivenWindow,
  line: string,
  seen: number,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<boolean> {
  return waitFor(async () => {
    const lines = await readLog(window);
    return lines.slice(0, lines.length - seen).includes(line);
  }, timeoutMs);
}

function waitForPageWidth(window: DrivenWindow, width: number) {
  return waitFor(
    async () => (await window.run<number>('innerWidth')) === width,
  );
}

// Waits for three of the page's frames, true once they have run and false when
// they have not within the step timeout (a page that stops producing frames or
// reloads mid-wait). The fit check waits after a resize, and a screenshot
// before its capture: a change reaches the editors' ResizeObserver in the
// first frame, which asks vim to redraw its cursor in the next, and the third
// starts after that redraw.
export async function waitForRedraw(window: DrivenWindow): Promise<boolean> {
  await window.run(`{
  window.redrawFrames = 0;
  const frame = () => {
    window.redrawFrames += 1;
    if (window.redrawFrames < 3) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}`);
  return waitFor(
    async () => (await window.run<number>('window.redrawFrames')) >= 3,
  );
}

// Shrinks the window's content to `width`, lists what the page cuts off there
// once the page has redrawn at that width, then restores the content width it
// read and waits for the page to redraw at it, listing a restore that never
// lands as a problem too. Chromium reports media query changes in the frame
// before its animation-frame callbacks, so the redraw wait holds the next
// step's keys until the page's `change` listeners have seen each width.
export async function cutOffAtWidth(
  window: DrivenWindow,
  width: number,
  scrollsItself: string[],
): Promise<string[]> {
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
    problems = await window.run(cutOffScript(scrollsItself));
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
