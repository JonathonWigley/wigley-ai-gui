import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../../../contracts/files';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../../shared/memory-files';
import type { LayoutChoice } from '../../contract';
import { type LayoutRegistry, startLayoutRegistry } from './layout-registry';

const LAYOUT_TYPES = 'declare const types: 1;';
const DEFAULT_LAYOUT = 'export default { name: "built-in" };';

let files: MemoryFiles;
let sent: LayoutChoice[];
let logLines: string[];

beforeEach(() => {
  files = createMemoryFiles();
  sent = [];
  logLines = [];
});

function start(data: Files = files): Promise<LayoutRegistry> {
  return startLayoutRegistry({
    data,
    send: (choice) => sent.push(choice),
    log: (source, message) => logLines.push(`[${source}] ${message}`),
    layoutTypes: LAYOUT_TYPES,
    defaultLayout: DEFAULT_LAYOUT,
  });
}

async function writeLayouts(...names: string[]): Promise<void> {
  for (const name of names) {
    await files.write(`layouts/${name}/layout.js`, `// ${name}`);
  }
}

// `files` with every watch report held until `flush`, as the Node adapter
// reports a write only after its debounce.
function withHeldReports(inner: Files): { data: Files; flush(): void } {
  const held: (() => void)[] = [];
  return {
    data: {
      read: (path) => inner.read(path),
      write: (path, text) => inner.write(path, text),
      list: (folder, options) => inner.list(folder, options),
      watch: (folder, onChange) =>
        inner.watch(folder, (path) => held.push(() => onChange(path))),
    },
    flush: () => {
      for (const report of held.splice(0)) {
        report();
      }
    },
  };
}

describe('start', () => {
  it('start_NoActiveFile_DefaultActive', async () => {
    await writeLayouts('alpha');

    const registry = await start();

    expect(registry.current()).toMatchObject({
      name: 'default',
      builtIn: true,
      hasCss: false,
      reason: 'start',
    });
    await expect(files.read('layouts/active')).rejects.toThrow();
  });

  it('start_WritesLayoutTypes', async () => {
    await start();

    expect(await files.read('layouts/layout.d.ts')).toBe(LAYOUT_TYPES);
  });

  it('start_ActiveNamesMissingFolder_DefaultActive', async () => {
    await writeLayouts('alpha');
    await files.write('layouts/active', 'gone\n');

    const registry = await start();

    expect(registry.current().name).toBe('default');
    expect(await files.read('layouts/active')).toBe('gone\n');
  });

  it('start_ActiveNamesListedFolder_ThatLayoutActive', async () => {
    await writeLayouts('alpha');
    await files.write('layouts/active', 'alpha\n');

    const registry = await start();

    expect(registry.current()).toMatchObject({ name: 'alpha', builtIn: false });
  });

  it('start_UserFolderNamedDefault_IsSkippedAndLogged', async () => {
    await writeLayouts('default', 'alpha');

    const registry = await start();
    await registry.cycle(1);
    const back = await registry.cycle(1);

    expect(back).toMatchObject({ name: 'default', builtIn: true });
    expect(sent.map((choice) => choice.name)).toEqual(['alpha', 'default']);
    expect(logLines).toContain(
      '[forms] layouts/default is ignored; the built-in default layout wins',
    );
  });
});

describe('cycle', () => {
  it('cycle_Forward_WrapsToDefaultAndPersists', async () => {
    await writeLayouts('alpha', 'beta');
    await files.write('layouts/active', 'beta');
    const registry = await start();

    const cycled = await registry.cycle(1);

    expect(cycled).toMatchObject({ name: 'default', reason: 'cycled' });
    expect(await files.read('layouts/active')).toBe('default');
    expect(sent).toEqual([cycled]);
  });

  it('cycle_Backward_FromDefault_WrapsToLast', async () => {
    await writeLayouts('beta', 'alpha');
    const registry = await start();

    const cycled = await registry.cycle(-1);

    expect(cycled).toMatchObject({ name: 'beta', reason: 'cycled' });
    expect(await files.read('layouts/active')).toBe('beta');
  });
});

describe('watch', () => {
  it('watch_SaveInActiveFolder_BumpsRevisionAndSendsReloaded', async () => {
    await writeLayouts('alpha');
    await files.write('layouts/active', 'alpha');
    const registry = await start();
    const before = registry.current().revision;

    await files.write('layouts/alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ name: 'alpha', reason: 'reloaded' });
    expect(sent[0].revision).toBeGreaterThan(before);
  });

  it('watch_ActiveLayoutJsRemoved_FallsBackToDefault', async () => {
    await writeLayouts('alpha');
    await files.write('layouts/active', 'alpha');
    await start();

    files.remove('layouts/alpha/layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ name: 'default', reason: 'cycled' });
    expect(await files.read('layouts/active')).toBe('default');
  });

  it('watch_SaveInInactiveFolder_BumpsRevisionWithoutSending', async () => {
    await writeLayouts('alpha');
    const registry = await start();
    const before = registry.current().revision;

    await files.write('layouts/alpha/layout.js', '// saved');
    const cycled = await registry.cycle(1);

    expect(sent).toEqual([cycled]);
    expect(cycled.name).toBe('alpha');
    expect(cycled.revision).toBeGreaterThan(before + 1);
  });

  it('hasCss_TrueWhenLayoutCssPresent', async () => {
    await writeLayouts('alpha');
    await files.write('layouts/active', 'alpha');
    const registry = await start();
    expect(registry.current().hasCss).toBe(false);

    await files.write('layouts/alpha/layout.css', 'body {}');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ hasCss: true, reason: 'reloaded' });
    expect(registry.current().hasCss).toBe(true);
  });
});

describe('copy', () => {
  it('copy_Default_WritesDefaultTextAndActivates', async () => {
    const registry = await start();

    const copied = await registry.copy();

    expect(await files.read('layouts/default-2/layout.js')).toBe(
      DEFAULT_LAYOUT,
    );
    expect(copied).toMatchObject({
      name: 'default-2',
      builtIn: false,
      hasCss: false,
      reason: 'copied',
    });
    expect(await files.read('layouts/active')).toBe('default-2');
    expect(sent).toEqual([copied]);
  });

  it('copy_Twice_TakesNextFreeNumber', async () => {
    const registry = await start();

    await registry.copy();
    await registry.cycle(-1);
    const copied = await registry.copy();

    expect(copied.name).toBe('default-3');
  });

  it('copy_UserLayout_CopiesEveryFileIncludingNested', async () => {
    await files.write('layouts/alpha/layout.js', '// js');
    await files.write('layouts/alpha/layout.css', '/* css */');
    await files.write('layouts/alpha/parts/card.js', '// card');
    await files.write('layouts/active', 'alpha');
    const registry = await start();

    const copied = await registry.copy();

    expect(copied).toMatchObject({ name: 'alpha-2', hasCss: true });
    expect(await files.read('layouts/alpha-2/layout.js')).toBe('// js');
    expect(await files.read('layouts/alpha-2/layout.css')).toBe('/* css */');
    expect(await files.read('layouts/alpha-2/parts/card.js')).toBe('// card');
  });

  it('copy_LateWatchReportsForCopiedFiles_SendNothing', async () => {
    await files.write('layouts/alpha/layout.js', '// js');
    await files.write('layouts/alpha/layout.css', '/* css */');
    await files.write('layouts/active', 'alpha');
    const held = withHeldReports(files);
    const registry = await start(held.data);

    await registry.copy();
    held.flush();
    await registry.cycle(1);

    expect(sent.map((choice) => choice.reason)).toEqual(['copied', 'cycled']);
  });
});
