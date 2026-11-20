import { describe, expect, it } from 'vitest';
import { createVisualDocuments } from './visual-documents';

describe('createVisualDocuments', () => {
  it('serves a source at the URL of its SHA-256 hash', () => {
    const documents = createVisualDocuments();
    const url = documents.serve('a');
    expect(url).toBe(
      'wigley-visual://visual/ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
    expect(documents.serve('a')).toBe(url);
    expect(documents.serve('b')).not.toBe(url);
  });

  it('answers a served URL with the document under its CSP', async () => {
    const documents = createVisualDocuments();
    const url = documents.serve('<p>hi</p>');
    const answer = documents.response(url);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(answer.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: wigley-visual:; media-src wigley-visual:; font-src data:; form-action 'none'; base-uri 'none'",
    );
    expect(answer.headers.get('Access-Control-Allow-Origin')).toBe(null);
    const body = await answer.text();
    expect(body.startsWith('<!doctype html>\n<script>')).toBe(true);
    expect(body.endsWith('</script>\n<p>hi</p>')).toBe(true);
    expect(body).toContain('wigley-visual:theme');
    expect(body).toContain('wigley-visual:height');
    expect(body).toContain('wigley-visual:escape');
  });

  it.each([
    ['unknown hash', 'wigley-visual://visual/' + 'cd'.repeat(32)],
    ['not a visual URL', 'wigley-layout://forms/x/~1/layout.js'],
  ])('answers 404 for a URL it did not serve: %s', (_case, url) => {
    const documents = createVisualDocuments();
    documents.serve('<p>hi</p>');
    expect(documents.response(url).status).toBe(404);
  });
});
