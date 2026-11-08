import { describe, expect, it } from 'vitest';
import type { PluginPartsRequest } from '../contracts/bridge';
import { answerPluginParts } from './plugin-parts-answer';

// A page host whose parts `a`, `b` and `c` start and stop through `started`. Stopping `b` stops `c`, its
// dependent, first; `throwsOn` names the one id whose stop throws, before it stops anything.
function fakeHost(startedIds: readonly string[], throwsOn?: string) {
  const started = new Map<string, unknown>(startedIds.map((id) => [id, {}]));
  return {
    started,
    mayStop: () => null,
    start(ids: readonly string[]) {
      for (const id of ids) {
        started.set(id, {});
      }
    },
    async stop(id: string) {
      if (id === throwsOn) {
        throw new Error(`stop of ${id} failed`);
      }
      const ids = id === 'b' ? ['c', 'b'] : [id];
      const stopped = ids.filter((each) => started.has(each));
      for (const each of stopped) {
        started.delete(each);
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
      case: 'a stop that throws on the second id replies the first',
      started: ['a', 'c'],
      throwsOn: 'c',
      request: { kind: 'stop', ids: ['a', 'c'] } as PluginPartsRequest,
      reply: { stopped: ['a'] },
      logs: ['plugin-switch: page stop failed: stop of c failed'],
      reapplied: 0,
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
