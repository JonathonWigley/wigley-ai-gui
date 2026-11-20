import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveLocalMedia } from './local-media';

describe('serveLocalMedia', () => {
  let folder = '';
  let clip = '';

  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'local-media-'));
    clip = path.join(folder, 'clip.MP4');
    await writeFile(clip, '0123456789');
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('answers the whole file with its type and length when no range is asked', async () => {
    const response = await serveLocalMedia(clip, null);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await response.text()).toBe('0123456789');
  });

  it('answers 206 with only the asked bytes', async () => {
    const response = await serveLocalMedia(clip, 'bytes=2-5');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await response.text()).toBe('2345');
  });

  it('answers 416 with the size for a range past the end', async () => {
    const response = await serveLocalMedia(clip, 'bytes=10-');
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */10');
  });

  it.each([
    ['a missing file', () => path.join(folder, 'gone.mp4')],
    ['a folder', () => folder],
  ])('answers 404 for %s', async (_case, fileOf) => {
    expect((await serveLocalMedia(fileOf(), 'bytes=0-')).status).toBe(404);
  });
});
