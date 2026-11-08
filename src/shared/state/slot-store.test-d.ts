// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { describe, expectTypeOf, it } from 'vitest';
import {
  type CoreEvents,
  coreModeSlot,
  coreWindowFocusedSlot,
} from '../../contracts/core-state';
import type {
  ChannelShape,
  MainApi,
  PageApi,
  QualifiedEvents,
} from '../../contracts/plugin';
import type { KeyedSlotKey, ListSlotKey, SlotKey } from '../../contracts/state';
import { definePlugin } from '../define-plugin';

const manifest = definePlugin({
  id: 'p',
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: ['dep'], page: [] },
  reads: { main: ['soft'], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

declare const api: MainApi<typeof manifest, ChannelShape>;
declare const pageApi: PageApi<typeof manifest, ChannelShape>;
declare const hearingPageApi: PageApi<
  typeof manifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'core', CoreEvents>
>;

declare function ownKey<V>(): SlotKey<V, 'main', 'p'>;
declare const own: SlotKey<number, 'main', 'p'>;
declare const ownKeyed: KeyedSlotKey<number, 'main', 'p'>;
declare const ownList: ListSlotKey<{ id: string }, 'main', 'p'>;
declare const ownOnPage: SlotKey<number, 'page', 'p'>;
declare const ofDep: SlotKey<number, 'main', 'dep'>;
declare const ofSoft: KeyedSlotKey<number, 'main', 'soft'>;
declare const ofCore: SlotKey<string, 'page', 'core'>;
declare const ofOther: SlotKey<number, 'main', 'other'>;
declare const softOnPage: SlotKey<number, 'main', 'soft'>;

class WithMethod {
  n = 1;
  twice() {
    return 2;
  }
}

describe('PluginState', () => {
  it('types its keys so misuse fails to compile', () => {
    // The body only type-checks: the APIs here are never made.
    const typeChecksOnly = () => {
      api.state.publish(ownKey<string>());
      api.state.publish(ownKey<{ a: { b: number[] }; c?: string }>());
      api.state.publish(ownKey<{ a: string }[]>());
      api.state.publish(ownKey<{ raw: unknown[] }>());
      api.state.publish(ownKeyed).set('k', 1);
      api.state.publish(ownList).put('k', { id: 'a' });

      // @ts-expect-error -- a function is no JSON
      api.state.publish(ownKey<() => void>());
      // @ts-expect-error -- a Map is no JSON
      api.state.publish(ownKey<Map<string, number>>());
      // @ts-expect-error -- a Set is no JSON
      api.state.publish(ownKey<Set<string>>());
      // @ts-expect-error -- a class with a method is no JSON
      api.state.publish(ownKey<WithMethod>());
      // @ts-expect-error -- a required member may be undefined
      api.state.publish(ownKey<{ a: string | undefined }>());

      // @ts-expect-error -- another plugin's key
      api.state.publish(ofDep);
      // @ts-expect-error -- a key of the other process
      api.state.publish(ownOnPage);

      api.state.read(own);
      api.state.read(ofDep);
      api.state.read(ofSoft).all();
      api.state.read(ofCore);
      pageApi.state.read(ofCore);
      // @ts-expect-error -- not in dependsOn or reads
      api.state.read(ofOther);
      // @ts-expect-error -- `soft` is in reads.main only
      pageApi.state.read(softOnPage);

      expectTypeOf(pageApi.state.read(coreModeSlot).get()).toEqualTypeOf<
        string | undefined
      >();
      expectTypeOf(api.state.read(coreWindowFocusedSlot).get()).toEqualTypeOf<
        boolean | undefined
      >();
      // @ts-expect-error -- a core key is the core's to publish
      pageApi.state.publish(coreModeSlot);
      // @ts-expect-error -- a core key is the core's to publish
      api.state.publish(coreWindowFocusedSlot);
      hearingPageApi.events.on('core.pageReady', (data) =>
        expectTypeOf(data).toEqualTypeOf<null>(),
      );
    };
    return typeChecksOnly;
  });
});
