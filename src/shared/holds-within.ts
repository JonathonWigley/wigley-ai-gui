// How often `holdsWithin` asks its probe.
const POLL_MS = 25;

// Whether `probe` answers true within `timeoutMs`, asking every `POLL_MS`; a
// probe that rejects counts as false. Self-test results wait on the disk with
// it.
export async function holdsWithin(
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}
