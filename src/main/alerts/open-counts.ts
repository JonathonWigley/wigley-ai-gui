// Each source's latest open count; `set` records one and returns the sum over every source.
export function createOpenCounts(): {
  set(source: string, count: number): number;
} {
  const counts = new Map<string, number>();
  return {
    set(source, count) {
      counts.set(source, count);
      let total = 0;
      for (const sourceCount of counts.values()) {
        total += sourceCount;
      }
      return total;
    },
  };
}
