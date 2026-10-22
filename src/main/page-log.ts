import type { Log } from '../contracts/log';

// The page's log, which hears only while a page is loaded: a line logged while
// the page loads waits, and `pageLoaded` sends every waiting line in order.
// It starts loading, as the window starts loading its page at creation.
export interface PageLog {
  log: Log;
  pageLoading(): void;
  pageLoaded(): void;
}

// A page log over `send`, which sends one line to the page.
export function createPageLog(send: Log): PageLog {
  let waiting: [string, string][] | null = [];
  return {
    log: (source, message) => {
      if (waiting === null) {
        send(source, message);
      } else {
        waiting.push([source, message]);
      }
    },
    pageLoading: () => {
      waiting ??= [];
    },
    pageLoaded: () => {
      const lines = waiting ?? [];
      waiting = null;
      for (const [source, message] of lines) {
        send(source, message);
      }
    },
  };
}
