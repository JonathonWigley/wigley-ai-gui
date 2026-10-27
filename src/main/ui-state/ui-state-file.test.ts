import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { loadUiStateFile } from './ui-state-file';

const PATH = '/data/ui-state.json';

let memory: MemoryFiles;
let logged: [string, string][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  memory = createMemoryFiles();
  logged = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function load(files: Files = memory) {
  return loadUiStateFile({
    files,
    path: PATH,
    log: (source, message) => logged.push([source, message]),
  });
}

async function saved(): Promise<unknown> {
  return JSON.parse(await memory.read(PATH));
}

describe('loadUiStateFile', () => {
  it('starts empty with no file', async () => {
    const file = await load();

    expect(file.snapshot()).toEqual({});
    expect(logged).toEqual([]);
  });

  it('reads the saved state', async () => {
    await memory.write(PATH, '{"forms.rail":240}');

    const file = await load();

    expect(file.snapshot()).toEqual({ 'forms.rail': 240 });
  });

  it('starts empty on invalid JSON', async () => {
    await memory.write(PATH, '{oops');

    const file = await load();

    expect(file.snapshot()).toEqual({});
    expect(logged).toHaveLength(1);
    const [source, message] = logged[0];
    expect(source).toBe('ui-state');
    expect(message).toContain('ui-state.json');
  });

  it('starts empty on a JSON array', async () => {
    await memory.write(PATH, '[1]');

    const file = await load();

    expect(file.snapshot()).toEqual({});
    expect(logged).toEqual([
      ['ui-state', 'ui-state.json is not a JSON object, starting empty'],
    ]);
  });

  it('writes once 500 ms after a burst of sets', async () => {
    const write = vi.spyOn(memory, 'write');
    const file = await load();

    file.set('forms.rail', 240);
    await vi.advanceTimersByTimeAsync(100);
    file.set('chat.rail', 300);
    await vi.advanceTimersByTimeAsync(399);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await saved()).toEqual({ 'forms.rail': 240, 'chat.rail': 300 });
  });

  it('deletes a key set to undefined', async () => {
    await memory.write(PATH, '{"forms.rail":240,"chat.rail":300}');
    const file = await load();

    file.set('forms.rail', undefined);
    await vi.advanceTimersByTimeAsync(500);

    expect(await saved()).toEqual({ 'chat.rail': 300 });
  });

  it('flush writes a pending change now', async () => {
    const file = await load();

    file.set('forms.rail', 240);
    await file.flush();

    expect(await saved()).toEqual({ 'forms.rail': 240 });
  });

  it('close writes a pending change and refuses later sets', async () => {
    const write = vi.spyOn(memory, 'write');
    const file = await load();

    file.set('forms.rail', 240);
    await file.close();
    file.set('chat.rail', 300);
    await vi.advanceTimersByTimeAsync(500);
    await file.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(await saved()).toEqual({ 'forms.rail': 240 });
    expect(file.snapshot()).toEqual({ 'forms.rail': 240 });
  });

  it('logs a failed write and retries on the next set', async () => {
    let hasFailed = false;
    const failingOnce: Files = {
      ...memory,
      write: async (path, text) => {
        if (!hasFailed) {
          hasFailed = true;
          throw new Error('disk full');
        }
        await memory.write(path, text);
      },
    };
    const file = await load(failingOnce);

    file.set('forms.rail', 240);
    await vi.advanceTimersByTimeAsync(500);
    expect(logged).toEqual([
      ['ui-state', 'could not write ui-state.json: disk full'],
    ]);
    file.set('chat.rail', 300);
    await vi.advanceTimersByTimeAsync(500);

    expect(await saved()).toEqual({ 'forms.rail': 240, 'chat.rail': 300 });
  });
});
