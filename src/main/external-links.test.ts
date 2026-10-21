import { describe, expect, it } from 'vitest';
import { gateExternalLinks } from './external-links';

function recordingOpen() {
  const opened: string[] = [];
  const open = gateExternalLinks(async (url) => {
    opened.push(url);
  });
  return { open, opened };
}

describe('gateExternalLinks', () => {
  it.each([
    'https://example.com/a?b=c',
    'http://example.com',
    'mailto:someone@example.com',
    'HTTPS://example.com',
  ])('opens %s', async (url) => {
    const { open, opened } = recordingOpen();

    await open(url);

    expect(opened).toEqual([url]);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'vscode://file/x',
    'ftp://example.com',
    'not a url',
    '',
  ])('refuses %s without opening it', async (url) => {
    const { open, opened } = recordingOpen();

    await expect(open(url)).rejects.toThrow(`Refused to open ${url}`);
    expect(opened).toEqual([]);
  });
});
