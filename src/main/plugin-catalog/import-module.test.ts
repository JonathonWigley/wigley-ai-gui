import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importModuleFrom } from './import-module';

describe('importModuleFrom', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'import-module-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  async function writeRevision(name: string, word: string): Promise<string> {
    const revision = path.join(folder, name);
    await mkdir(revision);
    await writeFile(path.join(revision, 'package.json'), '{"type":"module"}');
    await writeFile(
      path.join(revision, 'helper.js'),
      `export const word = '${word}';`,
    );
    await writeFile(
      path.join(revision, 'main.js'),
      "import { word } from './helper.js'; export function start() { return word; }",
    );
    return path.join(revision, 'main.js');
  }

  it('imports the ES module at a path, with its relative imports, one module per path', async () => {
    const first = await writeRevision('1', 'first');
    const second = await writeRevision('2', 'second');

    const firstModule = (await importModuleFrom(first)) as {
      start(): string;
    };
    const secondModule = (await importModuleFrom(second)) as {
      start(): string;
    };

    expect(firstModule.start()).toBe('first');
    expect(secondModule.start()).toBe('second');
  });

  it.each([
    { name: 'missing file', file: 'none.js', text: null },
    { name: 'syntax error', file: 'bad.js', text: 'export default {' },
  ])('rejects for a file it cannot import: $name', async ({ file, text }) => {
    const filePath = path.join(folder, file);
    if (text !== null) await writeFile(filePath, text);

    await expect(importModuleFrom(filePath)).rejects.toThrow();
  });
});
