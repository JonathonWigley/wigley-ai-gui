import { describe, expect, it } from 'vitest';
import { dataUrlBytes, pngDataUrl } from './png-data-url';

describe('pngDataUrl', () => {
  it('pngDataUrl_Bytes_RoundTrips', () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const url = pngDataUrl(bytes);

    expect(url).toBe('data:image/png;base64,iVBORw==');
    expect([...dataUrlBytes(url)]).toEqual([137, 80, 78, 71]);
  });
});
