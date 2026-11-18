import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../contracts/disposable';
import type { LayoutOwner, LayoutSet } from '../../contracts/layouts';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createLayoutService, type LayoutService } from './layout-service';

const FOLDER = '/c/layouts';
const KIT_TYPES = 'export interface BaseKit {}';
const CLONE = '/clone';
const FORMS_DEFAULT = `${CLONE}/src/plugins/forms/layouts/default`;
const USER_FOLDER = '/c/plugins/forms';
const USER_DEFAULT = `${USER_FOLDER}/layouts/default`;

let files: MemoryFiles;
let sent: [LayoutOwner, LayoutSet][];

beforeEach(() => {
  files = createMemoryFiles();
  sent = [];
});

// `userFolder` is the folder `userPluginFolder` returns for every owner; null
// for a service whose owners are all built in.
function createService(
  repoDir: string | null = null,
  userFolder: string | null = null,
  namesChanged: () => void = () => undefined,
): LayoutService {
  return createLayoutService({
    files,
    paths: posixPaths,
    folder: FOLDER,
    repoDir,
    userPluginFolder: () => userFolder,
    kitTypes: KIT_TYPES,
    send: (owner, set) => sent.push([owner, set]),
    namesChanged,
    log: () => undefined,
  });
}

function defaultFolderOf(owner: LayoutOwner): string {
  return `src/plugins/${owner}/layouts/default`;
}

function namesIn(set: LayoutSet): string[] {
  return set.layouts.map((entry) => entry.name);
}

// Registers `owner` and waits for its first set.
async function registered(service: LayoutService, owner: LayoutOwner) {
  const registration = service.register(
    owner,
    `// ${owner} types`,
    defaultFolderOf(owner),
  );
  await vi.waitFor(() =>
    expect(sent.some(([sentTo]) => sentTo === owner)).toBe(true),
  );
  return registration;
}

describe('createLayoutService', () => {
  it('create_WritesKitTypes', async () => {
    createService();

    await vi.waitFor(async () =>
      expect(await files.read(`${FOLDER}/kit.d.ts`)).toBe(KIT_TYPES),
    );
  });

  it('register_ListsOnlyItsOwnersFolder', async () => {
    await files.write(`${FOLDER}/forms/f/layout.js`, '// f');
    await files.write(`${FOLDER}/chat/c/layout.js`, '// c');
    const service = createService();

    await registered(service, 'forms');
    await registered(service, 'chat');

    expect(service.names('forms')).toEqual(['default', 'f']);
    expect(service.names('chat')).toEqual(['default', 'c']);
    expect(await files.read(`${FOLDER}/chat/layout.d.ts`)).toBe(
      '// chat types',
    );
  });

  it('register_SendsFirstSetWithOwner', async () => {
    await files.write(`${FOLDER}/forms/f/layout.js`, '// f');
    const service = createService();

    await registered(service, 'forms');

    expect(sent).toEqual([
      [
        'forms',
        {
          layouts: [
            {
              name: 'default',
              revision: 1,
              styleRevision: 1,
              hasCss: false,
              builtIn: true,
            },
            {
              name: 'f',
              revision: 1,
              styleRevision: 1,
              hasCss: false,
              builtIn: false,
            },
          ],
        },
      ],
    ]);
  });

  it('register_SameOwnerTwice_Throws', () => {
    const service = createService();
    service.register('forms', '', defaultFolderOf('forms'));

    expect(() =>
      service.register('forms', '', defaultFolderOf('forms')),
    ).toThrow('layouts of forms already registered');
  });

  it.each(['', 'a/b', '..', 'Forms'])(
    'register_BadOwner_Throws: %j',
    (owner) => {
      expect(() =>
        createService().register(owner, '', defaultFolderOf(owner)),
      ).toThrow(`${owner} is no layout owner`);
    },
  );

  it('save_SendsOnlyThatOwnersSet', async () => {
    const service = createService();
    await registered(service, 'forms');
    await registered(service, 'chat');
    sent = [];

    await files.write(`${FOLDER}/chat/x/layout.js`, '// x');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [[owner, set]] = sent;
    expect(owner).toBe('chat');
    expect(set.layouts.find((entry) => entry.name === 'x')?.revision).toBe(1);
  });

  it.each([
    {
      state: 'never registered',
      registration: 'none',
      names: ['default'],
      set: null,
      defaultFolderPath: null,
    },
    {
      state: 'registered but not listed',
      registration: 'unlisted',
      names: ['default'],
      set: null,
      defaultFolderPath: FORMS_DEFAULT,
    },
    {
      state: 'registration disposed',
      registration: 'disposed',
      names: ['default'],
      set: null,
      defaultFolderPath: null,
    },
    {
      state: 'listed',
      registration: 'listed',
      names: ['default', 'f'],
      defaultFolderPath: FORMS_DEFAULT,
      set: {
        layouts: [
          {
            name: 'default',
            revision: 1,
            styleRevision: 1,
            hasCss: false,
            builtIn: true,
          },
          {
            name: 'f',
            revision: 1,
            styleRevision: 1,
            hasCss: false,
            builtIn: false,
          },
        ],
      },
    },
  ] as const)(
    'names_And_read_FollowTheOwnersRegistration: $state',
    async ({ registration, names, set, defaultFolderPath }) => {
      await files.write(`${FOLDER}/forms/f/layout.js`, '// f');
      const service = createService(CLONE);
      if (registration === 'unlisted') {
        service.register('forms', '', defaultFolderOf('forms'));
      }
      if (registration === 'disposed') {
        (await registered(service, 'forms')).dispose();
      }
      if (registration === 'listed') {
        await registered(service, 'forms');
      }

      expect(service.names('forms')).toEqual(names);
      expect(await service.read('forms')).toEqual(set);
      expect(service.defaultFolderPath('forms')).toBe(defaultFolderPath);
    },
  );

  // Breaks if the user folder is ignored, or if no clone hides it.
  it.each([
    {
      state: 'clone holds the default, listed',
      repoDir: CLONE,
      userFolder: null,
      waitsForFirstSet: true,
      defaultBuiltIn: false,
      defaultFolderPath: FORMS_DEFAULT,
    },
    {
      state: 'clone holds the default, not yet listed',
      repoDir: CLONE,
      userFolder: null,
      waitsForFirstSet: false,
      defaultBuiltIn: null,
      defaultFolderPath: FORMS_DEFAULT,
    },
    {
      state: 'no clone, listed',
      repoDir: null,
      userFolder: null,
      waitsForFirstSet: true,
      defaultBuiltIn: true,
      defaultFolderPath: null,
    },
    {
      state: 'user plugin, clone present',
      repoDir: CLONE,
      userFolder: USER_FOLDER,
      waitsForFirstSet: true,
      defaultBuiltIn: false,
      defaultFolderPath: USER_DEFAULT,
    },
    {
      state: 'user plugin, no clone',
      repoDir: null,
      userFolder: USER_FOLDER,
      waitsForFirstSet: true,
      defaultBuiltIn: false,
      defaultFolderPath: USER_DEFAULT,
    },
  ])(
    'register_DefaultFolder_ReadFromTheUserFolderElseTheClone: $state',
    async ({
      repoDir,
      userFolder,
      waitsForFirstSet,
      defaultBuiltIn,
      defaultFolderPath,
    }) => {
      // The clone's default only for the built-in rows, so a user row that
      // read the clone would list a built-in default.
      const liveDefault = userFolder === null ? FORMS_DEFAULT : USER_DEFAULT;
      await files.write(`${liveDefault}/layout.js`, '// live default');
      const service = createService(repoDir, userFolder);

      if (waitsForFirstSet) {
        await registered(service, 'forms');
      } else {
        service.register('forms', '', defaultFolderOf('forms'));
      }

      const firstDefault = sent[0]?.[1].layouts.find(
        (entry) => entry.name === 'default',
      );
      expect(firstDefault?.builtIn ?? null).toBe(defaultBuiltIn);
      expect(service.defaultFolderPath('forms')).toBe(defaultFolderPath);
    },
  );

  // Breaks if a default folder made after load is never watched.
  it('register_DefaultFolder_ReadFromTheUserFolderElseTheClone: user plugin, no default folder on disk', async () => {
    const service = createService(CLONE, USER_FOLDER);
    await registered(service, 'forms');

    expect(await files.stat(USER_DEFAULT)).toMatchObject({ isFolder: true });
    sent = [];
    await files.write(`${USER_DEFAULT}/layout.js`, '// live default');

    await vi.waitFor(() =>
      expect(
        sent.at(-1)?.[1].layouts.find((entry) => entry.name === 'default')
          ?.builtIn,
      ).toBe(false),
    );
  });

  it('dispose_Registration_SendsNoMoreSetsAndFreesTheOwner', async () => {
    const service = createService();
    (await registered(service, 'forms')).dispose();
    sent = [];

    await files.write(`${FOLDER}/forms/x/layout.js`, '// x');
    await registered(service, 'forms');

    expect(sent.map(([, set]) => namesIn(set))).toEqual([['default', 'x']]);
  });

  it('dispose_RegistrationAfterServiceDispose_DoesNothing', async () => {
    const memory = files;
    let watchesDisposed = 0;
    files = {
      ...memory,
      watch: (folder, onChange, options) => {
        const watch = memory.watch(folder, onChange, options);
        return {
          dispose: () => {
            watchesDisposed++;
            watch.dispose();
          },
        };
      },
    };
    const service = createService();
    const registration = await registered(service, 'forms');
    service.dispose();
    const disposedByTheService = watchesDisposed;
    sent = [];

    expect(() => registration.dispose()).not.toThrow();
    expect(watchesDisposed).toBe(disposedByTheService);
    await files.write(`${FOLDER}/forms/x/layout.js`, '// x');
    expect(sent).toEqual([]);
    expect(() =>
      service.register('forms', '', defaultFolderOf('forms')),
    ).not.toThrow();
  });

  it('namesByOwner_ListsEveryRegisteredOwner', async () => {
    await files.write(`${FOLDER}/shell/compact/layout.js`, '// compact');
    await files.write(`${FOLDER}/docs/wide/layout.js`, '// wide');
    const service = createService();
    await registered(service, 'shell');

    service.register('docs', '', defaultFolderOf('docs'));

    expect(service.namesByOwner()).toEqual({
      shell: ['default', 'compact'],
      docs: ['default'],
    });
  });

  // Breaks if a first listing of only `default` tells, or if one that adds a
  // name does not.
  it.each<{ event: string; layouts: string[]; calls: number }>([
    { event: 'an owner with no layouts', layouts: [], calls: 0 },
    { event: 'an owner listing wide', layouts: ['wide'], calls: 1 },
  ])(
    'namesChanged_FirstListing_TellsOnlyWhenItDiffersFromDefault: $event',
    async ({ layouts, calls }) => {
      for (const name of layouts) {
        await files.write(`${FOLDER}/docs/${name}/layout.js`, `// ${name}`);
      }
      let told = 0;
      const service = createService(null, null, () => told++);

      await registered(service, 'docs');

      expect(told).toBe(calls);
    },
  );

  // Breaks if a revision of a held layout tells, if an add or remove does not,
  // or if a dispose by the service tells as a registration's dispose does.
  it.each<{
    event: string;
    act: (registration: Disposable, service: LayoutService) => unknown;
    sends: boolean;
    calls: number;
  }>([
    {
      event: 'a layout folder added',
      act: () => files.write(`${FOLDER}/docs/tall/layout.js`, '// tall'),
      sends: true,
      calls: 1,
    },
    {
      event: 'a new revision of a held layout',
      act: () => files.write(`${FOLDER}/docs/wide/layout.js`, '// wide 2'),
      sends: true,
      calls: 0,
    },
    {
      event: 'a layout removed',
      act: () => files.remove(`${FOLDER}/docs/wide/layout.js`),
      sends: true,
      calls: 1,
    },
    {
      event: 'the registration disposed',
      act: (registration) => registration.dispose(),
      sends: false,
      calls: 1,
    },
    {
      event: 'the service disposed',
      act: (_registration, service) => service.dispose(),
      sends: false,
      calls: 0,
    },
  ])(
    'namesChanged_TellsOnAddRemoveAndDisposeOnly: $event',
    async ({ act, sends, calls }) => {
      await files.write(`${FOLDER}/docs/wide/layout.js`, '// wide');
      let told = 0;
      const service = createService(null, null, () => told++);
      const registration = await registered(service, 'docs');
      told = 0;
      sent = [];

      await act(registration, service);

      if (sends) {
        await vi.waitFor(() => expect(sent).toHaveLength(1));
      }
      expect(told).toBe(calls);
    },
  );
});
