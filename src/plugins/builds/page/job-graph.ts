import type { BuildJob } from '../contract';

// An arrow of the job graph: `from` is the prerequisite's id, `to` the id of the job that waits on it.
export interface JobEdge {
  from: string;
  to: string;
}

// A build's jobs laid out left to right. `columns[c]` holds the ids of the jobs in column `c`, in their order in the
// build's jobs; no column is empty. `edges` holds one edge per used prerequisite (see `jobGraph`).
export interface JobGraph {
  columns: string[][];
  edges: JobEdge[];
}

export type GraphMove = 'left' | 'right' | 'up' | 'down';

// The graph of `jobs`. A job's column is the length of its longest chain of used prerequisites: 0 with none, else
// 1 + the largest column among them. A used prerequisite is a `dependsOn` id that names a job in `jobs`, is not a
// repeat within that `dependsOn`, and does not close a cycle. Cycles are cut by one depth-first walk over `jobs` in
// order, each job's `dependsOn` in order: an id on the walk's current path, the job itself included, is skipped.
// A job whose id an earlier job already has is left out. Edges come in `jobs` order, then `dependsOn` order.
export function jobGraph(jobs: readonly BuildJob[]): JobGraph {
  const byId = firstJobById(jobs);
  const columnOf = new Map<string, number>();
  const usedOf = new Map<string, string[]>();
  const onPath = new Set<string>();

  const visit = (job: BuildJob): void => {
    onPath.add(job.id);
    const used: string[] = [];
    let column = 0;
    for (const id of job.dependsOn) {
      const prerequisite = byId.get(id);
      const closesCycle = onPath.has(id);
      const isRepeat = used.includes(id);
      if (!prerequisite || closesCycle || isRepeat) {
        continue;
      }
      if (!columnOf.has(id)) {
        visit(prerequisite);
      }
      used.push(id);
      column = Math.max(column, (columnOf.get(id) ?? 0) + 1);
    }
    onPath.delete(job.id);
    columnOf.set(job.id, column);
    usedOf.set(job.id, used);
  };

  for (const job of byId.values()) {
    if (!columnOf.has(job.id)) {
      visit(job);
    }
  }

  const columns: string[][] = [];
  const edges: JobEdge[] = [];
  for (const job of byId.values()) {
    const column = columnOf.get(job.id) ?? 0;
    (columns[column] ??= []).push(job.id);
    for (const from of usedOf.get(job.id) ?? []) {
      edges.push({ from, to: job.id });
    }
  }
  return { columns, edges };
}

// The job a build selects on open: the first job in `jobs` order that is running, else the first that failed, else
// the last id of the last column of `graph`. Null for no jobs. A job whose id an earlier job already has is skipped.
export function defaultJob(
  jobs: readonly BuildJob[],
  graph: JobGraph,
): string | null {
  const unique = [...firstJobById(jobs).values()];
  const running = unique.find((job) => job.state === 'running');
  const failed = unique.find((job) => job.result === 'failure');
  const lastColumn = graph.columns.at(-1);
  return running?.id ?? failed?.id ?? lastColumn?.at(-1) ?? null;
}

// The job the cursor lands on after `move` from `job`. Up and down step within the column and hold at its ends.
// Left and right step a column and hold at the graph's ends: they land on the first job of that column (column order)
// joined to `job` by an edge, else on `job`'s row clamped to that column. A null `job`, or one the graph lacks,
// lands on the first job of column 0; null for an empty graph.
export function movedJob(
  graph: JobGraph,
  job: string | null,
  move: GraphMove,
): string | null {
  const first = graph.columns[0]?.[0] ?? null;
  if (job === null) {
    return first;
  }
  const column = graph.columns.findIndex((ids) => ids.includes(job));
  if (column === -1) {
    return first;
  }
  const ids = graph.columns[column];
  const row = ids.indexOf(job);
  switch (move) {
    case 'up':
      return ids[row - 1] ?? job;
    case 'down':
      return ids[row + 1] ?? job;
    case 'right': {
      const next = graph.columns[column + 1];
      if (!next) {
        return job;
      }
      const joined = next.find((id) =>
        graph.edges.some((edge) => edge.from === job && edge.to === id),
      );
      return joined ?? next[Math.min(row, next.length - 1)];
    }
    case 'left': {
      const previous = graph.columns[column - 1];
      if (!previous) {
        return job;
      }
      const joined = previous.find((id) =>
        graph.edges.some((edge) => edge.from === id && edge.to === job),
      );
      return joined ?? previous[Math.min(row, previous.length - 1)];
    }
  }
}

// `jobs` keyed by id in their order, the first job with an id winning.
function firstJobById(jobs: readonly BuildJob[]): Map<string, BuildJob> {
  const byId = new Map<string, BuildJob>();
  for (const job of jobs) {
    if (!byId.has(job.id)) {
      byId.set(job.id, job);
    }
  }
  return byId;
}
