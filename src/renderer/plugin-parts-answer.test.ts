import { describe, expect, it } from 'vitest';
import type { PluginPartsRequest } from '../contracts/bridge';
import { answerPluginParts } from './plugin-parts-answer';

// A page host whose parts `a`, `b` and `c` start and stop through `started`.
// Stopping `b` stops `c`, its dependent, first. `throwsOn` names the one id
// whose step throws, as the real host does: its stop throws after stopping its
// parts, its start before it starts, and its `mayStop` when asked.
function fakeHost(startedIds: readonly string[], throwsOn?: string) {
  const started = new Map<string, unknown>(startedIds.map((id) => [id, {}]));
  const failure = (step: string, id: string) =>
    new Error(`${step} of ${id} failed`);
  return {
    started,
    mayStop(ids: readonly string[]) {
      if (throwsOn !== undefined && ids.includes(throwsOn)) {
        throw failure('mayStop', throwsOn);
      }
      return null;
    },
    start(ids: readonly string[]) {
      for (const id of ids) {
        if (id === throwsOn) {
          throw failure('start', id);
        }
        started.set(id, {});
      }
    },
    async stop(id: string) {
      const ids = id === 'b' ? ['c', 'b'] : [id];
      const stopped = ids.filter((each) => started.has(each));
      for (const each of stopped) {
        started.delete(each);
      }
      if (id === throwsOn) {
        throw failure('stop', id);
      }
      return stopped;
    },
  };
}

describe('answerPluginParts', () => {
  it.each([
    {
      case: 'stop replies each id once in stop order',
      started: ['a', 'b', 'c'],
      request: { kind: 'stop', ids: ['b', 'c', 'a'] } as PluginPartsRequest,
      reply: { stopped: ['c', 'b', 'a'] },
      logs: [],
      reapplied: 0,
    },
    {
      case: 'start replies the ids new in started',
      started: ['a'],
      request: { kind: 'start', ids: ['a', 'b'] } as PluginPartsRequest,
      reply: { started: ['b'] },
      logs: [],
      reapplied: 1,
    },
    {
      case: 'a stop that throws after stopping its parts replies them and goes on',
      started: ['a', 'b', 'c'],
      throwsOn: 'b',
      request: { kind: 'stop', ids: ['b', 'a'] } as PluginPartsRequest,
      reply: { stopped: ['c', 'b', 'a'] },
      logs: ['plugin-switch: page stop failed: stop of b failed'],
      reapplied: 0,
    },
    {
      case: 'a mayStop that throws replies a reason naming its part',
      started: ['a', 'b'],
      throwsOn: 'b',
      request: { kind: 'mayStop', ids: ['b', 'a'] } as PluginPartsRequest,
      reply: { reason: 'b: mayStop failed: mayStop of b failed' },
      logs: ['plugin-switch: page mayStop failed: mayStop of b failed'],
      reapplied: 0,
    },
    {
      case: 'a start that throws partway replies the ids started before it',
      started: [],
      throwsOn: 'b',
      request: { kind: 'start', ids: ['a', 'b', 'c'] } as PluginPartsRequest,
      reply: { started: ['a'] },
      logs: ['plugin-switch: page start failed: start of b failed'],
      reapplied: 1,
    },
  ])('answerPluginParts_$case', async (row) => {
    const logs: string[] = [];
    let reapplied = 0;

    const reply = await answerPluginParts(
      fakeHost(row.started, row.throwsOn),
      row.request,
      {
        reapplyPush: () => {
          reapplied += 1;
        },
        log: (source, message) => logs.push(`${source}: ${message}`),
      },
    );

    expect(reply).toEqual(row.reply);
    expect(logs).toEqual(row.logs);
    expect(reapplied).toBe(row.reapplied);
  });
});
