// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { assertType, describe, it } from 'vitest';
import type { PluginLog } from '../contracts/log';

describe('PluginLog', () => {
  it('types a plugin log so a source argument fails to compile', () => {
    const log = {} as PluginLog;

    // The body only type-checks: the log here is an empty fake.
    const typeChecksOnly = () => {
      assertType<PluginLog>((message: string) => log(message));
      // @ts-expect-error -- a plugin log takes no source
      log('p', 'hello');
    };
    assertType<() => void>(typeChecksOnly);
  });
});
