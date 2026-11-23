import { describe, expect, it, vi } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { SessionLink, SetRun } from '../builds-model';
import { buildOffer } from '../contract.test-support';
import { createLinkStore, LINKS_FILE, PRUNE_AFTER_MS } from './link-store';

function sessionLink(overrides: Partial<SessionLink> = {}): SessionLink {
  return {
    sessionId: 's1',
    backendId: 'b1',
    buildId: 'x',
    setRunId: null,
    linkedAt: 0,
    failingNotified: false,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

function setRun(overrides: Partial<SetRun> = {}): SetRun {
  return {
    id: 'r1',
    setId: 'rc',
    label: 'RC set',
    backendId: 'b1',
    gameId: 'g1',
    sessionId: 's1',
    builds: [{ backendId: 'b1', buildId: 'x' }],
    revision: null,
    createdAt: 0,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

function setup() {
  const files = createMemoryFiles();
  const logs: string[] = [];
  const open = () => createLinkStore(files, (line) => logs.push(line));
  return { files, logs, open };
}

describe('createLinkStore', () => {
  it('writes each change whole and reads it back after a new load', async () => {
    const run = setup();
    const store = run.open();
    await store.load();

    store.addLinks([sessionLink()]);
    store.addSetRun(setRun());
    store.setOffer('s1', buildOffer({ createdAt: 5 }));
    store.updateLinks((link) => link.buildId === 'x', { notified: true });
    store.updateSetRun('r1', { endedAt: 300 });
    expect(await store.written()).toBe(true);
    const reloaded = run.open();
    await reloaded.load();

    expect(reloaded.links()).toEqual([sessionLink({ notified: true })]);
    expect(reloaded.setRuns()).toEqual([setRun({ endedAt: 300 })]);
    expect(reloaded.offers()).toEqual({ s1: buildOffer({ createdAt: 5 }) });
  });

  it('loads a missing file as empty and drops bad entries', async () => {
    const run = setup();
    const empty = run.open();
    await empty.load();
    expect(empty.links()).toEqual([]);
    await run.files.write(
      LINKS_FILE,
      JSON.stringify({ links: [sessionLink(), { sessionId: 7 }] }),
    );

    const store = run.open();
    await store.load();

    expect(store.links()).toEqual([sessionLink()]);
    expect(run.logs).toEqual(['session-links.json: dropped 1 bad entries']);
  });

  it.each([
    { case: 'not JSON', text: '{' },
    { case: 'an array', text: '[]' },
  ])('writes nothing after a load of $case', async ({ text }) => {
    const run = setup();
    await run.files.write(LINKS_FILE, text);
    const store = run.open();

    await expect(store.load()).rejects.toThrow();
    store.addLinks([sessionLink()]);

    expect(await store.written()).toBe(false);
    expect(await run.files.read(LINKS_FILE)).toBe(text);
  });

  it('reads a missing member as empty and counts bad entries across members', async () => {
    const run = setup();
    await run.files.write(LINKS_FILE, '{"links":[]}');
    const sparse = run.open();
    await sparse.load();
    expect(sparse.setRuns()).toEqual([]);
    expect(sparse.offers()).toEqual({});
    expect(run.logs).toEqual([]);
    await run.files.write(
      LINKS_FILE,
      '{"links":[1],"setRuns":["x"],"offers":{"s1":5}}',
    );

    const store = run.open();
    await store.load();

    expect([store.links(), store.setRuns(), store.offers()]).toEqual([[], [], {}]);
    expect(run.logs).toEqual(['session-links.json: dropped 3 bad entries']);
  });

  it('resolves written false when a write rejects', async () => {
    const run = setup();
    const store = run.open();
    await store.load();
    vi.spyOn(run.files, 'write').mockRejectedValueOnce(new Error('disk full'));

    store.addLinks([sessionLink()]);

    expect(await store.written()).toBe(false);
    expect(run.logs).toEqual(['session-links.json not written: disk full']);
  });

  const now = 10 * PRUNE_AFTER_MS;
  it.each([
    {
      case: 'ended at the limit',
      add: { link: sessionLink({ endedAt: now - PRUNE_AFTER_MS }) },
      listed: true,
      kept: true,
    },
    {
      case: 'ended past the limit',
      add: { link: sessionLink({ endedAt: now - PRUNE_AFTER_MS - 1 }) },
      listed: true,
      kept: false,
    },
    {
      case: 'untold, listed, old',
      add: { link: sessionLink({ linkedAt: now - PRUNE_AFTER_MS - 1 }) },
      listed: true,
      kept: true,
    },
    {
      case: 'untold, unlisted, old',
      add: { link: sessionLink({ linkedAt: now - PRUNE_AFTER_MS - 1 }) },
      listed: false,
      kept: false,
    },
    {
      case: 'untold, unlisted, at the limit',
      add: { link: sessionLink({ linkedAt: now - PRUNE_AFTER_MS }) },
      listed: false,
      kept: true,
    },
    {
      case: 'set run ended at the limit',
      add: { setRun: setRun({ endedAt: now - PRUNE_AFTER_MS }) },
      listed: true,
      kept: true,
    },
    {
      case: 'set run ended past the limit',
      add: { setRun: setRun({ endedAt: now - PRUNE_AFTER_MS - 1 }) },
      listed: true,
      kept: false,
    },
    {
      case: 'offer at the limit',
      add: { offer: buildOffer({ createdAt: now - PRUNE_AFTER_MS }) },
      listed: true,
      kept: true,
    },
    {
      case: 'offer past the limit',
      add: { offer: buildOffer({ createdAt: now - PRUNE_AFTER_MS - 1 }) },
      listed: true,
      kept: false,
    },
  ])('prune keeps $case: $kept', async ({ add, listed, kept }) => {
    const store = setup().open();
    await store.load();
    if (add.link) {
      store.addLinks([add.link]);
    }
    if (add.setRun) {
      store.addSetRun(add.setRun);
    }
    if (add.offer) {
      store.setOffer('s1', add.offer);
    }

    const dropped = store.prune(now, () => listed);

    const held =
      store.links().length +
      store.setRuns().length +
      Object.keys(store.offers()).length;
    expect({ held, dropped }).toEqual({ held: kept ? 1 : 0, dropped: !kept });
  });
});
