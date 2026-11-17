import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import type { PlatformKeys } from '../contracts/platform';
import {
  type ChordPress,
  createChordMatcher,
  createSequenceMatcher,
  type SequenceResult,
} from './key-sequences';

const TIMEOUT_MS = 1000;

// A result with the bind that ran named by its command.
function summarize(result: SequenceResult) {
  return { ...result, ran: result.ran?.command };
}

const binds: PageBind[] = [
  { keys: ['j'], scope: 'forms', command: 'test.down' },
  { keys: ['j'], scope: 'review', command: 'test.reviewDown' },
  { keys: [' ', ' '], scope: 'forms', command: 'test.open' },
  { keys: ['z', 'a'], scope: 'forms', command: 'test.fold' },
  { keys: ['?'], scope: 'any', command: 'test.help' },
];

describe('createSequenceMatcher', () => {
  it('runs a one-key bind in its scope', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(summarize(matcher.feed('j', 'forms', 0))).toEqual({
      ran: 'test.down',
      replay: [],
      pending: false,
    });
  });

  it('runs the current scope bind when two scopes share a key', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(summarize(matcher.feed('j', 'review', 0))).toEqual({
      ran: 'test.reviewDown',
      replay: [],
      pending: false,
    });
  });

  it('runs an any-scope bind in every view', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(summarize(matcher.feed('?', 'forms', 0))).toEqual({
      ran: 'test.help',
      replay: [],
      pending: false,
    });
    expect(summarize(matcher.feed('?', 'confirm', 10))).toEqual({
      ran: 'test.help',
      replay: [],
      pending: false,
    });
  });

  it('ignores a key with no bind in the current scope', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(summarize(matcher.feed('j', 'idle', 0))).toEqual({
      ran: undefined,
      replay: [],
      pending: false,
    });
  });

  it('waits on the first key of a sequence and runs on the last', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(summarize(matcher.feed(' ', 'forms', 0))).toEqual({
      ran: undefined,
      replay: [],
      pending: true,
    });
    expect(summarize(matcher.feed(' ', 'forms', 500))).toEqual({
      ran: 'test.open',
      replay: [],
      pending: false,
    });
  });

  it('continues a sequence whose next key comes at the timeout', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(summarize(matcher.feed('a', 'forms', 1000))).toEqual({
      ran: 'test.fold',
      replay: [],
      pending: false,
    });
  });

  it('drops a sequence whose next key comes after the timeout', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(summarize(matcher.feed('a', 'forms', 1001))).toEqual({
      ran: undefined,
      replay: [],
      pending: false,
    });
  });

  it('replays a key that breaks a sequence on its own', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(summarize(matcher.feed('j', 'forms', 100))).toEqual({
      ran: 'test.down',
      replay: [],
      pending: false,
    });
  });

  it('replays a key that breaks a sequence into a new sequence', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed(' ', 'forms', 0);
    expect(summarize(matcher.feed('z', 'forms', 100))).toEqual({
      ran: undefined,
      replay: [],
      pending: true,
    });
    expect(summarize(matcher.feed('a', 'forms', 200))).toEqual({
      ran: 'test.fold',
      replay: [],
      pending: false,
    });
  });

  it('stops a broken sequence at the first bind, leaving the rest to replay', () => {
    const longBinds: PageBind[] = [
      { keys: ['g', 'u', 'x'], scope: 'forms', command: 'test.long' },
      { keys: ['u'], scope: 'forms', command: 'test.undo' },
      { keys: ['j'], scope: 'forms', command: 'test.down' },
    ];
    const matcher = createSequenceMatcher(longBinds, TIMEOUT_MS);
    matcher.feed('g', 'forms', 0);
    matcher.feed('u', 'forms', 100);
    expect(summarize(matcher.feed('j', 'forms', 200))).toEqual({
      ran: 'test.undo',
      replay: ['j'],
      pending: false,
    });
  });

  it('ignores a key that breaks a sequence and has no bind of its own', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(summarize(matcher.feed('q', 'forms', 100))).toEqual({
      ran: undefined,
      replay: [],
      pending: false,
    });
  });

  it('forgets a pending sequence on reset', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    matcher.reset();
    expect(summarize(matcher.feed('a', 'forms', 100))).toEqual({
      ran: undefined,
      replay: [],
      pending: false,
    });
  });

  it('lists the keys waiting for more', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed(' ', 'forms', 0);
    expect(matcher.pendingKeys()).toEqual([' ']);
    matcher.feed(' ', 'forms', 100);
    expect(matcher.pendingKeys()).toEqual([]);
  });

  it('continues a held sequence whose next key comes after the timeout', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    matcher.hold();
    expect(summarize(matcher.feed('a', 'forms', 5000))).toEqual({
      ran: 'test.fold',
      replay: [],
      pending: false,
    });
  });

  it('ends the hold once its sequence ends', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    matcher.hold();
    matcher.feed('a', 'forms', 100);
    expect(matcher.isHeld()).toBe(false);
    matcher.feed('z', 'forms', 200);
    expect(summarize(matcher.feed('a', 'forms', 5000))).toEqual({
      ran: undefined,
      replay: [],
      pending: false,
    });
  });

  it('ends the hold on reset', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    matcher.hold();
    matcher.reset();
    expect(matcher.isHeld()).toBe(false);
  });

  it('throws when built from ambiguous binds', () => {
    const duplicated: PageBind[] = [
      { keys: ['x'], scope: 'forms', command: 'test.first' },
      { keys: ['x'], scope: 'forms', command: 'test.second' },
    ];
    expect(() => createSequenceMatcher(duplicated, TIMEOUT_MS)).toThrow(
      /test\.first.*test\.second/,
    );
  });
});

const MAC_KEYS: PlatformKeys = {
  optionMatchesByCode: true,
  altGraphTypes: false,
};
const PC_KEYS: PlatformKeys = {
  optionMatchesByCode: false,
  altGraphTypes: true,
};

// A press of `key` on `code` holding only the modifiers `held` sets.
function press(
  key: string,
  code: string,
  held: Partial<ChordPress> = {},
): ChordPress {
  return {
    key,
    code,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    altGraph: false,
    ...held,
  };
}

describe('createChordMatcher', () => {
  const nextTab: PageBind = {
    keys: ['<A-o>'],
    scope: 'forms',
    command: 'test.nextTab',
  };

  it('matches a chord on its key and exact modifiers', () => {
    const chords = createChordMatcher([nextTab], MAC_KEYS);
    expect(
      chords.match(press('o', 'KeyO', { alt: true }), 'forms')?.command,
    ).toBe('test.nextTab');
  });

  it('ignores a chord with an extra or missing modifier', () => {
    const chords = createChordMatcher([nextTab], MAC_KEYS);
    expect(
      chords.match(press('O', 'KeyO', { alt: true, shift: true }), 'forms'),
    ).toBeUndefined();
    expect(chords.match(press('o', 'KeyO'), 'forms')).toBeUndefined();
  });

  it('tells a Ctrl+Shift letter chord from the Ctrl one on its key', () => {
    const chords = createChordMatcher(
      [
        { keys: ['<C-j>'], scope: 'forms', command: 'test.lineDown' },
        { keys: ['<C-S-j>'], scope: 'forms', command: 'test.halfPageDown' },
      ],
      MAC_KEYS,
    );
    expect(
      chords.match(press('j', 'KeyJ', { ctrl: true }), 'forms')?.command,
    ).toBe('test.lineDown');
    expect(
      chords.match(press('J', 'KeyJ', { ctrl: true, shift: true }), 'forms')
        ?.command,
    ).toBe('test.halfPageDown');
  });

  it('matches a digit chord on the digit it types', () => {
    const chords = createChordMatcher(
      [{ keys: ['<C-1>'], scope: 'forms', command: 'test.first' }],
      MAC_KEYS,
    );
    expect(
      chords.match(press('1', 'Digit1', { ctrl: true }), 'forms')?.command,
    ).toBe('test.first');
    expect(
      chords.match(press('1', 'Numpad1', { ctrl: true }), 'forms')?.command,
    ).toBe('test.first');
  });

  it.each([
    ['<A-;>', ';', 'Semicolon'],
    ["<A-'>", "'", 'Quote'],
  ])('matches the punctuation chord %s on %s', (keys, key, code) => {
    const chords = createChordMatcher(
      [{ keys: [keys], scope: 'forms', command: 'test.split' }],
      MAC_KEYS,
    );
    expect(
      chords.match(press(key, code, { alt: true }), 'forms')?.command,
    ).toBe('test.split');
  });

  it('matches an Enter chord on key Enter', () => {
    const chords = createChordMatcher(
      [{ keys: ['<D-Enter>'], scope: 'chat.chat', command: 'test.send' }],
      MAC_KEYS,
    );
    expect(
      chords.match(press('Enter', 'Enter', { meta: true }), 'chat.chat')
        ?.command,
    ).toBe('test.send');
    expect(
      chords.match(
        press('Enter', 'Enter', { meta: true, ctrl: true }),
        'chat.chat',
      ),
    ).toBeUndefined();
  });

  it('tells a bare Tab chord from Shift+Tab on key Tab', () => {
    const chords = createChordMatcher(
      [
        { keys: ['<Tab>'], scope: 'forms.forms', command: 'test.next' },
        { keys: ['<S-Tab>'], scope: 'forms.forms', command: 'test.prev' },
      ],
      MAC_KEYS,
    );
    expect(chords.match(press('Tab', 'Tab'), 'forms.forms')?.command).toBe(
      'test.next',
    );
    expect(
      chords.match(press('Tab', 'Tab', { shift: true }), 'forms.forms')
        ?.command,
    ).toBe('test.prev');
  });

  it('matches a chord holding every modifier', () => {
    const chords = createChordMatcher(
      [{ keys: ['<C-A-S-D-k>'], scope: 'forms', command: 'test.all' }],
      MAC_KEYS,
    );
    const allHeld = { ctrl: true, alt: true, shift: true, meta: true };
    expect(chords.match(press('˚', 'KeyK', allHeld), 'forms')?.command).toBe(
      'test.all',
    );
  });

  it('matches a chord only in its scope', () => {
    const closeTab: PageBind = {
      keys: ['<D-w>'],
      scope: 'any',
      command: 'test.closeTab',
    };
    const chords = createChordMatcher(
      [{ keys: ['<C-h>'], scope: 'forms', command: 'test.left' }, closeTab],
      MAC_KEYS,
    );
    expect(
      chords.match(press('h', 'KeyH', { ctrl: true }), 'review'),
    ).toBeUndefined();
    expect(chords.match(press('w', 'KeyW', { meta: true }), 'idle')).toBe(
      closeTab,
    );
  });

  it.each<{
    case: string;
    keys: PlatformKeys;
    bind: string;
    press: ChordPress;
    runs: boolean;
  }>([
    {
      case: 'AZERTY Ctrl+A',
      keys: PC_KEYS,
      bind: '<C-a>',
      press: press('a', 'KeyQ', { ctrl: true }),
      runs: true,
    },
    {
      case: 'AZERTY Ctrl+A on the Q key',
      keys: PC_KEYS,
      bind: '<C-q>',
      press: press('a', 'KeyQ', { ctrl: true }),
      runs: false,
    },
    {
      case: 'Dvorak Ctrl+O',
      keys: PC_KEYS,
      bind: '<C-o>',
      press: press('o', 'KeyS', { ctrl: true }),
      runs: true,
    },
    {
      case: 'mac Option',
      keys: MAC_KEYS,
      bind: '<A-o>',
      press: press('ø', 'KeyO', { alt: true }),
      runs: true,
    },
    {
      case: 'mac Option with AltGraph set',
      keys: MAC_KEYS,
      bind: '<A-o>',
      press: press('ø', 'KeyO', { alt: true, altGraph: true }),
      runs: true,
    },
    {
      case: 'mac Option+Shift',
      keys: MAC_KEYS,
      bind: '<A-S-o>',
      press: press('Ø', 'KeyO', { alt: true, shift: true }),
      runs: true,
    },
    {
      case: 'mac Option symbol',
      keys: MAC_KEYS,
      bind: '<A-/>',
      press: press('÷', 'Slash', { alt: true }),
      runs: true,
    },
    {
      case: 'Cyrillic Ctrl+J',
      keys: PC_KEYS,
      bind: '<C-j>',
      press: press('о', 'KeyJ', { ctrl: true }),
      runs: true,
    },
    {
      case: 'non-ASCII letter on a digit key',
      keys: PC_KEYS,
      bind: '<C-2>',
      press: press('é', 'Digit2', { ctrl: true }),
      runs: true,
    },
    {
      case: 'US Ctrl+/',
      keys: PC_KEYS,
      bind: '<C-/>',
      press: press('/', 'Slash', { ctrl: true }),
      runs: true,
    },
    {
      case: 'German Ctrl+/',
      keys: PC_KEYS,
      bind: '<C-/>',
      press: press('/', 'Digit7', { ctrl: true, shift: true }),
      runs: true,
    },
    {
      case: 'Ctrl+?',
      keys: PC_KEYS,
      bind: '<C-?>',
      press: press('?', 'Slash', { ctrl: true, shift: true }),
      runs: true,
    },
    {
      case: 'F5 alone',
      keys: PC_KEYS,
      bind: '<F5>',
      press: press('F5', 'F5'),
      runs: true,
    },
    {
      case: 'Ctrl+F5',
      keys: PC_KEYS,
      bind: '<F5>',
      press: press('F5', 'F5', { ctrl: true }),
      runs: false,
    },
    {
      case: 'mac Option+Up',
      keys: MAC_KEYS,
      bind: '<A-Up>',
      press: press('ArrowUp', 'ArrowUp', { alt: true }),
      runs: true,
    },
    {
      case: 'Ctrl+<',
      keys: PC_KEYS,
      bind: '<C-lt>',
      press: press('<', 'Comma', { ctrl: true, shift: true }),
      runs: true,
    },
    {
      case: 'AltGr typing',
      keys: PC_KEYS,
      bind: '<C-A-q>',
      press: press('@', 'KeyQ', { ctrl: true, alt: true, altGraph: true }),
      runs: false,
    },
    {
      case: 'Ctrl+Alt without AltGr',
      keys: PC_KEYS,
      bind: '<C-A-q>',
      press: press('q', 'KeyQ', { ctrl: true, alt: true }),
      runs: true,
    },
  ])('$case runs $bind: $runs', ({ keys, bind, press: pressed, runs }) => {
    const bound: PageBind = { keys: [bind], scope: 'any', command: 'test.x' };
    const chords = createChordMatcher([bound], keys);

    expect(chords.match(pressed, 'any') === bound).toBe(runs);
  });

  it('rejects a chord inside a longer sequence', () => {
    expect(() =>
      createChordMatcher(
        [{ keys: ['g', '<C-h>'], scope: 'forms', command: 'test.x' }],
        MAC_KEYS,
      ),
    ).toThrow(/test\.x.*<C-h>/);
  });

  it.each(['<A-C-h>', '<C-H>', '<S-h>', '<h>', '<C-S-/>', '<Up>'])(
    'rejects a malformed chord %s',
    (token) => {
      expect(() =>
        createChordMatcher(
          [{ keys: [token], scope: 'forms', command: 'test.x' }],
          MAC_KEYS,
        ),
      ).toThrow(/test\.x/);
    },
  );

  it('leaves a lone < or > a plain key', () => {
    expect(() =>
      createChordMatcher(
        [
          { keys: ['<'], scope: 'forms', command: 'test.less' },
          { keys: ['>'], scope: 'forms', command: 'test.more' },
        ],
        MAC_KEYS,
      ),
    ).not.toThrow();
  });
});
