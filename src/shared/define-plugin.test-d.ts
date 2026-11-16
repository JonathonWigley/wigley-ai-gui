// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { assertType, describe, it } from 'vitest';
import type { CommandKey } from '../contracts/commands';
import type {
  ChannelShape,
  DependencyKey,
  MainApi,
  PageApi,
  PageStart,
  PluginManifest,
  SettingInfos,
} from '../contracts/plugin';
import { definePlugin } from './define-plugin';

const manifest = definePlugin({
  id: 'p',
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {
    go: { label: 'Go', group: 'Moves', runsIn: 'page' },
    quit: { label: 'Quit', group: 'App', runsIn: 'main' },
  },
  scopes: { view: 'In the view' },
  keys: {
    binds: [{ keys: 'g', scope: 'view', command: 'go' }],
    app: [{ accelerator: 'CommandOrControl+Q', command: 'quit' }],
  },
  settings: { delayMs: 400 },
  settingInfo: { delayMs: { label: 'Delay', description: 'The delay.' } },
  themeTokens: {},
});

describe('definePlugin', () => {
  it('types its manifest so misuse fails to compile', () => {
    // A page start needs a handler for every page command and no main one.
    assertType<PageStart<typeof manifest>>({ commands: { go: () => {} } });
    // @ts-expect-error -- `go` runs in the page and has no handler
    assertType<PageStart<typeof manifest>>({ commands: {} });

    definePlugin({
      ...manifest,
      keys: {
        // @ts-expect-error -- `goo` is not a declared command
        binds: [{ keys: 'g', scope: 'view', command: 'goo' }],
      },
    });
    definePlugin({
      ...manifest,
      keys: {
        // @ts-expect-error -- `veiw` is not a declared scope
        binds: [{ keys: 'g', scope: 'veiw', command: 'go' }],
      },
    });
    definePlugin({
      ...manifest,
      keys: {
        // @ts-expect-error -- `quit` runs in main, not the page
        binds: [{ keys: 'q', scope: 'view', command: 'quit' }],
      },
    });
    definePlugin({
      ...manifest,
      keys: {
        // @ts-expect-error -- `go` runs in the page, not main
        app: [{ accelerator: 'CommandOrControl+G', command: 'go' }],
      },
    });

    // The id keeps its literal type, and settings their plain types rather
    // than their literal defaults.
    assertType<'p'>(manifest.id);
    assertType<(typeof manifest)['settings']>({ delayMs: 5 });

    definePlugin({
      ...manifest,
      // @ts-expect-error -- `delayMs` has no declaration
      settingInfo: {},
    });
    definePlugin({
      ...manifest,
      settingInfo: {
        delayMs: { label: 'Delay', description: 'The delay.' },
        // @ts-expect-error -- `delay` is no setting
        delay: { label: 'Delay', description: 'The delay.' },
      },
    });
    definePlugin({
      ...manifest,
      settings: {},
      settingInfo: {
        // @ts-expect-error -- the plugin has no settings to declare
        delayMs: { label: 'Delay', description: 'The delay.' },
      },
    });
    definePlugin({
      ...manifest,
      settingControls: {
        delayMs: 'number',
        // @ts-expect-error -- `delay` is no setting
        delay: 'number',
      },
    });

    // A nested setting and an array setting are declared by their leaf
    // paths exactly: a missing path fails, and so does an extra one.
    const info = { label: 'L', description: 'D.' };
    assertType<
      SettingInfos<{
        window: { width: number };
        fonts: { ui?: string };
        list: { x: number }[];
      }>
    >({ 'window.width': info, 'fonts.ui': info, list: info });
  });

  it('requires reads, as dependsOn', () => {
    // @ts-expect-error -- `reads` is missing
    definePlugin({
      id: 'r',
      dependsOn: { main: [], page: [] },
      commands: {},
      scopes: {},
      settings: {},
      settingInfo: {},
      themeTokens: {},
    });
  });

  it('types dependency keys so a wrong process or an undeclared id fails to compile', () => {
    const q = definePlugin({
      ...manifest,
      id: 'q',
      dependsOn: { main: [], page: ['a'] },
      reads: { main: [], page: [] },
    });
    const pageApi = {} as PageApi<typeof q, ChannelShape>;
    const mainApi = {} as MainApi<typeof q, ChannelShape>;
    const aPageKey: DependencyKey<{ n: number }, 'page', 'a'> = {
      id: 'a',
      process: 'page',
    };
    const aMainKey: DependencyKey<{ n: number }, 'main', 'a'> = {
      id: 'a',
      process: 'main',
    };
    const bPageKey: DependencyKey<{ n: number }, 'page', 'b'> = {
      id: 'b',
      process: 'page',
    };

    // The body only type-checks: the APIs here are empty fakes.
    const typeChecksOnly = () => {
      assertType<{ n: number }>(pageApi.dependency(aPageKey));
      // @ts-expect-error -- a main key on the page
      pageApi.dependency(aMainKey);
      // @ts-expect-error -- `b` is not in dependsOn.page
      pageApi.dependency(bPageKey);
      // @ts-expect-error -- dependsOn.main is empty
      mainApi.dependency(aMainKey);
      // @ts-expect-error -- a plugin id string is no key
      pageApi.dependency('a');
      // @ts-expect-error -- a plugin id string is no key
      mainApi.dependency('a');
    };
    assertType<() => void>(typeChecksOnly);
  });

  it('types a command argument from its declaration', () => {
    const withArgs = definePlugin({
      ...manifest,
      commands: {
        go: { label: 'Go', group: 'Moves', runsIn: 'page' },
        pick: { label: 'Pick', group: 'Moves', runsIn: 'page', arg: 'number' },
        place: {
          label: 'Place',
          group: 'Moves',
          runsIn: 'page',
          arg: { x: 'number', name: 'string' },
        },
      },
      keys: {},
    });
    assertType<PageStart<typeof withArgs>>({
      commands: {
        go: (context) => assertType<undefined>(context.arg),
        pick: (context) => assertType<number>(context.arg),
        place: (context) => {
          assertType<number>(context.arg.x);
          assertType<string>(context.arg.name);
        },
      },
    });
    assertType<PageStart<typeof withArgs>>({
      commands: {
        go: () => {},
        // @ts-expect-error -- `pick` takes a number
        pick: (context) => assertType<string>(context.arg),
        place: () => {},
      },
    });

    // The body only type-checks: the API here is an empty fake.
    const pageApi = {} as PageApi<PluginManifest, ChannelShape>;
    const formsChooseCommand: CommandKey<number> = { id: 'forms.choose' };
    const typeChecksOnly = async () => {
      await pageApi.commands.run(formsChooseCommand, 2);
      // @ts-expect-error -- `forms.choose` takes a number
      await pageApi.commands.run(formsChooseCommand, 'x');
    };
    assertType<() => Promise<void>>(typeChecksOnly);
  });
});
