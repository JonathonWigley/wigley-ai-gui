import { describe, expect, it } from 'vitest';
import type { PageBind } from '../contracts/keymap';
import {
  createSequenceMatcher,
  requireUnambiguousBinds,
} from './key-sequences';

const TIMEOUT_MS = 1000;

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
    expect(matcher.feed('j', 'forms', 0)).toEqual({
      run: ['test.down'],
      pending: false,
    });
  });

  it('runs the current scope bind when two scopes share a key', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(matcher.feed('j', 'review', 0)).toEqual({
      run: ['test.reviewDown'],
      pending: false,
    });
  });

  it('runs an any-scope bind in every view', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(matcher.feed('?', 'forms', 0)).toEqual({
      run: ['test.help'],
      pending: false,
    });
    expect(matcher.feed('?', 'confirm', 10)).toEqual({
      run: ['test.help'],
      pending: false,
    });
  });

  it('ignores a key with no bind in the current scope', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(matcher.feed('j', 'idle', 0)).toEqual({ run: [], pending: false });
  });

  it('waits on the first key of a sequence and runs on the last', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    expect(matcher.feed(' ', 'forms', 0)).toEqual({ run: [], pending: true });
    expect(matcher.feed(' ', 'forms', 500)).toEqual({
      run: ['test.open'],
      pending: false,
    });
  });

  it('continues a sequence whose next key comes at the timeout', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(matcher.feed('a', 'forms', 1000)).toEqual({
      run: ['test.fold'],
      pending: false,
    });
  });

  it('drops a sequence whose next key comes after the timeout', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(matcher.feed('a', 'forms', 1001)).toEqual({
      run: [],
      pending: false,
    });
  });

  it('replays a key that breaks a sequence on its own', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(matcher.feed('j', 'forms', 100)).toEqual({
      run: ['test.down'],
      pending: false,
    });
  });

  it('replays a key that breaks a sequence into a new sequence', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed(' ', 'forms', 0);
    expect(matcher.feed('z', 'forms', 100)).toEqual({
      run: [],
      pending: true,
    });
    expect(matcher.feed('a', 'forms', 200)).toEqual({
      run: ['test.fold'],
      pending: false,
    });
  });

  it('replays the keys after a longer broken sequence in order', () => {
    const longBinds: PageBind[] = [
      { keys: ['g', 'u', 'x'], scope: 'forms', command: 'test.long' },
      { keys: ['u'], scope: 'forms', command: 'test.undo' },
      { keys: ['j'], scope: 'forms', command: 'test.down' },
    ];
    const matcher = createSequenceMatcher(longBinds, TIMEOUT_MS);
    matcher.feed('g', 'forms', 0);
    matcher.feed('u', 'forms', 100);
    expect(matcher.feed('j', 'forms', 200)).toEqual({
      run: ['test.undo', 'test.down'],
      pending: false,
    });
  });

  it('ignores a key that breaks a sequence and has no bind of its own', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    expect(matcher.feed('q', 'forms', 100)).toEqual({
      run: [],
      pending: false,
    });
  });

  it('forgets a pending sequence on reset', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    matcher.feed('z', 'forms', 0);
    matcher.reset();
    expect(matcher.feed('a', 'forms', 100)).toEqual({
      run: [],
      pending: false,
    });
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

describe('requireUnambiguousBinds', () => {
  it('rejects the same keys twice in one scope, naming both binds', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['x'], scope: 'review', command: 'test.first' },
        { keys: ['x'], scope: 'review', command: 'test.second' },
      ]),
    ).toThrow(/test\.first.*test\.second/);
  });

  it('rejects a bind whose keys begin another bind in one scope', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['z'], scope: 'forms', command: 'test.short' },
        { keys: ['z', 'a'], scope: 'forms', command: 'test.long' },
      ]),
    ).toThrow(/test\.short.*test\.long/);
  });

  it('rejects an any-scope bind that shares keys with a scoped one', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['?'], scope: 'help', command: 'test.close' },
        { keys: ['?'], scope: 'any', command: 'test.help' },
      ]),
    ).toThrow(/test\.close.*test\.help/);
  });

  it('accepts the same keys in different scopes', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: ['Escape'], scope: 'review', command: 'test.back' },
        { keys: ['Escape'], scope: 'help', command: 'test.close' },
      ]),
    ).not.toThrow();
  });

  it('rejects a bind with no keys', () => {
    expect(() =>
      requireUnambiguousBinds([
        { keys: [], scope: 'forms', command: 'test.empty' },
      ]),
    ).toThrow(/test\.empty/);
  });
});
