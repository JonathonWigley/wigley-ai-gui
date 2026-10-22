import { describe, expect, it } from 'vitest';
import { createPageLog } from './page-log';

function recordingPageLog() {
  const sent: string[] = [];
  const pageLog = createPageLog((source, message) =>
    sent.push(`${source}: ${message}`),
  );
  return { pageLog, sent };
}

describe('createPageLog', () => {
  it('holds lines until the page loads, then sends them in order', () => {
    const { pageLog, sent } = recordingPageLog();
    pageLog.log('main', 'first');
    pageLog.log('config', 'second');

    expect(sent).toEqual([]);

    pageLog.pageLoaded();

    expect(sent).toEqual(['main: first', 'config: second']);
  });

  it('sends a line straight away once the page has loaded', () => {
    const { pageLog, sent } = recordingPageLog();
    pageLog.log('main', 'held');
    pageLog.pageLoaded();

    pageLog.log('main', 'direct');

    expect(sent).toEqual(['main: held', 'main: direct']);
  });

  it('holds lines again while the page reloads', () => {
    const { pageLog, sent } = recordingPageLog();
    pageLog.pageLoaded();
    pageLog.pageLoading();
    pageLog.log('main', 'during reload');

    expect(sent).toEqual([]);

    pageLog.pageLoaded();

    expect(sent).toEqual(['main: during reload']);
  });

  it('keeps lines held across a second load that starts before the first ends', () => {
    const { pageLog, sent } = recordingPageLog();
    pageLog.log('main', 'before');
    pageLog.pageLoading();
    pageLog.log('main', 'after');

    pageLog.pageLoaded();

    expect(sent).toEqual(['main: before', 'main: after']);
  });

  it('sends each held line once', () => {
    const { pageLog, sent } = recordingPageLog();
    pageLog.log('main', 'once');
    pageLog.pageLoaded();
    pageLog.pageLoaded();

    expect(sent).toEqual(['main: once']);
  });
});
