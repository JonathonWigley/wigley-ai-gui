// Electron's accelerator syntax, as `Menu` and `globalShortcut` accept it:
// any modifiers, then one key code, joined by `+` and read case-insensitively.
// Electron throws on an accelerator outside it, so a keymap checks each one
// before the menu or the system-wide shortcuts see it.

const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
]);

// Electron's docs list `"` but not `'`; its key-code mapping
// (`KeyboardCodeFromCharCode` in shell/common/keyboard_util.cc) maps both to
// the same key.
const PUNCTUATION = ')!@#$%^&*(:;+=<,_->.?/~`{][|\\}"\'';

const NAMED_KEYS = [
  'plus',
  'space',
  'tab',
  'capslock',
  'numlock',
  'scrolllock',
  'backspace',
  'delete',
  'insert',
  'return',
  'enter',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'escape',
  'esc',
  'volumeup',
  'volumedown',
  'volumemute',
  'medianexttrack',
  'mediaprevioustrack',
  'mediastop',
  'mediaplaypause',
  'printscreen',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
];

const KEY_CODES = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
  ...PUNCTUATION,
  ...NAMED_KEYS,
  ...Array.from({ length: 24 }, (_, index) => `f${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `num${index}`),
]);

// Why `accelerator` is not one Electron accepts, as the user reads it, or null
// when it is.
export function acceleratorProblem(accelerator: string): string | null {
  const parts = accelerator.split('+');
  if (parts.includes('')) {
    return 'it has an empty part; the + key is written "Plus"';
  }
  const key = parts[parts.length - 1];
  for (const modifier of parts.slice(0, -1)) {
    if (!MODIFIERS.has(modifier.toLowerCase())) {
      return `"${modifier}" is not a modifier`;
    }
  }
  if (MODIFIERS.has(key.toLowerCase())) {
    return 'it ends on a modifier, not a key';
  }
  if (!KEY_CODES.has(key.toLowerCase())) {
    return `"${key}" is not a key`;
  }
  return null;
}
