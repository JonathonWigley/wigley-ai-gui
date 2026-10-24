import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
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

// A key event on `code` holding only the modifiers named.
function press(code: string, modifiers: Partial<ChordPress>): ChordPress {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  };
}

describe('createChordMatcher', () => {
  const nextTab: PageBind = {
    keys: ['<A-o>'],
    scope: 'forms',
    command: 'test.nextTab',
  };

  it('matches a chord on its physical key and exact modifiers', () => {
    const chords = createChordMatcher([nextTab]);
    expect(
      chords.match(press('KeyO', { altKey: true }), 'forms')?.command,
    ).toBe('test.nextTab');
  });

  it('ignores a chord with an extra or missing modifier', () => {
    const chords = createChordMatcher([nextTab]);
    expect(
      chords.match(press('KeyO', { altKey: true, shiftKey: true }), 'forms'),
    ).toBeUndefined();
    expect(chords.match(press('KeyO', {}), 'forms')).toBeUndefined();
  });

  it('tells a Ctrl+Shift letter chord from the Ctrl one on its key', () => {
    const chords = createChordMatcher([
      { keys: ['<C-j>'], scope: 'forms', command: 'test.lineDown' },
      { keys: ['<C-S-j>'], scope: 'forms', command: 'test.halfPageDown' },
    ]);
    expect(
      chords.match(press('KeyJ', { ctrlKey: true }), 'forms')?.command,
    ).toBe('test.lineDown');
    expect(
      chords.match(press('KeyJ', { ctrlKey: true, shiftKey: true }), 'forms')
        ?.command,
    ).toBe('test.halfPageDown');
  });

  it('matches a digit chord on its top-row code', () => {
    const chords = createChordMatcher([
      { keys: ['<C-1>'], scope: 'forms', command: 'test.first' },
    ]);
    expect(
      chords.match(press('Digit1', { ctrlKey: true }), 'forms')?.command,
    ).toBe('test.first');
    expect(
      chords.match(press('Numpad1', { ctrlKey: true }), 'forms'),
    ).toBeUndefined();
  });

  it('matches an Enter chord on code Enter', () => {
    const chords = createChordMatcher([
      { keys: ['<D-Enter>'], scope: 'chat.chat', command: 'test.send' },
    ]);
    expect(
      chords.match(press('Enter', { metaKey: true }), 'chat.chat')?.command,
    ).toBe('test.send');
    expect(
      chords.match(
        press('Enter', { metaKey: true, ctrlKey: true }),
        'chat.chat',
      ),
    ).toBeUndefined();
  });

  it('matches a chord holding every modifier', () => {
    const chords = createChordMatcher([
      { keys: ['<C-A-S-D-k>'], scope: 'forms', command: 'test.all' },
    ]);
    const allHeld = {
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: true,
    };
    expect(chords.match(press('KeyK', allHeld), 'forms')?.command).toBe(
      'test.all',
    );
  });

  it('matches a chord only in its scope', () => {
    const closeTab: PageBind = {
      keys: ['<D-w>'],
      scope: 'any',
      command: 'test.closeTab',
    };
    const chords = createChordMatcher([
      { keys: ['<C-h>'], scope: 'forms', command: 'test.left' },
      closeTab,
    ]);
    expect(
      chords.match(press('KeyH', { ctrlKey: true }), 'review'),
    ).toBeUndefined();
    expect(chords.match(press('KeyW', { metaKey: true }), 'idle')).toBe(
      closeTab,
    );
  });

  it('rejects a chord inside a longer sequence', () => {
    expect(() =>
      createChordMatcher([
        { keys: ['g', '<C-h>'], scope: 'forms', command: 'test.x' },
      ]),
    ).toThrow(/test\.x.*<C-h>/);
  });

  it.each(['<A-C-h>', '<C-H>', '<C-;>', '<C-F1>', '<S-h>', '<h>'])(
    'rejects a malformed chord %s',
    (token) => {
      expect(() =>
        createChordMatcher([
          { keys: [token], scope: 'forms', command: 'test.x' },
        ]),
      ).toThrow(`Page bind for test.x has a malformed chord ${token}`);
    },
  );

  it('leaves a lone < or > a plain key', () => {
    expect(() =>
      createChordMatcher([
        { keys: ['<'], scope: 'forms', command: 'test.less' },
        { keys: ['>'], scope: 'forms', command: 'test.more' },
      ]),
    ).not.toThrow();
  });
});
