import type { Log } from '../contracts/log';

// Newest line first.
export function createLogView(list: HTMLOListElement): Log {
  return (source, message) => {
    const entry = document.createElement('li');
    entry.textContent = `[${source}] ${message}`;
    list.prepend(entry);
  };
}
