import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_CHANNELS,
  type PluginPartsReply,
  type PluginPartsRequest,
} from '../contracts/bridge';
import type { RuntimeCatalog } from '../contracts/core-state';
import { EMPTY_RUNTIME_CATALOG } from '../shared/runtime-commands';
import { createPageParts } from './page-parts';

function setup(hasPage: boolean, isStarted: boolean) {
  const logs: string[] = [];
  const send = vi.fn();
  const listeners = new Set<(value: RuntimeCatalog | undefined) => void>();
  let catalog: RuntimeCatalog = {
    ...EMPTY_RUNTIME_CATALOG,
    started: isStarted,
  };
  let done: (
    event: unknown,
    number: number,
    reply: PluginPartsReply,
  ) => void = () => {};
  const parts = createPageParts({
    page: () => (hasPage ? ({ send } as unknown as WebContents) : null),
    catalog: {
      get: () => catalog,
      on(listener) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    ipc: {
      on(channel: string, listener: (...args: never[]) => void) {
        if (channel === BRIDGE_CHANNELS.pluginPartsDone) {
          done = listener as typeof done;
        }
        return undefined as never;
      },
    },
    log: (source, message) => logs.push(`${source}: ${message}`),
  });
  return {
    parts,
    send,
    logs,
    setStarted(started: boolean) {
      catalog = { ...catalog, started };
      for (const listener of listeners) {
        listener(catalog);
      }
    },
    done: (number: number, reply: PluginPartsReply) => done({}, number, reply),
  };
}

// Whether `promise` has settled once queued work has run.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

describe('createPageParts', () => {
  it('request_WaitsForStartedThenResolvesTheReply', async () => {
    const { parts, send, setStarted, done } = setup(true, false);
    const request: PluginPartsRequest = { kind: 'stop', ids: ['a'] };

    const reply = parts.request(request);
    const sentBeforeStarted = send.mock.calls.length;
    setStarted(true);
    const [channel, number, sentRequest] = send.mock.calls[0];
    const settledBeforeDone = await isSettled(reply);
    done(number, { stopped: ['a'] });

    expect(sentBeforeStarted).toBe(0);
    expect([channel, sentRequest]).toEqual([
      BRIDGE_CHANNELS.pluginParts,
      request,
    ]);
    expect(settledBeforeDone).toBe(false);
    expect(await reply).toEqual({ stopped: ['a'] });
  });

  it.each(
    [
      { kind: 'mayStop' as const, empty: { reason: null } },
      { kind: 'stop' as const, empty: { stopped: [] } },
      { kind: 'start' as const, empty: { started: [] } },
    ].flatMap((row) => [
      {
        ...row,
        case: 'no page',
        hasPage: false,
        isStarted: true,
        isGone: false,
        logs: [] as string[],
      },
      {
        ...row,
        case: 'started falling',
        hasPage: true,
        isStarted: true,
        isGone: false,
        logs: [`plugin-switch: page ${row.kind} ended with the page`],
      },
      {
        ...row,
        case: 'page gone while held',
        hasPage: true,
        isStarted: false,
        isGone: true,
        logs: [`plugin-switch: page ${row.kind} ended with the page`],
      },
      {
        ...row,
        case: 'page gone while sent',
        hasPage: true,
        isStarted: true,
        isGone: true,
        logs: [`plugin-switch: page ${row.kind} ended with the page`],
      },
    ]),
  )('request_PageEndsOrNoPage_ResolvesEmpty: $kind, $case', async (row) => {
    const { parts, logs, setStarted } = setup(row.hasPage, row.isStarted);

    const reply = parts.request({ kind: row.kind, ids: ['a'] });
    if (row.isGone) {
      parts.pageGone();
    } else {
      setStarted(false);
    }

    expect(await reply).toEqual(row.empty);
    expect(logs).toEqual(row.logs);
  });

  it('request_AfterPageGone_ResolvesEmptyAndSendsNothing', async () => {
    const { parts, send } = setup(true, true);
    parts.pageGone();

    const reply = await parts.request({ kind: 'stop', ids: ['a'] });

    expect(reply).toEqual({ stopped: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
