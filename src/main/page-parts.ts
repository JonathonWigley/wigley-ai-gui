import type { IpcMain, WebContents } from 'electron';
import {
  BRIDGE_CHANNELS,
  type PluginPartsReply,
  type PluginPartsRequest,
} from '../contracts/bridge';
import type { RuntimeCatalog } from '../contracts/core-state';
import type { Log } from '../contracts/log';
import type { SlotReader } from '../contracts/state';

// Asks the page's plugin host to stop, start or check its parts. A request waits
// until the page's parts have started, then resolves once the page answers. With
// no page, or once the page's `started` falls, it resolves the empty reply of its
// kind.
export interface PageParts {
  request(request: PluginPartsRequest): Promise<PluginPartsReply>;
}

function emptyReply(request: PluginPartsRequest): PluginPartsReply {
  switch (request.kind) {
    case 'mayStop':
      return { reason: null };
    case 'stop':
      return { stopped: [] };
    case 'start':
      return { started: [] };
  }
}

interface Waiting {
  request: PluginPartsRequest;
  resolve(reply: PluginPartsReply): void;
}

export function createPageParts(deps: {
  page(): WebContents | null;
  catalog: SlotReader<RuntimeCatalog>;
  ipc: Pick<IpcMain, 'on'>;
  log: Log;
}): PageParts {
  // Sent to the page, by number.
  const sent = new Map<number, Waiting>();
  // Held until the page's parts have started.
  let held: { number: number; waiting: Waiting }[] = [];
  let lastNumber = 0;
  const isStarted = () => deps.catalog.get()?.started === true;
  deps.ipc.on(
    BRIDGE_CHANNELS.pluginPartsDone,
    (_event, number: number, reply: PluginPartsReply) => {
      sent.get(number)?.resolve(reply);
      sent.delete(number);
    },
  );

  const send = (number: number, waiting: Waiting) => {
    const page = deps.page();
    if (page === null) {
      waiting.resolve(emptyReply(waiting.request));
      return;
    }
    sent.set(number, waiting);
    page.send(BRIDGE_CHANNELS.pluginParts, number, waiting.request);
  };

  let wasStarted = isStarted();
  deps.catalog.on((catalog) => {
    const nowStarted = catalog?.started === true;
    if (!wasStarted && nowStarted) {
      const sending = held;
      held = [];
      for (const { number, waiting } of sending) {
        send(number, waiting);
      }
    }
    if (wasStarted && !nowStarted) {
      for (const { request, resolve } of sent.values()) {
        deps.log('plugin-switch', `page ${request.kind} ended with the page`);
        resolve(emptyReply(request));
      }
      sent.clear();
    }
    wasStarted = nowStarted;
  });

  return {
    request(request) {
      if (deps.page() === null) {
        return Promise.resolve(emptyReply(request));
      }
      lastNumber += 1;
      const number = lastNumber;
      return new Promise((resolve) => {
        const waiting = { request, resolve };
        if (isStarted()) {
          send(number, waiting);
        } else {
          held.push({ number, waiting });
        }
      });
    },
  };
}
