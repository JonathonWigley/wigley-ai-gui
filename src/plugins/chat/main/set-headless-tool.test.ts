import { describe, expect, it, vi } from 'vitest';
import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../contract';
import { SET_HEADLESS_TOOL, setHeadlessToolSession } from './set-headless-tool';

const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

function toolSession(owned: boolean, startHeadless: boolean) {
  const flags = new Map([['row-3', startHeadless]]);
  const setHeadless = vi.fn((sessionId: string, headless: boolean) => {
    flags.set(sessionId, headless);
  });
  const session = setHeadlessToolSession({
    owns: (sessionId) => owned && sessionId === 'row-3',
    setHeadless,
    log: () => undefined,
  })({
    id: 'row-3',
    info: {
      sessionId: 'host-3',
      projectDir: '/p',
      harness: 'claude',
      rowId: null,
    },
  });
  return { flags, setHeadless, session };
}

describe('set_headless', () => {
  it.each([
    {
      given: 'an owned row turned on',
      owned: true,
      startHeadless: false,
      args: { headless: true },
      flag: true,
      text: HEADLESS_NOTE,
    },
    {
      given: 'an owned headless row turned off',
      owned: true,
      startHeadless: true,
      args: { headless: false },
      flag: false,
      text: HEADLESS_OFF_NOTE,
    },
    {
      given: 'an owned headless row turned on again',
      owned: true,
      startHeadless: true,
      args: { headless: true },
      flag: true,
      text: HEADLESS_NOTE,
    },
    {
      given: 'a row chat does not own',
      owned: false,
      startHeadless: false,
      args: { headless: true },
      flag: false,
      text: null,
    },
    {
      given: 'a headless value that is not a boolean',
      owned: true,
      startHeadless: false,
      args: { headless: 'yes' },
      flag: false,
      text: null,
    },
  ])(
    'setHeadless_Call_SetsTheFlagAndReturnsItsLineOrRefuses_given $given',
    async ({ owned, startHeadless, args, flag, text }) => {
      const { flags, setHeadless, session } = toolSession(owned, startHeadless);

      const result = await session.call(SET_HEADLESS_TOOL.name, args, CONTEXT);

      expect(flags.get('row-3')).toBe(flag);
      if (text === null) {
        expect(result.isError).toBe(true);
        expect(setHeadless).not.toHaveBeenCalled();
        return;
      }
      expect(result.isError ?? false).toBe(false);
      expect(result.content[0]?.text).toBe(text);
    },
  );
});
