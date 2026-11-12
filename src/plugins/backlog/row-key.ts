import type { RowKey } from './contract';

// The key of the follow-up titled `title` among every repo's rows, the same in
// main and the page.
export function rowKey(repo: string, title: string): RowKey {
  return `${repo}\n${title}`;
}
