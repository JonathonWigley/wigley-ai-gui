import { describe, expect, it, vi } from 'vitest';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
  type RuntimeCatalog,
} from '../contracts/core-state';
import type { Keymap } from '../contracts/keymap';
import type { CommandInfo } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { EMPTY_RUNTIME_CATALOG } from '../shared/runtime-commands';
import { wireRuntime } from './runtime-wiring';
import { createSlotHolder } from './state/slot-holder';

function keymapWithApp(command: string): Keymap {
  return {
    editor: { leader: ' ', remaps: [], binds: [] },
    page: [],
    app: [{ accelerator: 'Control+K', command }],
    intercept: [],
    global: [],
    groups: {},
  };
}

function info(id: string, runtime: boolean): CommandInfo {
  return {
    id,
    plugin: 'p',
    label: id,
    group: 'g',
    runsIn: 'main',
    ...(runtime && { runtime: true as const }),
  };
}

const COMMANDS = {
  'p.gone': info('p.gone', true),
  'p.live': info('p.live', true),
};

function setup() {
  const holder = createSlotHolder(
    () => {},
    () => {},
  );
  const setRuntime = vi.fn();
  const pageGone = vi.fn();
  const applyKeys = vi.fn();
  const logs: string[] = [];
  const changed = new Set<() => void>();
  let keymap = keymapWithApp('p.live');
  const wiring = wireRuntime({
    slots: holder.store,
    applyPageWrite: holder.applyPageWrite,
    config: {
      setRuntime,
      onChanged(listener) {
        const run = () => listener({} as AppConfig);
        changed.add(run);
        return { dispose: () => changed.delete(run) };
      },
    },
    served: () => ({ keymap, commands: COMMANDS }) as unknown as AppConfig,
    pageCommands: { pageGone },
    has: (id) => id === 'p.live',
    applyKeys,
    log: (source, message) => logs.push(`${source}: ${message}`),
  });
  const writePage = (catalog: RuntimeCatalog) =>
    holder.applyPageWrite({
      id: coreRuntimePageSlot.id,
      kind: 'value',
      value: catalog,
    });
  return {
    holder,
    setRuntime,
    pageGone,
    applyKeys,
    logs,
    wiring,
    writePage,
    // Changes what `served()` returns without a store change.
    setServed(next: Keymap) {
      keymap = next;
    },
    serve(next: Keymap) {
      keymap = next;
      for (const run of changed) {
        run();
      }
    },
  };
}

const STARTED = { ...EMPTY_RUNTIME_CATALOG, started: true };

describe('wireRuntime', () => {
  it('pageStartedFalls_CallsPageGoneOnce', () => {
    const { writePage, pageGone } = setup();

    writePage(EMPTY_RUNTIME_CATALOG);
    expect(pageGone).not.toHaveBeenCalled();

    writePage(STARTED);
    writePage(STARTED);
    expect(pageGone).not.toHaveBeenCalled();

    writePage(EMPTY_RUNTIME_CATALOG);
    writePage(EMPTY_RUNTIME_CATALOG);
    expect(pageGone).toHaveBeenCalledOnce();
  });

  it('pageProcessGone_WritesEmptyCatalogAndCallsPageGone', () => {
    const { holder, setRuntime, writePage, wiring, pageGone } = setup();
    const withBind = {
      ...STARTED,
      binds: {
        ...STARTED.binds,
        binds: [{ keys: 'x', scope: 'any', command: 'p.go' }],
      },
    };
    writePage(withBind);

    wiring.pageProcessGone();

    expect(pageGone).toHaveBeenCalledOnce();
    expect(holder.store.read(coreRuntimePageSlot, 'core').get()).toEqual(
      EMPTY_RUNTIME_CATALOG,
    );
    expect(setRuntime).toHaveBeenLastCalledWith({
      main: EMPTY_RUNTIME_CATALOG,
      page: EMPTY_RUNTIME_CATALOG,
    });
  });

  it('slotChange_EitherSlot_CallsSetRuntimeWithBoth', () => {
    const { holder, setRuntime, writePage } = setup();

    writePage(STARTED);
    expect(setRuntime).toHaveBeenLastCalledWith({
      main: EMPTY_RUNTIME_CATALOG,
      page: STARTED,
    });

    holder.store.publish(coreRuntimeMainSlot).set(STARTED);
    expect(setRuntime).toHaveBeenLastCalledWith({
      main: STARTED,
      page: STARTED,
    });
  });

  it('configChange_RuntimeBindWithNoHandler_FilteredBeforeApplyKeys', () => {
    const { serve, applyKeys } = setup();

    serve({
      ...keymapWithApp('p.live'),
      app: [
        { accelerator: 'Control+K', command: 'p.live' },
        { accelerator: 'Control+J', command: 'p.gone' },
      ],
    });
    serve(keymapWithApp('p.gone'));

    expect(applyKeys.mock.calls).toEqual([
      [{ ...keymapWithApp('p.gone'), app: [] }],
    ]);
  });

  it('configChange_SameFilteredKeymap_NoApplyKeys', () => {
    const { serve, applyKeys } = setup();

    serve(keymapWithApp('p.live'));

    expect(applyKeys).not.toHaveBeenCalled();
  });

  it('configChange_ApplyThrows_LogsAndTriesAgainOnTheNextChange', () => {
    const { serve, applyKeys, logs } = setup();
    applyKeys.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const next = { ...keymapWithApp('p.live'), groups: { a: 'A' } };

    serve(next);
    serve(next);

    expect(logs).toEqual(['config: keys not applied: boom']);
    expect(applyKeys).toHaveBeenCalledTimes(2);
  });

  it('servedChanged_NewServedKeymap_AppliesKeysOnce', () => {
    const { wiring, setServed, applyKeys } = setup();
    const next = { ...keymapWithApp('p.live'), groups: { a: 'A' } };

    wiring.servedChanged();
    setServed(next);
    wiring.servedChanged();
    wiring.servedChanged();

    expect(applyKeys.mock.calls).toEqual([[next]]);
  });

  it('handledKeymap_NoHandler_LeavesOutTheBind', () => {
    const { wiring } = setup();

    expect(wiring.handledKeymap(keymapWithApp('p.gone')).app).toEqual([]);
  });
});
