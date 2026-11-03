import type { Socket } from 'node:net';
import type { Timers } from '../../contracts/ambient';
import type { Log } from '../../contracts/log';
import type {
  ClientMessage,
  ClosedEvent,
  HostMessage,
  LineEvent,
} from '../../contracts/session-host-protocol';
import { connectToChannel } from '../../shared/local-channel/local-channel';
import { jsonLine, readLines } from '../../shared/local-channel/line-framing';

export const LOG_SOURCE = 'session-host';
// How long any `hello` and any other host's `list` wait for their reply.
export const HOST_REPLY_LIMIT_MS = 1000;

// One connection to a session host.
export interface HostLink {
  // Dropped when the socket can no longer write.
  send(message: ClientMessage): void;
  // The reply to the message `build` makes from this connection's next request id. Null when the connection closes
  // first or, given `limitMs`, no reply came in that time.
  request(
    build: (requestId: number) => ClientMessage,
    limitMs?: number,
  ): Promise<HostMessage | null>;
  // Closes once what was sent has been written.
  end(): void;
  destroy(): void;
  // Resolves once the socket has closed.
  readonly closed: Promise<void>;
}

export interface HostLinkDeps {
  timers: Timers;
  log: Log;
  opened(link: HostLink): void;
  pushed(message: LineEvent | ClosedEvent): void;
  disconnected(link: HostLink): void;
}

export type HostAnswer =
  | { kind: 'unreachable' } // the connect rejected
  | { kind: 'silent' } // connected, but no `hello` reply in time
  | { kind: 'answered'; link: HostLink; protocol: number };

interface PendingRequest {
  settle(reply: HostMessage | null): void;
}

function createHostLink(socket: Socket, deps: HostLinkDeps): HostLink {
  const pending = new Map<number, PendingRequest>();
  let lastRequestId = 0;

  const received = (line: string) => {
    let message: HostMessage;
    try {
      message = JSON.parse(line) as HostMessage;
    } catch {
      deps.log(LOG_SOURCE, `a host sent a line that is not JSON: ${line}`);
      return;
    }
    if (message.type === 'line' || message.type === 'closed') {
      deps.pushed(message);
      return;
    }
    pending.get(message.requestId)?.settle(message);
  };

  const closed = new Promise<void>((resolve) => {
    socket.on('close', () => {
      for (const request of pending.values()) {
        request.settle(null);
      }
      deps.disconnected(link);
      resolve();
    });
  });

  const link: HostLink = {
    send(message) {
      if (socket.writable) {
        socket.write(jsonLine(message));
      }
    },
    request(build, limitMs) {
      return new Promise((resolve) => {
        if (!socket.writable) {
          resolve(null);
          return;
        }
        const requestId = ++lastRequestId;
        const limit =
          limitMs === undefined
            ? null
            : deps.timers.set(
                () => pending.get(requestId)?.settle(null),
                limitMs,
              );
        pending.set(requestId, {
          settle(reply) {
            pending.delete(requestId);
            if (limit !== null) {
              deps.timers.clear(limit);
            }
            resolve(reply);
          },
        });
        socket.write(jsonLine(build(requestId)));
      });
    },
    end() {
      socket.destroySoon();
    },
    destroy() {
      socket.destroy();
    },
    closed,
  };

  socket.on('error', (error) => {
    deps.log(LOG_SOURCE, `host connection error: ${error.message}`);
  });
  readLines(socket, received);
  deps.opened(link);
  return link;
}

// Connects to `channel` and sends `hello`. A link that did not answer is destroyed here.
export async function openHostLink(
  channel: string,
  deps: HostLinkDeps,
): Promise<HostAnswer> {
  let socket: Socket;
  try {
    socket = await connectToChannel(channel);
  } catch {
    return { kind: 'unreachable' };
  }
  const link = createHostLink(socket, deps);
  const reply = await link.request(
    (requestId) => ({ type: 'hello', requestId }),
    HOST_REPLY_LIMIT_MS,
  );
  if (reply?.type !== 'hello') {
    link.destroy();
    return { kind: 'silent' };
  }
  return { kind: 'answered', link, protocol: reply.protocol };
}
