import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { errorText } from '../../shared/error-text';
import { isJsonObject } from '../../shared/json';

export interface DriveServerDeps {
  // Every request must carry `Authorization: Bearer <token>`.
  token: string;
  run(command: string, args: unknown): Promise<unknown>;
  // The commands that run as they arrive, beside the queue, so a stuck
  // command ahead of them cannot hold them.
  unqueued: readonly string[];
}

export interface DriveServer {
  port: number;
  // Stops listening and drops open connections.
  close(): Promise<void>;
}

// The commands over HTTP on 127.0.0.1, on a port the OS picks. Only `POST /`
// with the token and a `{ command, args? }` JSON body runs a command, one at a
// time in arrival order but for the `unqueued` ones; the reply is `{ ok: true, result }`, or
// `{ ok: false, error }` with 200 when the command rejects, 401 for a bad
// token, 400 for a bad body, 404 for any other method or path, and 500 when
// the request itself fails.
export async function startDriveServer(
  deps: DriveServerDeps,
): Promise<DriveServer> {
  let queue: Promise<unknown> = Promise.resolve();
  const runInTurn = (command: string, args: unknown) => {
    if (deps.unqueued.includes(command)) {
      return deps.run(command, args);
    }
    const result = queue.then(() => deps.run(command, args));
    queue = result.catch(() => {});
    return result;
  };
  const server = createServer((request, response) => {
    answer(request, response, deps.token, runInTurn).catch((error) => {
      if (!response.headersSent) {
        reply(response, 500, { ok: false, error: errorText(error) });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  run: DriveServerDeps['run'],
): Promise<void> {
  if (request.headers.authorization !== `Bearer ${token}`) {
    reply(response, 401, { ok: false, error: 'bad token' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/') {
    reply(response, 404, { ok: false, error: 'only POST / is served' });
    return;
  }
  const body = parseBody(await readBody(request));
  if (typeof body === 'string') {
    reply(response, 400, { ok: false, error: body });
    return;
  }
  try {
    const result = await run(body.command, body.args);
    reply(response, 200, { ok: true, result: result ?? null });
  } catch (error) {
    reply(response, 200, { ok: false, error: errorText(error) });
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// The command and args `text` asks for, or why it is not a command.
function parseBody(text: string): { command: string; args: unknown } | string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return `body is not JSON: ${errorText(error)}`;
  }
  const notACommand = 'body is not { command: string, args?: object }';
  if (!isJsonObject(body)) {
    return notACommand;
  }
  const { command, args } = body;
  const hasArgsObject = args === undefined || isJsonObject(args);
  if (typeof command !== 'string' || !hasArgsObject) {
    return notACommand;
  }
  return { command, args };
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
