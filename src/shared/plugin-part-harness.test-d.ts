// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { assertType, describe, it } from 'vitest';
import type { Disposable } from '../contracts/disposable';
import type { DependencyKey, MainApi, PageApi } from '../contracts/plugin';
import { definePlugin } from './define-plugin';
import {
  fakeDependency,
  type MainPartHarnessOptions,
} from './plugin-part-harness.test-support';

const manifest = definePlugin({
  id: 'sample',
  dependsOn: { main: ['dep'], page: ['dep'] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const depMainKey: DependencyKey<{ add(): Disposable }, 'main', 'dep'> = {
  id: 'dep',
  process: 'main',
};
const depPageKey: DependencyKey<{ ping(): string }, 'page', 'dep'> = {
  id: 'dep',
  process: 'page',
};

describe('plugin part harness types', () => {
  it('rejects a fake of the other process or of the wrong shape', () => {
    assertType<MainPartHarnessOptions<typeof manifest>>({
      dependencies: [
        fakeDependency(depMainKey, (consumer) => ({
          add: () => consumer.track({ dispose() {} }),
        })),
      ],
    });
    assertType<MainPartHarnessOptions<typeof manifest>>({
      dependencies: [
        // @ts-expect-error -- a page key is no main dependency
        fakeDependency(depPageKey, () => ({ ping: () => 'pong' })),
      ],
    });
    // @ts-expect-error -- `add` is no method returning a handle
    fakeDependency(depMainKey, () => ({ add: 1 }));
  });

  it('takes only a key in the API dependency', () => {
    assertType<(api: MainApi<typeof manifest, any, any, any>) => void>(
      (api) => {
        api.dependency(depMainKey);
        // @ts-expect-error -- a string id is not a key
        api.dependency('dep');
      },
    );
    assertType<(api: PageApi<typeof manifest, any, any, any>) => void>(
      (api) => {
        api.dependency(depPageKey);
        // @ts-expect-error -- a string id is not a key
        api.dependency('dep');
      },
    );
  });
});
