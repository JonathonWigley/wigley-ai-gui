import { describe, expect, it, vi } from 'vitest';
import type { FeatureKey } from '../../../contracts/contributions';
import type { ConfigProblem } from '../../../contracts/settings';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { FeatureReader, FeatureStrategies } from '../contract';
import { createRegistry } from './registry';
import { type ScannedSource, scanSources } from './sources';

// A source named `name` at `/p/<name>` carrying `file`, text when a string.
function scanned(
  name: string,
  file: string | { error: string },
): ScannedSource {
  return {
    source: {
      pluginName: name,
      pluginKey: `${name}@m`,
      version: '1.0.0',
      root: `/p/${name}`,
      harnessId: 'fake',
    },
    file: typeof file === 'string' ? { text: file } : file,
  };
}

const fileOf = (name: string) => `/p/${name}/auri.json`;

const file = (sections: object) => JSON.stringify({ version: 1, ...sections });

// What `JSON.parse` throws for `text`, as `errorText` words it.
function parseError(text: string): string {
  try {
    JSON.parse(text);
    return '';
  } catch (error) {
    return errorText(error);
  }
}

const BROKEN_TEXT = '{ "retro": {}';

const WORKFLOWS_REASON =
  '[2].stages[4].enter[0]: "from" names no stage or group: featureRn';

// A reader that accepts an object section with no `bad` field as itself, and
// refuses one with `bad`, giving its reasons; a section `"throw"` throws.
function reader(label: string): FeatureReader<unknown> {
  return {
    label,
    read(section) {
      if (section === 'throw') {
        throw new Error('boom');
      }
      if (!isJsonObject(section)) {
        return { ok: false, reasons: ['is not an object'] };
      }
      const bad = section.bad;
      if (bad === undefined) {
        return { ok: true, value: section };
      }
      return { ok: false, reasons: Array.isArray(bad) ? bad.map(String) : [] };
    },
  };
}

// A registry over a map-backed slot, recording each problem list and log line.
function setUp() {
  const slot = new Map<string, FeatureStrategies>();
  const problems: (readonly ConfigProblem[])[] = [];
  const logged: string[] = [];
  const registry = createRegistry({
    slot: {
      set: (key, value) => slot.set(key, value),
      delete: (key) => slot.delete(key),
    },
    paths: posixPaths,
    log: (message) => logged.push(message),
    setProblems: (list) => problems.push(list),
  });
  const lastProblems = () => problems[problems.length - 1];
  const ids = (key: FeatureKey) =>
    registry.strategies(key).map((strategy) => strategy.id);
  return { registry, slot, lastProblems, logged, ids };
}

describe('createRegistry', () => {
  // Catches problems served in registration order.
  it('serves file problems, then section problems by source then key', () => {
    const { registry, lastProblems } = setUp();
    registry.register('retro', reader('Retro'));
    registry.register('workflows', reader('Workflows'));

    registry.scanned([
      scanned(
        'first',
        file({ retro: { bad: ['x'] }, workflows: { bad: ['[0]: y'] } }),
      ),
      scanned('second', BROKEN_TEXT),
    ]);

    expect(lastProblems()).toEqual([
      {
        file: fileOf('second'),
        message: `second: auri.json is not JSON: ${parseError(BROKEN_TEXT)}`,
      },
      { file: fileOf('first'), message: 'first: workflows[0]: y' },
      { file: fileOf('first'), message: 'first: retro: x' },
    ]);
  });

  // Catches an empty or non-string label shown in Settings.
  it.each<{ name: string; section: unknown; label: string }>([
    {
      name: 'a label',
      section: { label: 'Wigley levels' },
      label: 'Wigley levels',
    },
    { name: 'an empty label', section: { label: '' }, label: 'wigley' },
    { name: 'a number label', section: { label: 5 }, label: 'wigley' },
    { name: 'no label', section: {}, label: 'wigley' },
    { name: 'an array section', section: [{ label: 'x' }], label: 'wigley' },
  ])('labels a strategy of $name', ({ section, label }) => {
    const { registry } = setUp();
    registry.register('backlog', {
      label: 'Backlog',
      read: (value) => ({ ok: true, value }),
    });

    registry.scanned([scanned('wigley', file({ backlog: section }))]);

    expect(registry.strategies('backlog').map((each) => each.label)).toEqual([
      label,
    ]);
  });

  it('runs a reader registered after the scan at once, with no new read', async () => {
    const { registry, slot } = setUp();
    const files = createMemoryFiles();
    await files.write('/app/agent-plugin/auri.json', file({ retro: {} }));
    const sources = await scanSources(
      { files, paths: posixPaths, appDir: '/app', log: () => undefined },
      [],
    );
    registry.scanned(sources);
    const read = vi.spyOn(files, 'read');

    registry.register('retro', reader('Retro'));

    expect(read).not.toHaveBeenCalled();
    expect(slot.get('retro')?.strategies.map(({ id }) => id)).toEqual([
      'auri',
    ]);
  });

  // Catches a bad file that leaks a section.
  it.each<{ name: string; file: string | { error: string }; message: string }>([
    {
      name: 'unreadable',
      file: { error: 'EACCES: denied' },
      message: 'wigley: auri.json not read: EACCES: denied',
    },
    {
      name: 'not JSON',
      file: BROKEN_TEXT,
      message: `wigley: auri.json is not JSON: ${parseError(BROKEN_TEXT)}`,
    },
    {
      name: 'an array',
      file: '[{ "retro": {} }]',
      message: 'wigley: auri.json is not an object',
    },
    {
      name: 'version 2',
      file: JSON.stringify({ version: 2, retro: {} }),
      message: 'wigley: auri.json version is 2, not 1',
    },
  ])('gives one problem and no section for a file $name', (row) => {
    const { registry, lastProblems, ids } = setUp();
    registry.register('retro', reader('Retro'));

    registry.scanned([scanned('wigley', row.file)]);

    expect(lastProblems()).toEqual([
      { file: fileOf('wigley'), message: row.message },
    ]);
    expect(ids('retro')).toEqual([]);
  });

  // Catches one bad section dropping the whole plugin.
  it('keeps the good sections of a file with a bad one', () => {
    const { registry, lastProblems, ids } = setUp();
    registry.register('retro', reader('Retro'));
    registry.register('backlog', reader('Backlog'));

    registry.scanned([
      scanned('wigley', file({ retro: { bad: ['x'] }, backlog: {} })),
    ]);

    expect(ids('backlog')).toEqual(['wigley']);
    expect(ids('retro')).toEqual([]);
    expect(lastProblems()).toEqual([
      {
        file: fileOf('wigley'),
        message: expect.stringMatching(/^wigley: retro/),
      },
    ]);
  });

  it.each<{ key: FeatureKey; reasons: string[]; message: string }>([
    {
      key: 'workflows',
      reasons: [WORKFLOWS_REASON],
      message: `wigley: workflows${WORKFLOWS_REASON}`,
    },
    {
      key: 'retro',
      reasons: ['command is not a string'],
      message: 'wigley: retro: command is not a string',
    },
    {
      key: 'retro',
      reasons: ['.command is not a string', 'folder is missing'],
      message:
        'wigley: retro.command is not a string\nwigley: retro: folder is missing',
    },
  ])('joins the reasons $reasons under $key', ({ key, reasons, message }) => {
    const { registry, lastProblems } = setUp();
    registry.register(key, reader('Feature'));

    registry.scanned([scanned('wigley', file({ [key]: { bad: reasons } }))]);

    expect(lastProblems()).toEqual([{ file: fileOf('wigley'), message }]);
  });

  it('logs a key no feature reads once per scan', () => {
    const { registry, logged } = setUp();
    registry.register('retro', reader('Retro'));
    const text = file({ retro: {}, extra: {}, $schema: 'x' });

    registry.scanned([scanned('wigley', text)]);
    registry.register('backlog', reader('Backlog'));
    const afterOne = [...logged];
    registry.scanned([scanned('wigley', text)]);

    const line = 'wigley: auri.json key extra is read by no feature; ignored';
    expect(afterOne).toEqual([line]);
    expect(logged).toEqual([line, line]);
  });

  it('throws on a feature registered twice', () => {
    const { registry } = setUp();
    registry.register('retro', reader('Retro'));

    expect(() => registry.register('retro', reader('Retro'))).toThrow(
      'feature retro is already registered',
    );
  });

  it('gives a reader that throws a section problem', () => {
    const { registry, lastProblems } = setUp();
    registry.register('retro', reader('Retro'));

    registry.scanned([scanned('wigley', file({ retro: 'throw' }))]);

    expect(lastProblems()).toEqual([
      { file: fileOf('wigley'), message: 'wigley: retro: reader failed: boom' },
    ]);
  });

  // Catches a slot write loop.
  it('writes nothing and tells no listener on an unchanged scan', () => {
    const { registry, slot } = setUp();
    registry.register('retro', reader('Retro'));
    registry.scanned([scanned('wigley', file({ retro: {} }))]);
    const before = slot.get('retro');
    const heard: unknown[] = [];
    registry.onChanged('retro', (strategies) => heard.push(strategies));

    registry.scanned([scanned('wigley', file({ retro: {} }))]);

    expect(heard).toEqual([]);
    expect(slot.get('retro')).toBe(before);
  });

  it('tells listeners the new strategies on a change', () => {
    const { registry } = setUp();
    registry.register('retro', reader('Retro'));
    const heard: string[][] = [];
    registry.onChanged('retro', (strategies) =>
      heard.push(strategies.map(({ id }) => id)),
    );

    registry.scanned([scanned('wigley', file({ retro: {} }))]);

    expect(heard).toEqual([['wigley']]);
  });

  it('serves an empty list for a registered feature no source binds', () => {
    const { registry, slot } = setUp();

    registry.register('retro', reader('Retro'));

    expect(slot.get('retro')).toEqual({
      key: 'retro',
      label: 'Retro',
      strategies: [],
    });
  });

  it("removes the slot key and the feature's problems on dispose", () => {
    const { registry, slot, lastProblems } = setUp();
    const registration = registry.register('retro', reader('Retro'));
    registry.scanned([scanned('wigley', file({ retro: { bad: ['x'] } }))]);
    const heard: unknown[] = [];
    registry.onChanged('retro', (strategies) => heard.push(strategies));

    registration.dispose();

    expect(slot.has('retro')).toBe(false);
    expect(lastProblems()).toEqual([]);
    expect(heard).toEqual([]);
  });
});
