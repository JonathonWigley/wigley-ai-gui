import { describe, expect, it } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type {
  PluginPartsReply,
  PluginPartsRequest,
} from '../../contracts/bridge';
import type { PluginStatus } from '../../contracts/core-state';
import type { MainStart, PluginManifest } from '../../contracts/plugin';
import { createAppliedPlugins } from './applied-plugins';
import {
  createPluginSwitch,
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

const REFUSAL = 'forms: a round is open in s1';
const PROBLEM =
  '"plugins.disabled" names "forms", which cannot stop now: a round is open in s1';

interface SetupOptions {
  manifests: readonly PluginManifest[];
  applied?: readonly string[];
}

// A switch over a fake main host and a fake page, each pushing
// `<side> <kind> <ids>` to `calls`, with the applied list, `clearOwner` and
// `servedChanged` pushing to the same list. `main` and `page` hold what the
// fakes answer, and a test changes them between calls. A refusal answers only
// for a request naming its id, and a main stop forgets each part it replies
// with even when it rejects, as the host does. `page.mayStopHold` holds a
// page `mayStop` and `page.hold` a page stop. A page start naming
// `page.startRejects` rejects after it is pushed. `setPaused` pushes
// `paused <ids>`.
function setup({ manifests, applied: initial = [] }: SetupOptions) {
  const calls: string[] = [];
  const logs: string[] = [];
  const problems: (string | null)[] = [];
  const statuses: (readonly PluginStatus[])[] = [];
  const timers: { run(): void; ms: number }[] = [];
  const cleared: number[] = [];
  const started = new Map<string, MainStart<PluginManifest>>(
    manifests
      .filter((each) => !initial.includes(each.id))
      .map((each) => [each.id, {} as MainStart<PluginManifest>]),
  );
  const main = {
    refusal: null as string | null,
    stopReply: null as string[] | null,
    stopRejects: null as string | null,
    startThrowsAt: null as string | null,
  };
  const page = {
    refusal: null as string | null,
    stopReply: null as string[] | null,
    hold: null as Promise<void> | null,
    mayStopHold: null as Promise<void> | null,
    startRejects: null as string | null,
  };
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
          started.set(id, {} as MainStart<PluginManifest>);
        }
      },
    },
    async page(request: PluginPartsRequest): Promise<PluginPartsReply> {
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
      return { started: request.ids };
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
    manifests,
    problem: (message) => problems.push(message),
    servedChanged: () => calls.push('servedChanged'),
    timers: fakeTimers,
    log: (source, message) => logs.push(`[${source}] ${message}`),
  };
  const pluginSwitch = createPluginSwitch(deps);
  return {
    pluginSwitch,
    calls,
    logs,
    problems,
    statuses,
    timers,
    cleared,
    main,
    page,
  };
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
      },
      {
        id: 'usage-tab-line',
        label: 'Usage tab line',
        description: 'Shows usage on the tab.',
        on: true,
        neededBy: [],
      },
    ]);
    expect(
      statuses.at(-1)?.map(({ id, on, neededBy }) => ({ id, on, neededBy })),
    ).toEqual([
      { id: 'usage', on: true, neededBy: [] },
      { id: 'usage-tab-line', on: false, neededBy: [] },
    ]);
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
      'page start b,a',
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
        'page start z,x',
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
