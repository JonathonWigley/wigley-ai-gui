import { describe, expect, it } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type {
  PluginPartsReply,
  PluginPartsRequest,
} from '../../contracts/bridge';
import type { PluginStatus } from '../../contracts/core-state';
import type {
  MainPart,
  MainStart,
  PluginManifest,
} from '../../contracts/plugin';
import type {
  CatalogEntry,
  CatalogProblem,
  PluginOrigin,
} from '../../contracts/plugin-catalog';
import { createAppliedPlugins } from './applied-plugins';
import {
  createPluginSwitch,
  heldAtStart,
  PLUGIN_RETRY_MS,
  type PluginSwitchDeps,
} from './plugin-switch';

function manifest(
  id: string,
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id,
    label: id,
    description: 'A test plugin.',
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
    ...overrides,
  };
}

function mainPart(of: PluginManifest): MainPart {
  return { manifest: of, start: () => ({ commands: {} }) };
}

interface EntryOptions {
  origin?: PluginOrigin;
  revision?: number;
  hasMain?: boolean;
  manifest?: Partial<PluginManifest>;
}

// A catalog entry: a built-in with a main part unless the options say else.
function entry(id: string, options: EntryOptions = {}): CatalogEntry {
  const shown = manifest(id, options.manifest);
  const origin = options.origin ?? 'built-in';
  return {
    manifest: shown,
    origin,
    revision: options.revision ?? (origin === 'built-in' ? 0 : 1),
    main: options.hasMain === false ? null : mainPart(shown),
    pageUrl: null,
    folder: origin === 'built-in' ? null : `/plugins/${id}`,
  };
}

function user(id: string, options: EntryOptions = {}): CatalogEntry {
  return entry(id, { origin: 'user', ...options });
}

const REFUSAL = 'forms: a round is open in s1';
const PROBLEM =
  '"plugins.disabled" names "forms", which cannot stop now: a round is open in s1';

interface SetupOptions {
  manifests?: readonly PluginManifest[];
  // The catalog's and the config's entries at creation; built-ins of
  // `manifests` when left out.
  entries?: readonly CatalogEntry[];
  applied?: readonly string[];
  // `configDisabled()`; `applied` when left out.
  disabled?: readonly string[];
}

// A switch over a fake main host and a fake page, each pushing
// `<side> <kind> <ids>` to `calls`, with the applied list, `clearOwner`,
// `servedChanged` and the config's `setPlugins` pushing to the same list.
// `main` and `page` hold what the fakes answer, and a test changes them
// between calls. A refusal answers only for a request naming its id, and a
// main stop forgets each part it replies with even when it rejects, as the
// host does. `page.mayStopHold` holds a page `mayStop` and `page.hold` a page
// stop. A page start naming `page.startRejects` rejects after it is pushed;
// `page.startProblems` are the start reply's problems for the ids it names,
// and `page.reloadProblem` the reload reply's problem. `setPaused` pushes
// `paused <ids>`. `main.startErrors` holds, by id, the messages its next
// starts throw, one per start; `main.commands` the handlers a started part
// returns. A main remove stops the started part and its started direct
// dependents, dependents first. The catalog fake fires `onChanged` through
// `change`. The config fake admits what `setPlugins` hands, except an id in
// `config.refused`, for which it keeps the entry it held and serves
// `config.refusals[id]` as its problem.
function setup({
  manifests = [],
  entries = manifests.map((each) => entry(each.id, { manifest: each })),
  applied: initial = [],
  disabled = initial,
}: SetupOptions) {
  const calls: string[] = [];
  const logs: string[] = [];
  const problems: (string | null)[] = [];
  const statuses: (readonly PluginStatus[])[] = [];
  const handedProblems: (readonly CatalogProblem[])[] = [];
  const handed: (readonly CatalogEntry[])[] = [];
  const timers: { run(): void; ms: number }[] = [];
  const cleared: number[] = [];
  const known = new Map(entries.map((each) => [each.manifest.id, each]));
  const started = new Map<string, MainStart<PluginManifest>>(
    entries
      .filter(
        (each) => each.main !== null && !initial.includes(each.manifest.id),
      )
      .map((each) => [each.manifest.id, { commands: {} }]),
  );
  const main = {
    refusal: null as string | null,
    stopReply: null as string[] | null,
    stopRejects: null as string | null,
    startThrowsAt: null as string | null,
    startErrors: {} as Record<string, string[]>,
    commands: {} as Record<string, object>,
  };
  const page = {
    refusal: null as string | null,
    stopReply: null as string[] | null,
    hold: null as Promise<void> | null,
    mayStopHold: null as Promise<void> | null,
    startRejects: null as string | null,
    startProblems: [] as CatalogProblem[],
    reloadProblem: null as string | null,
  };
  const catalog = {
    entries: [...entries],
    problems: [] as CatalogProblem[],
    listeners: new Set<() => void>(),
    change(next: readonly CatalogEntry[], nextProblems: CatalogProblem[] = []) {
      catalog.entries = [...next];
      catalog.problems = nextProblems;
      for (const listener of catalog.listeners) {
        listener();
      }
    },
  };
  const config = {
    admitted: [...entries] as readonly CatalogEntry[],
    refused: [] as string[],
    refusals: {} as Record<string, string>,
  };
  const configDisabled = { list: disabled };
  const applied = createAppliedPlugins(initial);
  const fakeTimers: Timers = {
    set(run, ms) {
      timers.push({ run, ms });
      return timers.length;
    },
    clear(handle) {
      cleared.push(handle);
    },
  };
  const refusalFor = (refusal: string | null, ids: readonly string[]) =>
    refusal !== null && ids.includes(refusal.slice(0, refusal.indexOf(':')))
      ? refusal
      : null;
  const deps: PluginSwitchDeps = {
    main: {
      started,
      mayStop(ids) {
        calls.push(`main mayStop ${ids.join(',')}`);
        return refusalFor(main.refusal, ids);
      },
      async stop(id) {
        calls.push(`main stop ${id}`);
        const stopped = main.stopReply ?? [id];
        for (const each of stopped) {
          started.delete(each);
        }
        if (main.stopRejects === id) {
          throw new Error(`stop of ${id} failed`);
        }
        return stopped;
      },
      start(ids) {
        calls.push(`main start ${ids.join(',')}`);
        for (const id of ids) {
          if (main.startThrowsAt === id) {
            throw new Error(`start of ${id} failed`);
          }
          const error = main.startErrors[id]?.shift();
          if (error !== undefined) {
            throw new Error(error);
          }
          started.set(id, {
            commands: main.commands[id] ?? {},
          } as MainStart<PluginManifest>);
        }
      },
      add(part) {
        calls.push(`main add ${part.manifest.id}`);
      },
      async remove(id) {
        calls.push(`main remove ${id}`);
        if (!started.has(id)) {
          return [];
        }
        const dependents = [...started.keys()].filter((each) =>
          known.get(each)?.manifest.dependsOn.main.includes(id),
        );
        const stopped = [...dependents.reverse(), id];
        for (const each of stopped) {
          started.delete(each);
        }
        return stopped;
      },
    },
    async page(request: PluginPartsRequest): Promise<PluginPartsReply> {
      if (request.kind === 'reload' || request.kind === 'remove') {
        calls.push(`page ${request.kind} ${request.id}`);
        return request.kind === 'reload'
          ? { reloaded: [request.id], problem: page.reloadProblem }
          : { stopped: [request.id] };
      }
      calls.push(`page ${request.kind} ${request.ids.join(',')}`);
      if (request.kind === 'mayStop') {
        await page.mayStopHold;
        return { reason: refusalFor(page.refusal, request.ids) };
      }
      if (request.kind === 'stop') {
        await page.hold;
        return { stopped: page.stopReply ?? request.ids };
      }
      if (
        page.startRejects !== null &&
        request.ids.includes(page.startRejects)
      ) {
        throw new Error(`page start of ${page.startRejects} failed`);
      }
      return {
        started: request.ids,
        problems: page.startProblems.filter(({ id }) =>
          request.ids.includes(id),
        ),
      };
    },
    applied: {
      disabled: () => applied.disabled(),
      set(disabled) {
        calls.push(`applied ${disabled.join(',')}`);
        applied.set(disabled);
      },
      paused: () => applied.paused(),
      setPaused(ids) {
        calls.push(`paused ${ids.join(',')}`.trimEnd());
        applied.setPaused(ids);
      },
    },
    slots: { clearOwner: (id) => calls.push(`clearOwner ${id}`) },
    status: {
      get: () => statuses.at(-1),
      set: (value) => statuses.push(value),
      dispose() {},
    },
    catalog: {
      entries: () => catalog.entries,
      problems: () => catalog.problems,
      onChanged(listener) {
        const fire = () => listener({ added: [], removed: [], reloaded: [] });
        catalog.listeners.add(fire);
        return { dispose: () => catalog.listeners.delete(fire) };
      },
    },
    config: {
      plugins: () => config.admitted,
      async setPlugins(next) {
        calls.push('setPlugins');
        handed.push(next);
        for (const each of next) {
          known.set(each.manifest.id, each);
        }
        config.admitted = next.flatMap((each) => {
          if (!config.refused.includes(each.manifest.id)) {
            return [each];
          }
          return config.admitted.filter(
            (held) => held.manifest.id === each.manifest.id,
          );
        });
      },
      pluginProblems: () =>
        Object.entries(config.refusals).map(([id, message]) => ({
          id,
          message,
        })),
      setPluginProblems: (next) => handedProblems.push(next),
    },
    configDisabled: () => configDisabled.list,
    problem: (message) => problems.push(message),
    servedChanged: () => calls.push('servedChanged'),
    timers: fakeTimers,
    log: (source, message) => logs.push(`[${source}] ${message}`),
  };
  const pluginSwitch = createPluginSwitch(deps);
  // The status row of `id` in the last status written.
  const row = (id: string) => statuses.at(-1)?.find((each) => each.id === id);
  return {
    pluginSwitch,
    calls,
    logs,
    problems,
    statuses,
    row,
    timers,
    cleared,
    main,
    page,
    catalog,
    config,
    configDisabled,
    handed,
    handedProblems,
  };
}

// The calls a catalog change to `next` makes, once the launch job settled.
async function changeCatalog(
  switched: ReturnType<typeof setup>,
  next: readonly CatalogEntry[],
  problems: CatalogProblem[] = [],
): Promise<string[]> {
  await switched.pluginSwitch.settled();
  const before = switched.calls.length;
  switched.catalog.change(next, problems);
  await switched.pluginSwitch.settled();
  return switched.calls.slice(before);
}

// A promise for `page.hold` and the call that settles it.
function heldPage(): { hold: Promise<void>; release(): void } {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

const GALLERY = [manifest('gallery'), manifest('notes')];
const FORMS = [manifest('forms', { label: 'Forms' }), manifest('notes')];

describe('createPluginSwitch', () => {
  it.each([
    {
      case: 'off',
      applied: [],
      disabled: ['gallery'],
      calls: [
        'main mayStop gallery',
        'page mayStop gallery',
        'applied gallery',
        'servedChanged',
        'page stop gallery',
        'main stop gallery',
        'clearOwner gallery',
      ],
      logs: ['[plugin-switch] off gallery'],
    },
    {
      case: 'on',
      applied: ['gallery'],
      disabled: [],
      calls: [
        'main start gallery',
        'applied ',
        'servedChanged',
        'page start gallery',
      ],
      logs: ['[plugin-switch] on gallery'],
    },
  ])('apply_OffOrOn_CallsEachSideInOrder: $case', async (row) => {
    const { pluginSwitch, calls, logs } = setup({
      manifests: GALLERY,
      applied: row.applied,
    });

    const result = await pluginSwitch.apply(row.disabled);

    expect(result).toBe(null);
    expect(calls).toEqual(row.calls);
    expect(logs).toEqual(row.logs);
  });

  it.each([
    { case: 'main refuses', side: 'main' as const },
    { case: 'page refuses', side: 'page' as const },
  ])(
    'apply_MayStopRefuses_ChangesNothingAndSetsTheProblem: $case',
    async ({ side }) => {
      const switched = setup({ manifests: FORMS });
      switched[side].refusal = REFUSAL;

      const result = await switched.pluginSwitch.apply(['forms']);

      expect(result).toBe(REFUSAL);
      expect(
        switched.calls.filter(
          (call) =>
            call.startsWith('applied') ||
            call.includes(' stop ') ||
            call.startsWith('clearOwner'),
        ),
      ).toEqual([]);
      expect(switched.problems).toEqual([PROBLEM]);
      expect(switched.logs).toEqual([
        '[plugin-switch] refused forms: a round is open in s1',
      ]);
    },
  );

  it('apply_SameRefusalTwice_LogsOnce', async () => {
    const { pluginSwitch, page, logs } = setup({ manifests: FORMS });
    page.refusal = REFUSAL;

    await pluginSwitch.apply(['forms']);
    await pluginSwitch.apply(['forms']);

    expect(logs).toEqual([
      '[plugin-switch] refused forms: a round is open in s1',
    ]);
  });

  it('apply_AfterARefusal_ClearsTheProblem', async () => {
    const { pluginSwitch, page, problems } = setup({ manifests: FORMS });
    page.refusal = REFUSAL;
    await pluginSwitch.apply(['forms']);
    page.refusal = null;

    await pluginSwitch.apply(['forms']);

    expect(problems).toEqual([PROBLEM, null]);
  });

  it('apply_OffAndOn_RunsStepsTwoToFive', async () => {
    const { pluginSwitch, calls } = setup({
      manifests: [manifest('a'), manifest('b')],
      applied: ['b'],
    });

    await pluginSwitch.apply(['a']);

    expect(calls).toEqual([
      'main mayStop a',
      'page mayStop a',
      'applied b,a',
      'servedChanged',
      'page stop a',
      'main stop a',
      'clearOwner a',
      'main start b',
      'applied a',
      'servedChanged',
      'page start b',
    ]);
  });

  it.each([
    {
      case: 'main stop rejects on the first id',
      applied: [],
      disabled: ['a', 'b'],
      fail: { stopRejects: 'a' },
      tail: ['main stop a', 'main stop b', 'clearOwner a', 'clearOwner b'],
    },
    {
      case: 'main start throws after starting a',
      applied: ['a', 'b'],
      disabled: [],
      fail: { startThrowsAt: 'b' },
      tail: ['main start a,b', 'main stop a'],
    },
  ])('apply_StepFails_LeavesNoPartHalfOn: $case', async (row) => {
    const switched = setup({
      manifests: [manifest('a'), manifest('b')],
      applied: row.applied,
    });
    Object.assign(switched.main, row.fail);

    await expect(switched.pluginSwitch.apply(row.disabled)).rejects.toThrow(
      /failed$/,
    );

    expect(switched.calls.slice(-row.tail.length)).toEqual(row.tail);
  });

  it('apply_Refused_RetriesOnTheTimer', async () => {
    const { pluginSwitch, page, timers, problems, calls } = setup({
      manifests: FORMS,
    });
    page.refusal = REFUSAL;
    await pluginSwitch.apply(['forms']);
    const timersAtRefusal = timers.map(({ ms }) => ms);
    page.refusal = null;

    timers[0].run();

    await expect.poll(() => problems.at(-1)).toBe(null);
    expect(timersAtRefusal).toEqual([PLUGIN_RETRY_MS]);
    expect(calls).toContain('main stop forms');
  });

  it('apply_NewerApplyBeforeTheRetry_RetriesTheNewerList', async () => {
    const { pluginSwitch, page, timers, calls } = setup({ manifests: FORMS });
    page.refusal = REFUSAL;
    const held = heldPage();
    page.hold = held.hold;
    const refused = pluginSwitch.apply(['forms']);
    const newer = pluginSwitch.apply(['notes']);
    await refused;
    await expect.poll(() => calls.at(-1)).toBe('page stop notes');
    page.refusal = null;

    timers[0].run();
    held.release();
    await newer;
    await pluginSwitch.apply(['notes']);

    expect(calls).not.toContain('main stop forms');
    expect(calls.filter((call) => call.startsWith('applied'))).toEqual([
      'applied notes',
    ]);
  });

  it('apply_Overlapping_RunsOneAtATime', async () => {
    const { pluginSwitch, page, calls } = setup({ manifests: GALLERY });
    const { hold, release } = heldPage();
    page.hold = hold;
    const first = pluginSwitch.apply(['gallery']);
    await expect.poll(() => calls.at(-1)).toBe('page stop gallery');

    const second = pluginSwitch.apply([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsWhileHeld = [...calls];
    release();
    await first;
    await second;

    expect(callsWhileHeld.at(-1)).toBe('page stop gallery');
    expect(calls.slice(callsWhileHeld.length)).toEqual([
      'main stop gallery',
      'clearOwner gallery',
      'main start gallery',
      'applied ',
      'servedChanged',
      'page start gallery',
    ]);
  });

  it.each([
    { case: 'unknown id', disabled: ['zzz'] },
    { case: 'no change', disabled: [] },
  ])('apply_UnknownIdOrNoChange_DoesNothing: $case', async ({ disabled }) => {
    const { pluginSwitch, calls } = setup({ manifests: GALLERY });

    const result = await pluginSwitch.apply(disabled);

    expect(result).toBe(null);
    expect(calls).toEqual([]);
  });

  it('status_AfterApply_HoldsEachPlugin', async () => {
    const { pluginSwitch, statuses } = setup({
      manifests: [
        manifest('usage', { label: 'Usage', description: 'Counts usage.' }),
        manifest('usage-tab-line', {
          label: 'Usage tab line',
          description: 'Shows usage on the tab.',
          dependsOn: { main: [], page: ['usage'] },
        }),
      ],
    });
    const atCreation = statuses.at(-1);

    await pluginSwitch.apply(['usage-tab-line']);

    expect(atCreation).toEqual([
      {
        id: 'usage',
        label: 'Usage',
        description: 'Counts usage.',
        on: true,
        neededBy: ['usage-tab-line'],
        origin: 'built-in',
        problem: null,
      },
      {
        id: 'usage-tab-line',
        label: 'Usage tab line',
        description: 'Shows usage on the tab.',
        on: true,
        neededBy: [],
        origin: 'built-in',
        problem: null,
      },
    ]);
    expect(
      statuses.at(-1)?.map(({ id, on, neededBy }) => ({ id, on, neededBy })),
    ).toEqual([
      { id: 'usage', on: true, neededBy: [] },
      { id: 'usage-tab-line', on: false, neededBy: [] },
    ]);
  });

  const STARTED_A = [entry('a')];

  it.each([
    {
      case: 'no main part',
      added: [user('u', { hasMain: false })],
      calls: [
        'applied u',
        'setPlugins',
        'applied ',
        'servedChanged',
        'page start u',
      ],
      row: { on: true, problem: null },
    },
    {
      case: 'main and page parts',
      added: [user('u')],
      calls: [
        'applied u',
        'setPlugins',
        'main add u',
        'main start u',
        'applied ',
        'servedChanged',
        'page start u',
      ],
      row: { on: true, problem: null },
    },
    {
      case: 'named by plugins.disabled',
      disabled: ['u'],
      added: [user('u')],
      calls: ['applied u', 'setPlugins', 'main add u'],
      row: { on: false, problem: null },
    },
    {
      case: 'dependency not started',
      applied: ['a'],
      added: [
        user('u', { manifest: { dependsOn: { main: ['a'], page: [] } } }),
      ],
      calls: ['applied a,u', 'setPlugins', 'main add u'],
      row: { on: false, problem: 'Needs plugin "a", which did not start' },
    },
    {
      case: 'refused by the config',
      refused: true,
      added: [user('u')],
      calls: ['applied u', 'setPlugins'],
      row: { on: false, problem: 'Command "u.go" is declared twice' },
    },
    {
      case: 'the dependent first in catalog order',
      added: [
        user('u', { manifest: { dependsOn: { main: ['v'], page: [] } } }),
        user('v'),
      ],
      calls: [
        'applied u,v',
        'setPlugins',
        'main add v',
        'main start v',
        'applied u',
        'servedChanged',
        'page start v',
        'main add u',
        'main start u',
        'applied ',
        'servedChanged',
        'page start u',
      ],
      row: { on: true, problem: null },
    },
    {
      case: 'the page part fails',
      pageProblem: true,
      added: [user('u')],
      calls: [
        'applied u',
        'setPlugins',
        'main add u',
        'main start u',
        'applied ',
        'servedChanged',
        'page start u',
      ],
      row: { on: true, problem: 'Page part did not start: boom' },
    },
  ])('catalogChange_Added_StartsInOrder: $case', async (row) => {
    const switched = setup({
      entries: STARTED_A,
      applied: row.applied,
      disabled: row.disabled ?? row.applied,
    });
    if (row.refused === true) {
      switched.config.refused = ['u'];
      switched.config.refusals = { u: 'Command "u.go" is declared twice' };
    }
    if (row.pageProblem === true) {
      switched.page.startProblems = [
        { id: 'u', message: 'Page part did not start: boom' },
      ];
    }

    const calls = await changeCatalog(switched, [...STARTED_A, ...row.added]);

    expect(calls).toEqual(row.calls);
    const { on, problem } = switched.row('u') ?? {};
    expect({ on, problem }).toEqual(row.row);
  });

  it('catalogChange_Removed_StopsLikeASwitchOff', async () => {
    const a = entry('a');
    const switched = setup({ entries: [a, user('u')] });

    const calls = await changeCatalog(switched, [a]);

    expect(calls).toEqual([
      'applied u',
      'servedChanged',
      'page remove u',
      'main remove u',
      'clearOwner u',
      'setPlugins',
      'applied ',
    ]);
    expect(switched.logs).toEqual(['[plugin-switch] removed u']);
    expect(switched.row('u')).toBe(undefined);
  });

  const DEPENDS_ON_U = { dependsOn: { main: ['u'], page: [] } };

  it.each([
    {
      case: 'running with a dependent',
      before: [user('u'), user('d', { manifest: DEPENDS_ON_U })],
      after: [user('u', { revision: 2 }), 'd'],
      pageStopped: ['d', 'u'],
      calls: [
        'paused u,d',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'main start d',
        'paused',
        'servedChanged',
        'page reload u',
        'page start u,d',
      ],
      row: { origin: 'user', on: true, problem: null },
    },
    {
      case: 'off',
      before: [user('u')],
      applied: ['u'],
      after: [user('u', { revision: 2 })],
      calls: ['setPlugins', 'main remove u', 'main add u', 'page reload u'],
      row: { origin: 'user', on: false, problem: null },
    },
    {
      case: 'a replaced built-in',
      before: [entry('u')],
      after: [entry('u', { origin: 'replaces-built-in' })],
      calls: [
        'paused u',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'paused',
        'servedChanged',
        'page reload u',
        'page start u',
      ],
      row: { origin: 'replaces-built-in', on: true, problem: null },
    },
    {
      case: 'a page-only dependency',
      before: [
        user('p', { hasMain: false }),
        user('u', { manifest: { dependsOn: { main: [], page: ['p'] } } }),
      ],
      after: [
        'p',
        user('u', {
          revision: 2,
          manifest: { dependsOn: { main: [], page: ['p'] } },
        }),
      ],
      calls: [
        'paused u',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'paused',
        'servedChanged',
        'page reload u',
        'page start u',
      ],
      row: { origin: 'user', on: true, problem: null },
    },
  ])('catalogChange_Reloaded_RunsTheReloadOrder: $case', async (row) => {
    const switched = setup({ entries: row.before, applied: row.applied });
    switched.page.stopReply = row.pageStopped ?? null;
    const after = row.after.map((each) =>
      typeof each === 'string'
        ? (row.before.find((held) => held.manifest.id === each) as CatalogEntry)
        : each,
    );

    const calls = await changeCatalog(switched, after);

    expect(calls).toEqual(row.calls);
    const { origin, on, problem } = switched.row('u') ?? {};
    expect({ origin, on, problem }).toEqual(row.row);
    expect(switched.logs.at(-1)).toBe('[plugin-switch] reloaded u');
  });

  it('catalogChange_ReloadRefusedByConfig_StopsNothing', async () => {
    const switched = setup({ entries: [user('u')] });
    switched.config.refused = ['u'];
    switched.config.refusals = { u: 'Theme token "u.ink" clashes' };

    const calls = await changeCatalog(switched, [user('u', { revision: 2 })]);

    expect(calls).toEqual([
      'paused u',
      'servedChanged',
      'setPlugins',
      'paused',
      'servedChanged',
    ]);
    const { on, problem } = switched.row('u') ?? {};
    expect({ on, problem }).toEqual({
      on: true,
      problem: 'Theme token "u.ink" clashes',
    });
    expect(switched.logs).toEqual([
      '[plugin-switch] reload of u failed: Theme token "u.ink" clashes; the last good version runs',
    ]);
  });

  const GO_IN_MAIN = {
    commands: { go: { label: 'Go', group: 'U', runsIn: 'main' as const } },
  };

  it.each([
    {
      case: 'the new start throws',
      startErrors: ['boom'],
      calls: [
        'paused u,d',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'applied u',
        'applied u,d',
        'main remove u',
        'main add u',
        'setPlugins',
        'main start u',
        'applied d',
        'servedChanged',
        'main start d',
        'applied ',
        'servedChanged',
        'paused',
        'servedChanged',
        'page start u,d',
      ],
      u: { on: true, problem: 'Did not start: boom' },
      log: 'reload of u failed: Did not start: boom; the last good version runs',
    },
    {
      case: 'the handlers differ',
      next: { manifest: { ...GO_IN_MAIN } },
      calls: [
        'paused u,d',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'main stop u',
        'applied u',
        'applied u,d',
        'main remove u',
        'main add u',
        'setPlugins',
        'main start u',
        'applied d',
        'servedChanged',
        'main start d',
        'applied ',
        'servedChanged',
        'paused',
        'servedChanged',
        'page start u,d',
      ],
      u: { on: true, problem: 'Commands and handlers differ: missing go' },
      log: 'reload of u failed: Commands and handlers differ: missing go; the last good version runs',
    },
    {
      case: 'the last good start throws too',
      startErrors: ['first', 'second'],
      calls: [
        'paused u,d',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'applied u',
        'applied u,d',
        'main remove u',
        'main add u',
        'setPlugins',
        'main start u',
        'paused',
        'servedChanged',
      ],
      u: { on: false, problem: 'Did not start: first' },
      log: 'reload of u failed: Did not start: first; the last good version failed too: Did not start: second',
    },
    {
      case: 'the page cannot load the new page.js',
      reloadProblem: 'page.js failed: boom',
      calls: [
        'paused u,d',
        'servedChanged',
        'setPlugins',
        'page stop u',
        'main remove u',
        'main add u',
        'main start u',
        'main start d',
        'paused',
        'servedChanged',
        'page reload u',
        'page start u,d',
      ],
      u: { on: true, problem: 'page.js failed: boom' },
      log: 'reloaded u',
    },
  ])(
    'catalogChange_ReloadStartFails_RestartsTheLastGood: $case',
    async (row) => {
      const switched = setup({
        entries: [user('u'), user('d', { manifest: DEPENDS_ON_U })],
      });
      switched.page.stopReply = ['d', 'u'];
      switched.main.startErrors = { u: [...(row.startErrors ?? [])] };
      switched.page.reloadProblem = row.reloadProblem ?? null;
      const d = switched.catalog.entries[1];

      const calls = await changeCatalog(switched, [
        user('u', { revision: 2, ...row.next }),
        d,
      ]);

      expect(calls).toEqual(row.calls);
      const { on, problem } = switched.row('u') ?? {};
      expect({ on, problem }).toEqual(row.u);
      expect(switched.logs.at(-1)).toBe(`[plugin-switch] ${row.log}`);
    },
  );

  // A page part whose start failed is held but not started, so the page stop
  // names nothing: the start must still bring it and its page dependent up.
  it.each([
    {
      case: 'a good reload',
      act: (switched: ReturnType<typeof setup>) =>
        changeCatalog(switched, [
          user('u', { revision: 2 }),
          switched.catalog.entries[1],
        ]),
    },
    {
      case: 'a restart',
      act: (switched: ReturnType<typeof setup>) =>
        switched.pluginSwitch.restart('u'),
    },
  ])('pageStartFailed_ThenStartsThePageAgain: $case', async (row) => {
    const switched = setup({
      entries: [
        user('u'),
        user('d', { manifest: { dependsOn: { main: [], page: ['u'] } } }),
      ],
      applied: ['u', 'd'],
      disabled: [],
    });
    switched.page.startProblems = [
      { id: 'u', message: 'Page part did not start: boom' },
    ];
    await switched.pluginSwitch.settled();
    expect(switched.row('u')?.problem).toBe('Page part did not start: boom');
    switched.page.startProblems = [];
    switched.page.stopReply = [];
    const before = switched.calls.length;

    await row.act(switched);

    const pageStarts = switched.calls
      .slice(before)
      .filter((call) => call.startsWith('page start'));
    expect(pageStarts).toEqual(['page start u,d']);
    expect(switched.row('u')?.problem).toBe(null);
  });

  it('catalogChange_ReloadStartFails_NoLastGoodStaysStopped', async () => {
    // A built-in that came back after its replacement failed, and now fails
    // itself: its last good entry is the entry it reloads to.
    const builtIn = entry('u');
    const switched = setup({ entries: [builtIn] });
    switched.main.startErrors = { u: ['replacement boom'] };
    await changeCatalog(switched, [user('u', { origin: 'replaces-built-in' })]);
    switched.main.startErrors = { u: ['built-in boom'] };

    const calls = await changeCatalog(switched, [builtIn]);

    expect(calls).toEqual([
      'paused u',
      'servedChanged',
      'setPlugins',
      'page stop u',
      'main remove u',
      'main add u',
      'main start u',
      'applied u',
      'paused',
      'servedChanged',
    ]);
    const { on, problem } = switched.row('u') ?? {};
    expect({ on, problem }).toEqual({
      on: false,
      problem: 'Did not start: built-in boom',
    });
  });

  it('catalogChange_AfterFailedReload_BaselineIsTheHandledEntry', async () => {
    const good = user('u');
    const switched = setup({ entries: [good] });
    switched.main.startErrors = { u: ['boom'] };
    const bad = user('u', { revision: 2 });
    await changeCatalog(switched, [bad]);

    const problemsOnly = await changeCatalog(
      switched,
      [bad],
      [{ id: 'x', message: 'manifest.json is not JSON' }],
    );
    await changeCatalog(switched, [bad, user('z')]);

    expect(problemsOnly).toEqual([]);
    expect(switched.handed.at(-1)?.[0]).toBe(good);
  });

  it.each([
    {
      case: 'a failed launch start, then a fixed revision',
      applied: ['u', 'd'],
      startErrors: ['boom'],
      calls: [
        'setPlugins',
        'main remove u',
        'main add u',
        'page reload u',
        'main start u',
        'applied d',
        'servedChanged',
        'page start u',
        'main start d',
        'applied ',
        'servedChanged',
        'page start d',
      ],
    },
    {
      case: 'a config-refused add, then an admitted revision',
      added: true,
      calls: [
        'setPlugins',
        'main remove u',
        'main add u',
        'page reload u',
        'main start u',
        'applied ',
        'servedChanged',
        'page start u',
      ],
    },
  ])('catalogChange_WithheldId_FixedRevisionStarts: $case', async (row) => {
    const entries =
      row.added === true
        ? [entry('a')]
        : [user('u'), user('d', { manifest: DEPENDS_ON_U })];
    const switched = setup({ entries, applied: row.applied, disabled: [] });
    switched.main.startErrors = { u: [...(row.startErrors ?? [])] };
    if (row.added === true) {
      switched.config.refused = ['u'];
      switched.config.refusals = { u: 'Command "u.go" is declared twice' };
      await changeCatalog(switched, [...entries, user('u')]);
      switched.config.refused = [];
      switched.config.refusals = {};
    }
    await switched.pluginSwitch.settled();
    const fixed = user('u', { revision: 3 });
    const others = switched.catalog.entries.filter(
      (each) => each.manifest.id !== 'u',
    );

    const calls = await changeCatalog(switched, [fixed, ...others]);

    expect(calls).toEqual(row.calls);
    expect(
      switched.statuses
        .at(-1)
        ?.map(({ id, on, problem }) => ({ id, on, problem }))
        .filter(({ id }) => id !== 'a'),
    ).toEqual(
      ['u', ...(row.added === true ? [] : ['d'])].map((id) => ({
        id,
        on: true,
        problem: null,
      })),
    );
  });

  it('catalogChange_OneJobAllThreeGroups_RemovedReloadedAdded', async () => {
    const switched = setup({ entries: [user('x'), user('y')] });

    const calls = await changeCatalog(switched, [
      user('y', { revision: 2 }),
      user('z'),
    ]);

    const groupCalls = ['page remove x', 'page stop y', 'main add z'].map(
      (call) => calls.indexOf(call),
    );
    expect(groupCalls.every((index) => index >= 0)).toBe(true);
    expect(groupCalls).toEqual([...groupCalls].sort((a, b) => a - b));
  });

  it('catalogChange_DuringApply_RunsAfterIt', async () => {
    const switched = setup({ manifests: GALLERY });
    await switched.pluginSwitch.settled();
    const { hold, release } = heldPage();
    switched.page.hold = hold;
    const applying = switched.pluginSwitch.apply(['gallery']);
    await expect.poll(() => switched.calls.at(-1)).toBe('page stop gallery');

    switched.catalog.change([...switched.catalog.entries, user('u')]);
    release();
    await applying;
    await switched.pluginSwitch.settled();

    expect(switched.calls.indexOf('setPlugins')).toBeGreaterThan(
      switched.calls.indexOf('clearOwner gallery'),
    );
  });

  it.each([
    {
      case: 'an unrelated disabled edit',
      lists: [['a']],
      noCall: 'main start u',
      u: { on: false, problem: 'Did not start: boom' },
    },
    {
      case: 'the user switches the failed plugin off and on',
      lists: [['u'], []],
      startsAfter: true,
      u: { on: true, problem: null },
    },
  ])('apply_WithheldId_LeftAlone: $case', async (row) => {
    const switched = setup({
      entries: [entry('a'), user('u')],
      applied: ['u'],
      disabled: [],
    });
    switched.main.startErrors = { u: ['boom'] };
    await switched.pluginSwitch.settled();
    const before = switched.calls.length;

    for (const list of row.lists) {
      switched.configDisabled.list = list;
      expect(await switched.pluginSwitch.apply(list)).toBe(null);
    }

    const calls = switched.calls.slice(before);
    expect(calls.includes('main start u')).toBe(row.startsAfter === true);
    const { on, problem } = switched.row('u') ?? {};
    expect({ on, problem }).toEqual(row.u);
  });

  it('apply_UserPluginOnThrows_ResolvesNullWithTheProblem', async () => {
    const switched = setup({
      entries: [entry('a'), user('u')],
      applied: ['u'],
    });
    await switched.pluginSwitch.settled();
    switched.main.startErrors = { u: ['boom'] };
    switched.configDisabled.list = [];

    const result = await switched.pluginSwitch.apply([]);

    expect(result).toBe(null);
    const { on, problem } = switched.row('u') ?? {};
    expect({ on, problem }).toEqual({
      on: false,
      problem: 'Did not start: boom',
    });
  });

  it('launch_HeldIds_StartGuardedOneByOne', async () => {
    const entries = [
      entry('a'),
      user('u'),
      user('f'),
      user('d', { manifest: { dependsOn: { main: ['f'], page: [] } } }),
      entry('chat', { origin: 'replaces-built-in' }),
    ];
    const held = heldAtStart(entries);
    const switched = setup({ entries, applied: held, disabled: [] });
    switched.main.startErrors = { f: ['boom'], chat: ['chat boom'] };
    switched.page.startProblems = [
      { id: 'u', message: 'Page part did not start: boom' },
    ];

    await switched.pluginSwitch.settled();

    expect(held).toEqual(['u', 'f', 'd', 'chat']);
    expect(switched.calls).toEqual([
      'main start u',
      'applied f,d,chat',
      'servedChanged',
      'page start u',
      'main start f',
      'main start chat',
    ]);
    expect(
      switched.statuses
        .at(-1)
        ?.map(({ id, on, problem }) => ({ id, on, problem })),
    ).toEqual([
      { id: 'a', on: true, problem: null },
      { id: 'u', on: true, problem: 'Page part did not start: boom' },
      { id: 'f', on: false, problem: 'Did not start: boom' },
      { id: 'd', on: false, problem: 'Needs plugin "f", which did not start' },
      { id: 'chat', on: false, problem: 'Did not start: chat boom' },
    ]);
  });

  it('dispose_QueuedCatalogJob_DoesNothing', async () => {
    const switched = setup({ manifests: GALLERY });
    await switched.pluginSwitch.settled();
    const { hold, release } = heldPage();
    switched.page.hold = hold;
    const applying = switched.pluginSwitch.apply(['gallery']);
    await expect.poll(() => switched.calls.at(-1)).toBe('page stop gallery');
    switched.catalog.change([...switched.catalog.entries, user('u')]);

    switched.pluginSwitch.dispose();
    release();
    await applying;
    await switched.pluginSwitch.settled();
    switched.catalog.change([...switched.catalog.entries, user('v')]);
    await switched.pluginSwitch.settled();

    expect(switched.calls).not.toContain('setPlugins');
    expect(switched.calls).not.toContain('main add u');
    expect(switched.catalog.listeners.size).toBe(0);
  });

  it.each([
    {
      case: 'a failed first load',
      entries: [entry('a')],
      problems: [{ id: 'x', message: 'manifest.json is not JSON' }],
      rows: [
        { id: 'a', on: true, origin: 'built-in', problem: null },
        {
          id: 'x',
          on: false,
          origin: 'user',
          problem: 'manifest.json is not JSON',
        },
      ],
    },
    {
      case: 'a built-in shown in place of a held-back replacement',
      entries: [entry('chat')],
      problems: [
        { id: 'chat', message: 'needs plugin "z", which is not loaded' },
      ],
      rows: [
        {
          id: 'chat',
          on: true,
          origin: 'built-in',
          problem: 'needs plugin "z", which is not loaded',
        },
      ],
    },
  ])('status_CatalogProblems_ShowOnRows: $case', async (row) => {
    const switched = setup({ entries: row.entries });

    await changeCatalog(switched, row.entries, row.problems);

    expect(
      switched.statuses
        .at(-1)
        ?.map(({ id, on, origin, problem }) => ({ id, on, origin, problem })),
    ).toEqual(row.rows);
  });

  it('catalogChange_ReplacementLosesItsDependency_ReloadsToTheBuiltIn', async () => {
    const builtIn = entry('chat');
    const replacement = user('chat', {
      origin: 'replaces-built-in',
      manifest: { dependsOn: { main: ['z'], page: [] } },
    });
    const z = user('z');
    const switched = setup({ entries: [builtIn, z] });
    await changeCatalog(switched, [replacement, z]);

    const calls = await changeCatalog(
      switched,
      [builtIn],
      [{ id: 'chat', message: 'needs plugin "z", which is not loaded' }],
    );

    expect(calls).toContain('main add chat');
    expect(calls).toContain('page reload chat');
    expect(
      switched.statuses.at(-1)?.filter(({ id }) => id === 'chat'),
    ).toMatchObject([
      {
        origin: 'built-in',
        on: true,
        problem: 'needs plugin "z", which is not loaded',
      },
    ]);
  });

  it('problems_MergedAndHandedToConfig', async () => {
    const switched = setup({
      entries: [entry('a'), user('u'), user('v')],
      applied: ['u'],
      disabled: [],
    });
    switched.main.startErrors = { u: ['boom'] };
    switched.config.refusals = { v: 'Theme token "v.ink" clashes' };
    await switched.pluginSwitch.settled();

    await changeCatalog(switched, switched.catalog.entries, [
      { id: 'u', message: 'manifest.json is not JSON' },
      { id: 'x', message: 'main.js threw' },
    ]);

    expect(switched.handedProblems.at(-1)).toEqual([
      { id: 'u', message: 'Did not start: boom' },
      { id: 'u', message: 'manifest.json is not JSON' },
      { id: 'x', message: 'main.js threw' },
    ]);
    expect(
      switched.statuses.at(-1)?.map(({ id, problem }) => ({ id, problem })),
    ).toEqual([
      { id: 'a', problem: null },
      { id: 'u', problem: 'Did not start: boom' },
      { id: 'v', problem: 'Theme token "v.ink" clashes' },
      { id: 'x', problem: 'main.js threw' },
    ]);
  });

  it.each([
    { case: 'none', entries: [entry('a')], held: [] },
    { case: 'one user id', entries: [entry('a'), user('u')], held: ['u'] },
    {
      case: 'a built-in depending on a replaced built-in id',
      entries: [
        entry('b', { manifest: { dependsOn: { main: [], page: ['chat'] } } }),
        entry('chat', { origin: 'replaces-built-in' }),
      ],
      held: ['b', 'chat'],
    },
    {
      case: 'a transitive dependent',
      entries: [
        entry('c', { manifest: { dependsOn: { main: ['b'], page: [] } } }),
        entry('b', { manifest: { dependsOn: { main: ['u'], page: [] } } }),
        user('u'),
      ],
      held: ['c', 'b', 'u'],
    },
  ])('heldAtStart_UserIdsAndTheirDependents: $case', ({ entries, held }) => {
    expect(heldAtStart(entries)).toEqual(held);
  });

  const MAY_DISABLE = [
    manifest('usage', { label: 'Usage' }),
    manifest('usage-tab-line', {
      label: 'Usage tab line',
      dependsOn: { main: [], page: ['usage'] },
    }),
    manifest('forms', { label: 'Forms' }),
  ];

  it.each([
    { case: 'already off', applied: ['forms'], id: 'forms', expected: null },
    {
      case: 'needed',
      id: 'usage',
      expected: 'Usage is needed by Usage tab line',
    },
    {
      case: 'main refuses',
      id: 'forms',
      mainRefusal: 'forms: a round is open',
      expected: 'Forms cannot switch off now: a round is open',
    },
    {
      case: 'page refuses',
      id: 'forms',
      pageRefusal: 'forms: a round is open',
      expected: 'Forms cannot switch off now: a round is open',
    },
    { case: 'none', id: 'forms', expected: null },
  ])('mayDisable_$case', async (row) => {
    const switched = setup({ manifests: MAY_DISABLE, applied: row.applied });
    switched.main.refusal = row.mainRefusal ?? null;
    switched.page.refusal = row.pageRefusal ?? null;

    expect(await switched.pluginSwitch.mayDisable(row.id)).toBe(row.expected);
  });

  it('restart_KeepsSlotsAndStartsWhatItStopped', async () => {
    const { pluginSwitch, calls, logs, main, page } = setup({
      manifests: [
        manifest('a'),
        manifest('b', { dependsOn: { main: ['a'], page: [] } }),
      ],
    });
    page.stopReply = ['b', 'a'];
    main.stopReply = ['b', 'a'];

    await pluginSwitch.restart('a');

    expect(calls).toEqual([
      'paused a,b',
      'servedChanged',
      'page stop a',
      'main stop a',
      'main start b,a',
      'paused',
      'servedChanged',
      'page start a,b',
    ]);
    expect(logs).toEqual(['[plugin-switch] restarted a']);
  });

  const DEPENDS_ON_X = { main: ['x'], page: [] };

  it.each([
    {
      case: 'main stop rejects',
      manifests: [manifest('a'), manifest('b')],
      id: 'a',
      fail: { stopRejects: 'a' },
      calls: [
        'paused a',
        'servedChanged',
        'page stop a',
        'main stop a',
        'main start a',
        'page start a',
        'paused',
        'servedChanged',
      ],
      logs: [],
    },
    {
      case: 'main start throws',
      manifests: [manifest('a'), manifest('b')],
      id: 'a',
      fail: { startThrowsAt: 'a' },
      calls: [
        'paused a',
        'servedChanged',
        'page stop a',
        'main stop a',
        'main start a',
        'main start a',
        'paused',
        'servedChanged',
      ],
      logs: ['[plugin-switch] failed: start of a failed'],
    },
    {
      case: 'one dependent fails to start again',
      manifests: [
        manifest('z', { dependsOn: DEPENDS_ON_X }),
        manifest('x'),
        manifest('y', { dependsOn: DEPENDS_ON_X }),
      ],
      id: 'x',
      pageStopped: ['z', 'y', 'x'],
      fail: {
        stopReply: ['z', 'y', 'x'],
        stopRejects: 'x',
        startThrowsAt: 'y',
      },
      calls: [
        'paused x,z,y',
        'servedChanged',
        'page stop x',
        'main stop x',
        'main start x',
        'main start z',
        'main start y',
        'page start x,z',
        'paused',
        'servedChanged',
      ],
      logs: ['[plugin-switch] failed: start of y failed'],
    },
    {
      case: 'page start rejects',
      manifests: [manifest('a'), manifest('b')],
      id: 'a',
      fail: {},
      pageStartRejects: 'a',
      calls: [
        'paused a',
        'servedChanged',
        'page stop a',
        'main stop a',
        'main start a',
        'paused',
        'servedChanged',
        'page start a',
        'page start a',
      ],
      logs: ['[plugin-switch] failed: page start of a failed'],
    },
  ])('restart_StepFails_StartsWhatItStopped: $case', async (row) => {
    const switched = setup({ manifests: row.manifests });
    Object.assign(switched.main, row.fail);
    switched.page.stopReply = row.pageStopped ?? null;
    switched.page.startRejects = row.pageStartRejects ?? null;

    await expect(switched.pluginSwitch.restart(row.id)).rejects.toThrow(
      /failed$/,
    );

    expect(switched.calls).toEqual(row.calls);
    expect(switched.logs).toEqual(row.logs);
  });

  it.each([
    {
      case: 'refused before dispose',
      refusesAfterDispose: false,
      timers: [PLUGIN_RETRY_MS],
      cleared: [1],
    },
    {
      case: 'refused after dispose',
      refusesAfterDispose: true,
      timers: [],
      cleared: [],
    },
  ])('dispose_ClearsTheRetryAndLaterCallsDoNothing: $case', async (row) => {
    const { pluginSwitch, page, timers, cleared, calls } = setup({
      manifests: FORMS,
    });
    const held = heldPage();
    page.refusal = REFUSAL;
    page.mayStopHold = row.refusesAfterDispose ? held.hold : null;
    const refused = pluginSwitch.apply(['forms']);
    await expect.poll(() => calls.at(-1)).toBe('page mayStop forms');
    if (!row.refusesAfterDispose) {
      await refused;
    }
    const callsAtDispose = calls.length;

    pluginSwitch.dispose();
    held.release();
    const refusal = await refused;
    page.refusal = null;
    for (const timer of timers) {
      timer.run();
    }
    const applied = await pluginSwitch.apply(['notes']);
    await pluginSwitch.restart('forms');

    expect(refusal).toBe(REFUSAL);
    expect(timers.map(({ ms }) => ms)).toEqual(row.timers);
    expect(cleared).toEqual(row.cleared);
    expect(applied).toBe(null);
    expect(calls.slice(callsAtDispose)).toEqual([]);
  });

  it.each([
    { case: 'off', id: 'a', expected: 'Plugin "a" is off' },
    { case: 'unknown', id: 'zzz', expected: 'No plugin "zzz"' },
  ])('restart_OffOrUnknown_Rejects: $case', async ({ id, expected }) => {
    const { pluginSwitch, calls } = setup({
      manifests: [manifest('a')],
      applied: ['a'],
    });

    await expect(pluginSwitch.restart(id)).rejects.toThrow(expected);
    expect(calls).toEqual([]);
  });
});
