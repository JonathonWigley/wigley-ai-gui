import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutOwner, LayoutSet } from '../../contracts/layouts';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createLayoutService, type LayoutService } from './layout-service';

const FOLDER = '/c/layouts';
const KIT_TYPES = 'export interface BaseKit {}';
const CLONE = '/clone';
const FORMS_DEFAULT = `${CLONE}/src/plugins/forms/layouts/default`;

let files: MemoryFiles;
let sent: [LayoutOwner, LayoutSet][];

beforeEach(() => {
  files = createMemoryFiles();
  sent = [];
});

function createService(repoDir: string | null = null): LayoutService {
  return createLayoutService({
    files,
    paths: posixPaths,
    folder: FOLDER,
    repoDir,
    kitTypes: KIT_TYPES,
    send: (owner, set) => sent.push([owner, set]),
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
            { name: 'default', revision: 1, hasCss: false, builtIn: true },
            { name: 'f', revision: 1, hasCss: false, builtIn: false },
          ],
          changed: null,
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
    expect(set.changed).toBe('x');
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
          { name: 'default', revision: 1, hasCss: false, builtIn: true },
          { name: 'f', revision: 1, hasCss: false, builtIn: false },
        ],
        changed: null,
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

  it.each([
    {
      state: 'clone holds the default, listed',
      repoDir: CLONE,
      waitsForFirstSet: true,
      defaultBuiltIn: false,
      defaultFolderPath: FORMS_DEFAULT,
    },
    {
      state: 'clone holds the default, not yet listed',
      repoDir: CLONE,
      waitsForFirstSet: false,
      defaultBuiltIn: null,
      defaultFolderPath: FORMS_DEFAULT,
    },
    {
      state: 'no clone, listed',
      repoDir: null,
      waitsForFirstSet: true,
      defaultBuiltIn: true,
      defaultFolderPath: null,
    },
  ])(
    'register_DefaultFolder_ReadFromTheClone: $state',
    async ({
      repoDir,
      waitsForFirstSet,
      defaultBuiltIn,
      defaultFolderPath,
    }) => {
      await files.write(`${FORMS_DEFAULT}/layout.js`, '// live default');
      const service = createService(repoDir);

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
});
