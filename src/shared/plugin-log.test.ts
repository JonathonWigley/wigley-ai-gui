import { describe, expect, it } from 'vitest';
import type { PluginLog } from '../contracts/log';
import { pluginLog } from './plugin-log';

describe('pluginLog', () => {
  it.each<{ call: (log: PluginLog) => void; expected: string[][] }>([
    { call: (log) => log('hello'), expected: [['p', 'hello']] },
    { call: (log) => log('relay', 'hello'), expected: [['relay', 'hello']] },
  ])("logs a plugin's line under $expected", ({ call, expected }) => {
    const logged: string[][] = [];

    call(pluginLog((source, message) => logged.push([source, message]), 'p'));

    expect(logged).toEqual(expected);
  });
});
