import { describe, expect, it } from 'vitest';
import { pluginLog } from './plugin-log';

describe('pluginLog', () => {
  it("logs a plugin's line under its id", () => {
    const logged: string[][] = [];

    pluginLog(
      (source, message) => logged.push([source, message]),
      'p',
    )('hello');

    expect(logged).toEqual([['p', 'hello']]);
  });
});
