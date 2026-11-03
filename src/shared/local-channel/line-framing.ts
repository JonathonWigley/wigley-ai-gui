import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';

const NEWLINE = 0x0a;

// Collects bytes up to the first newline, then calls `received` with the line
// and leaves the socket paused, the bytes that followed put back in front. The
// socket's owner adds its `error` listener.
export function readFirstLine(
  socket: Socket,
  received: (line: string) => void,
): void {
  let pending = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    const newline = pending.indexOf(NEWLINE);
    if (newline === -1) {
      return;
    }
    socket.pause();
    socket.off('data', onData);
    const rest = pending.subarray(newline + 1);
    if (rest.length > 0) {
      socket.unshift(rest);
    }
    received(pending.subarray(0, newline).toString('utf8'));
  };
  socket.on('data', onData);
}

export interface ReadLinesOptions {
  // True: a partial last line at the stream's end is delivered when not empty.
  flushPartialAtEnd: boolean;
}

// Calls `received` once per newline-ended line, in order, without the newline.
// Works on bytes, so a line or a character split across chunks comes out whole.
// The stream's owner adds its `error` listener.
export function readLines(
  stream: Readable,
  received: (line: string) => void,
  options: ReadLinesOptions = { flushPartialAtEnd: false },
): void {
  let pending = Buffer.alloc(0);
  stream.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    let lineStart = 0;
    let newline = pending.indexOf(NEWLINE);
    while (newline !== -1) {
      received(pending.subarray(lineStart, newline).toString('utf8'));
      lineStart = newline + 1;
      newline = pending.indexOf(NEWLINE, lineStart);
    }
    pending = pending.subarray(lineStart);
  });
  stream.on('end', () => {
    if (options.flushPartialAtEnd && pending.length > 0) {
      received(pending.toString('utf8'));
    }
  });
}

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
