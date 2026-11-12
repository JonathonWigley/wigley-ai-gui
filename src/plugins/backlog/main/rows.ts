import type { BacklogRead, RowKey } from '../contract';
import { rowKey } from '../row-key';

// One follow-up of a load, done or open. `path` is its follow-up file's full
// path and `line` its 1-based line there; `homeRoot` and `repoFolder` are its
// home's.
export interface BacklogRow {
  key: RowKey;
  repo: string;
  title: string;
  oneLine: string;
  tags: string[];
  body: string;
  done: boolean;
  path: string;
  line: number;
  homeRoot: string;
  repoFolder: string | null;
}

// One row per item of every home's follow-up files: the repos in the order
// each first appears in `read.homes`, each repo's homes in that order, then
// files and items in order. An item whose key an earlier row holds is left
// out.
export function backlogRows(read: BacklogRead): BacklogRow[] {
  const repos = [...new Set(read.homes.map((home) => home.repo))];
  const homes = repos.flatMap((repo) =>
    read.homes.filter((home) => home.repo === repo),
  );
  const rows: BacklogRow[] = [];
  const keys = new Set<RowKey>();
  for (const home of homes) {
    for (const file of home.followupFiles) {
      for (const item of file.items) {
        const key = rowKey(home.repo, item.title);
        if (keys.has(key)) {
          continue;
        }
        keys.add(key);
        rows.push({
          key,
          repo: home.repo,
          title: item.title,
          oneLine: item.oneLine,
          tags: item.tags,
          body: item.body,
          done: item.done,
          path: file.path,
          line: item.line,
          homeRoot: home.root,
          repoFolder: home.repoFolder,
        });
      }
    }
  }
  return rows;
}
