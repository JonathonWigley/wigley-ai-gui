import { describe, expect, it } from 'vitest';
import type { PluginPartsRequest } from '../contracts/bridge';
import type { PagePart, PluginManifest } from '../contracts/plugin';
import type { ServedPlugin } from '../contracts/plugin-catalog';
import type { AppConfig } from '../contracts/settings';
import { answerPluginParts } from './plugin-parts-answer';

// `c` depends on `b` in the page, as the fake host stops them.
const PAGE_DEPENDENCIES: Record<string, string[]> = { c: ['b'] };

// A part of `id` whose manifest's label is `label`, so a row tells the old
// held part from the one a load made.
function part(id: string, label: string): PagePart {
  const manifest: PluginManifest = {
    id,
    label,
    description: 'A test plugin.',
    dependsOn: { main: [], page: PAGE_DEPENDENCIES[id] ?? [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  };
  return { manifest, start: () => ({ commands: {} }) };
}

function served(ids: readonly string[]): AppConfig {
  const plugins: ServedPlugin[] = ids.map((id) => ({
    id,
    origin: 'user',
    revision: 1,
    pageUrl: `wigley-plugin://${id}/~1/page.js`,
    manifest: part(id, 'served').manifest,
  }));
  return { plugins } as unknown as AppConfig;
}

// A page host holding `heldIds` as `old` parts, whose held parts start and
// stop through `started`, recording each start in `steps` as `start <id>`
// and each add and remove of a held id as `add <id>` and `remove <id>`; a
// remove of an id it does not hold stops nothing. `startEach` starts
// the held, not started ids in request order, one at a time, and returns the
// throw of each that did not start: `throwsOn`, or a part whose page
// dependency is not started. Stopping `b` stops `c`, its dependent, first.
// `throwsOn` names the one id whose step throws, as the real host does: its
// stop throws after stopping its parts, its start before it starts, and its
// `mayStop` when asked; `throwsOn: 'stopping'` makes `startEach` throw as a
// host whose `stopAll` began does.
function fakeHost(
  heldIds: readonly string[],
  startedIds: readonly string[],
  steps: string[],
  throwsOn?: string,
) {
  const held = new Map(heldIds.map((id) => [id, part(id, 'old')]));
  const started = new Map<string, unknown>(startedIds.map((id) => [id, {}]));
  const failure = (step: string, id: string) =>
    new Error(`${step} of ${id} failed`);
  const stop = async (id: string) => {
    const ids = id === 'b' ? ['c', 'b'] : [id];
    const stopped = ids.filter((each) => started.has(each));
    for (const each of stopped) {
      started.delete(each);
    }
    if (id === throwsOn) {
      throw failure('stop', id);
    }
    return stopped;
  };
  return {
    held,
    started,
    mayStop(ids: readonly string[]) {
      if (throwsOn !== undefined && ids.includes(throwsOn)) {
        throw failure('mayStop', throwsOn);
      }
      return null;
    },
    startEach(ids: readonly string[]) {
      if (throwsOn === 'stopping') {
        throw new Error('Plugin host is stopping');
      }
      const failures: { id: string; error: unknown }[] = [];
      for (const id of ids) {
        if (!held.has(id) || started.has(id)) {
          continue;
        }
        steps.push(`start ${id}`);
        const notStarted = (PAGE_DEPENDENCIES[id] ?? []).find(
          (dependency) => !started.has(dependency),
        );
        if (id === throwsOn) {
          failures.push({ id, error: failure('start', id) });
        } else if (notStarted !== undefined) {
          failures.push({
            id,
            error: new Error(`${id} needs ${notStarted}, which is not started`),
          });
        } else {
          started.set(id, {});
        }
      }
      return failures;
    },
    holds: (id: string) => held.has(id),
    stop,
    add(added: PagePart) {
      steps.push(`add ${added.manifest.id}`);
      held.set(added.manifest.id, added);
    },
    async remove(id: string) {
      if (!held.has(id)) {
        return [];
      }
      steps.push(`remove ${id}`);
      try {
        return await stop(id);
      } finally {
        held.delete(id);
      }
    },
  };
}

const HELD = ['a', 'b', 'c'];
const SERVED = ['a', 'b', 'c', 'u'];

interface Row {
  case: string;
  held?: string[];
  started: string[];
  served?: string[];
  // What a load of `u` gives: a new part, none, or a rejection.
  load?: 'new' | 'none' | 'rejects';
  throwsOn?: string;
  request: PluginPartsRequest;
  reply: unknown;
  logs: string[];
  steps: string[];
  // The held parts after the answer, as `<id>:<label>`; left out, not checked.
  heldAfter?: string[];
  startedAfter?: string[];
}

const ROWS: Row[] = [
  {
    case: 'stop replies each id once in stop order',
    started: ['a', 'b', 'c'],
    request: { kind: 'stop', ids: ['b', 'c', 'a'] },
    reply: { stopped: ['c', 'b', 'a'] },
    logs: [],
    steps: [],
  },
  {
    case: 'start replies the ids new in started',
    started: ['a'],
    request: { kind: 'start', ids: ['a', 'b'] },
    reply: { started: ['b'], problems: [] },
    logs: [],
    steps: ['reopen', 'start b', 'partsReady', 'reapply'],
  },
  {
    case: 'a stop that throws after stopping its parts replies them and goes on',
    started: ['a', 'b', 'c'],
    throwsOn: 'b',
    request: { kind: 'stop', ids: ['b', 'a'] },
    reply: { stopped: ['c', 'b', 'a'] },
    logs: ['plugin-switch: page stop failed: stop of b failed'],
    steps: [],
  },
  {
    case: 'a mayStop that throws replies a reason naming its part',
    started: ['a', 'b'],
    throwsOn: 'b',
    request: { kind: 'mayStop', ids: ['b', 'a'] },
    reply: { reason: 'b: mayStop failed: mayStop of b failed' },
    logs: ['plugin-switch: page mayStop failed: mayStop of b failed'],
    steps: [],
  },
  {
    case: 'a start that throws blames its own id and its dependent, and the rest start',
    started: [],
    throwsOn: 'b',
    request: { kind: 'start', ids: ['b', 'c', 'a'] },
    reply: {
      started: ['a'],
      problems: [
        { id: 'b', message: 'Page part did not start: start of b failed' },
        {
          id: 'c',
          message: 'Page part did not start: c needs b, which is not started',
        },
      ],
    },
    logs: [
      'plugin-switch: page start failed: start of b failed',
      'plugin-switch: page start failed: c needs b, which is not started',
    ],
    steps: ['reopen', 'start b', 'start c', 'start a', 'partsReady', 'reapply'],
  },
  {
    case: 'a start the host refuses still readies the window',
    started: [],
    throwsOn: 'stopping',
    request: { kind: 'start', ids: ['a'] },
    reply: { started: [], problems: [] },
    logs: ['plugin-switch: page start failed: Plugin host is stopping'],
    steps: ['reopen', 'partsReady', 'reapply'],
  },
  {
    case: 'start of an id the host does not hold loads, adds and starts it',
    started: [],
    load: 'new',
    request: { kind: 'start', ids: ['u'] },
    reply: { started: ['u'], problems: [] },
    logs: [],
    steps: ['add u', 'reopen', 'start u', 'partsReady', 'reapply'],
    heldAfter: ['a:old', 'b:old', 'c:old', 'u:new'],
  },
  {
    case: 'start of an id the host does not hold whose import rejects',
    started: [],
    load: 'rejects',
    request: { kind: 'start', ids: ['u'] },
    reply: {
      started: [],
      problems: [{ id: 'u', message: 'page.js of u failed to load: boom' }],
    },
    logs: [
      'plugin-switch: page start failed: page.js of u failed to load: boom',
    ],
    steps: ['reopen', 'partsReady', 'reapply'],
    heldAfter: ['a:old', 'b:old', 'c:old'],
  },
  {
    case: 'start of a held id whose start throws names it in problems',
    started: [],
    throwsOn: 'b',
    request: { kind: 'start', ids: ['b'] },
    reply: {
      started: [],
      problems: [
        { id: 'b', message: 'Page part did not start: start of b failed' },
      ],
    },
    logs: ['plugin-switch: page start failed: start of b failed'],
    steps: ['reopen', 'start b', 'partsReady', 'reapply'],
  },
  {
    case: 'start of a held, started id replies nothing new',
    started: ['a'],
    request: { kind: 'start', ids: ['a'] },
    reply: { started: [], problems: [] },
    logs: [],
    steps: ['reopen', 'partsReady', 'reapply'],
  },
  {
    case: 'reload of a held part swaps in the new part and starts nothing',
    held: ['a', 'u'],
    started: ['a'],
    load: 'new',
    request: { kind: 'reload', id: 'u' },
    reply: { reloaded: ['u'], problem: null },
    logs: [],
    steps: ['remove u', 'add u'],
    heldAfter: ['a:old', 'u:new'],
    startedAfter: ['a'],
  },
  {
    case: 'reload of an id the host does not hold adds it',
    started: [],
    load: 'new',
    request: { kind: 'reload', id: 'u' },
    reply: { reloaded: ['u'], problem: null },
    logs: [],
    steps: ['add u'],
    heldAfter: ['a:old', 'b:old', 'c:old', 'u:new'],
    startedAfter: [],
  },
  {
    case: 'reload of an id whose served entry is gone removes it',
    held: ['a', 'u'],
    started: [],
    served: ['a'],
    request: { kind: 'reload', id: 'u' },
    reply: { reloaded: [], problem: null },
    logs: [],
    steps: ['remove u'],
    heldAfter: ['a:old'],
  },
  {
    case: 'reload of an id whose new page.js is gone removes it',
    held: ['a', 'u'],
    started: [],
    load: 'none',
    request: { kind: 'reload', id: 'u' },
    reply: { reloaded: [], problem: null },
    logs: [],
    steps: ['remove u'],
    heldAfter: ['a:old'],
  },
  {
    case: 'reload whose import rejects keeps the old part',
    held: ['a', 'u'],
    started: [],
    load: 'rejects',
    request: { kind: 'reload', id: 'u' },
    reply: { reloaded: [], problem: 'page.js of u failed to load: boom' },
    logs: ['plugin-switch: page.js of u failed to load: boom'],
    steps: [],
    heldAfter: ['a:old', 'u:old'],
  },
  {
    case: 'remove of a held, started part stops its dependent first',
    started: ['a', 'b', 'c'],
    request: { kind: 'remove', id: 'b' },
    reply: { stopped: ['c', 'b'] },
    logs: [],
    steps: ['remove b'],
    heldAfter: ['a:old', 'c:old'],
    startedAfter: ['a'],
  },
  {
    case: 'remove of an id the host does not hold stops nothing',
    started: ['a'],
    request: { kind: 'remove', id: 'z' },
    reply: { stopped: [] },
    logs: [],
    steps: [],
    heldAfter: ['a:old', 'b:old', 'c:old'],
  },
];

describe('answerPluginParts', () => {
  // Breaks if `reload` starts the part, if a failed import drops the old
  // part, if `start` refuses an id it could load, or if a page-side failure
  // leaves the reply with no problem.
  it.each(ROWS)('answerPluginParts_$case', async (row) => {
    const logs: string[] = [];
    const steps: string[] = [];
    const heldIds = row.held ?? HELD;
    const host = fakeHost(heldIds, row.started, steps, row.throwsOn);

    const reply = await answerPluginParts(host, row.request, {
      restores: {
        reopen: () => steps.push('reopen'),
        partsReady: () => steps.push('partsReady'),
      },
      reapplyPush: () => steps.push('reapply'),
      log: (source, message) => logs.push(`${source}: ${message}`),
      served: () => served(row.served ?? SERVED),
      async loadPart(plugin) {
        if (row.load === 'rejects') {
          throw new Error('boom');
        }
        return row.load === 'none' ? null : part(plugin.id, 'new');
      },
    });

    expect([reply, logs, steps]).toEqual([row.reply, row.logs, row.steps]);
    if (row.heldAfter !== undefined) {
      expect(
        [...host.held.values()].map(
          ({ manifest }) => `${manifest.id}:${manifest.label}`,
        ),
      ).toEqual(row.heldAfter);
    }
    if (row.startedAfter !== undefined) {
      expect([...host.started.keys()]).toEqual(row.startedAfter);
    }
  });
});
