import { describe, expect, it } from 'vitest';
import {
  claimPathsOverlap,
  matchesClaimPattern,
  normalizeClaimPath,
} from './claim-paths';

describe('matchesClaimPattern', () => {
  it.each([
    { pattern: 'src/**', path: 'src/a/b.ts', expected: true },
    { pattern: 'src/**/x.ts', path: 'src/x.ts', expected: true },
    { pattern: 'src/*.ts', path: 'src/a/b.ts', expected: false },
    { pattern: 'src/**.ts', path: 'src/a.ts', expected: true },
    { pattern: 'src/**.ts', path: 'src/a/b.ts', expected: false },
    { pattern: 'src/?.ts', path: 'src/a.ts', expected: true },
    { pattern: 'src/?.ts', path: 'src/ab.ts', expected: false },
    { pattern: 'a/b', path: 'a/b', expected: true },
    { pattern: 'a/b', path: 'a/bc', expected: false },
  ])('$pattern / $path → $expected', ({ pattern, path, expected }) => {
    expect(matchesClaimPattern(pattern, path)).toBe(expected);
  });
});

describe('claimPathsOverlap', () => {
  it.each([
    { a: ['a/b.ts'], b: ['a/b.ts'], expected: true },
    { a: ['a/b.ts'], b: ['a/c.ts'], expected: false },
    { a: ['src/**'], b: ['src/x/y.md'], expected: true },
    { a: ['src/a/**'], b: ['src/*.ts'], expected: true },
    { a: ['docs/**'], b: ['src/**'], expected: false },
    { a: ['x.ts', 'docs/**'], b: ['docs/a.md'], expected: true },
    { a: ['src/a'], b: ['src/a/x.ts'], expected: false },
    { a: ['src/a/**'], b: ['src/a/x.ts'], expected: true },
  ])('$a / $b → $expected', ({ a, b, expected }) => {
    expect(claimPathsOverlap(a, b)).toBe(expected);
    expect(claimPathsOverlap(b, a)).toBe(expected);
  });
});

describe('normalizeClaimPath', () => {
  it.each([
    { path: ' ./src/a.ts ', expected: 'src/a.ts' },
    { path: 'src\\a.ts', expected: 'src/a.ts' },
    { path: '/abs', expected: null },
    { path: 'C:/x', expected: null },
    { path: 'a/../b', expected: null },
    { path: '', expected: null },
    { path: 'a//b', expected: 'a/b' },
    { path: 'a/./b', expected: 'a/b' },
    { path: 'src/a/', expected: 'src/a' },
    { path: '.', expected: null },
    { path: './', expected: null },
  ])('$path → $expected', ({ path, expected }) => {
    expect(normalizeClaimPath(path)).toBe(expected);
  });
});
