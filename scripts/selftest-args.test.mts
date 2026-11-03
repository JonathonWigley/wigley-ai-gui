import { describe, expect, it } from 'vitest';
import {
  filterEnvOf,
  parseSelfTestArgs,
  SELFTEST_FILTER_ENV,
} from './selftest-args.mts';

describe('parseSelfTestArgs', () => {
  it.each([
    { argv: [], args: { plugins: [], groups: [] } },
    {
      argv: ['--plugin', 'settings', '--plugin', 'docs, forms'],
      args: { plugins: ['settings', 'docs', 'forms'], groups: [] },
    },
    {
      argv: ['--group', 'settings: keymap', '--group', 'side bar'],
      args: { plugins: [], groups: ['settings: keymap', 'side bar'] },
    },
    {
      argv: ['--group', 'docs: stars', '--plugin', 'usage'],
      args: { plugins: ['usage'], groups: ['docs: stars'] },
    },
  ])('reads $argv', ({ argv, args }) => {
    expect(parseSelfTestArgs(argv)).toEqual(args);
  });

  it.each([
    { argv: ['settings'], message: 'Unknown argument settings' },
    { argv: ['--plugins', 'settings'], message: 'Unknown argument --plugins' },
    { argv: ['--plugin'], message: '--plugin takes a value' },
    { argv: ['--group', '--plugin', 'x'], message: '--group takes a value' },
  ])('throws on $argv', ({ argv, message }) => {
    expect(() => parseSelfTestArgs(argv)).toThrow(message);
  });
});

describe('filterEnvOf', () => {
  it.each([
    { args: { plugins: [], groups: [] }, value: '' },
    {
      args: { plugins: ['settings'], groups: ['docs: stars'] },
      value: '{"plugins":["settings"],"groups":["docs: stars"]}',
    },
  ])('sets the filter variable for $args', ({ args, value }) => {
    expect(filterEnvOf(args)).toEqual({ [SELFTEST_FILTER_ENV]: value });
  });
});
