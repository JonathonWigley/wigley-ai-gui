import { errorText } from '../shared/error-text';

// How long the self-test's exit waits for its teardowns to settle before it
// removes the temp home anyway.
export const SELF_TEST_TEARDOWN_CAP_MS = 5000;

// What the self-test closes before it removes its temp home. Each thing that
// holds a handle in the home `add`s its teardown as soon as it exists, so an
// exit at any point closes whatever has started, except plugin parts when a
// part's start threw, which leaves no host to stop them. `run` starts every
// teardown at once, in the order added, waits at most the cap for them all to
// settle, then removes the home; a teardown added while `run` runs starts at
// once. `run` never rejects: on stderr it reports a teardown that failed or did
// not settle within the cap, and a home the removal left.
export interface SelfTestTeardown {
  add(name: string, teardown: () => unknown): void;
  run(): Promise<void>;
}

interface Started {
  name: string;
  isSettled: boolean;
  settled: Promise<void>;
}

function startTeardown(name: string, teardown: () => unknown): Started {
  const started: Started = {
    name,
    isSettled: false,
    settled: Promise.resolve(),
  };
  started.settled = (async () => teardown())()
    .then(
      () => {},
      (error: unknown) =>
        console.error(
          `[selftest] teardown of ${name} failed: ${errorText(error)}`,
        ),
    )
    .finally(() => {
      started.isSettled = true;
    });
  return started;
}

// Waits until every teardown in `started` has settled, including ones added
// while it waits, or until `capMs` passes.
async function settleWithin(started: readonly Started[], capMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutOff = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), capMs);
  });
  let awaited = 0;
  while (awaited < started.length) {
    const batch = started.slice(awaited).map((entry) => entry.settled);
    awaited = started.length;
    const isCutOff = await Promise.race([
      Promise.all(batch).then(() => false),
      cutOff,
    ]);
    if (isCutOff) {
      break;
    }
  }
  clearTimeout(timer);
}

// `removeHome` deletes the temp home; `capMs` bounds the wait for the
// teardowns.
export function createSelfTestTeardown(
  removeHome: () => Promise<void>,
  capMs: number = SELF_TEST_TEARDOWN_CAP_MS,
): SelfTestTeardown {
  const added: { name: string; teardown: () => unknown }[] = [];
  const started: Started[] = [];
  let running: Promise<void> | null = null;

  const tearDown = async () => {
    for (const { name, teardown } of added) {
      started.push(startTeardown(name, teardown));
    }
    await settleWithin(started, capMs);
    for (const { name, isSettled } of started) {
      if (!isSettled) {
        console.error(
          `[selftest] teardown of ${name} did not settle within ${capMs} ms`,
        );
      }
    }
    try {
      await removeHome();
    } catch (error) {
      console.error(`[selftest] temp home left: ${errorText(error)}`);
    }
  };

  return {
    add(name, teardown) {
      if (running === null) {
        added.push({ name, teardown });
        return;
      }
      started.push(startTeardown(name, teardown));
    },
    run() {
      running ??= tearDown();
      return running;
    },
  };
}
