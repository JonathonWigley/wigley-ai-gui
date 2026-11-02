import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageAgentEvent } from '../../../contracts/agent';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { UsageSnapshot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import { createUsageParts } from './layout/usage-parts';
import { createSessionLines } from './session-lines';

const NOW = 50_000_000;
const MINUTE = 60_000;
const SESSION = 's1';
const LINE = 'usage-session-line';

function usageEvent(overrides: Partial<UsageAgentEvent> = {}): UsageAgentEvent {
  return {
    type: 'usage',
    agentId: 'main',
    at: NOW,
    contextTokens: 180_000,
    contextWindow: 1_000_000,
    autocompact: { configured: 300_000, reported: null },
    cacheExpiresAt: NOW + 42 * MINUTE,
    spendUsd: 1.234,
    ...overrides,
  };
}

// A snapshot holding `s1` with `usage`, or no session while `usage` is
// undefined.
function snapshotWith(usage?: UsageAgentEvent | null): UsageSnapshot {
  return {
    plans: [],
    sessions:
      usage === undefined
        ? []
        : [{ sessionId: SESSION, profileDir: null, usage }],
  };
}

// Lines over the default layout whose `latest` is `shown` at NOW.
function setUp(shown: UsageSnapshot | null) {
  const logged: string[] = [];
  const parts = createUsageParts({
    defaultLayout,
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
      },
      keys: recordingAnchors().keys,
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: () => undefined,
  });
  const lines = createSessionLines({
    parts,
    log: (line) => logged.push(line),
    latest: () => (shown === null ? null : { snapshot: shown, now: NOW }),
  });
  return { lines, logged };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session lines', () => {
  it('build_SessionWithUsage_DrawsLineAndLogs', () => {
    const { lines, logged } = setUp(snapshotWith(usageEvent()));
    const wrapper = new FakeElement('div');

    lines.part.build(asHtml(wrapper), SESSION);

    expect(findAll(wrapper, LINE)).toHaveLength(1);
    expect(logged).toEqual([
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
    ]);
  });

  it.each([
    { case: 'AbsentSession', snapshot: snapshotWith() },
    { case: 'NullUsage', snapshot: snapshotWith(null) },
    { case: 'NoSnapshotYet', snapshot: null },
  ])('build_SessionWithoutUsage_DrawsNothing_$case', ({ snapshot }) => {
    const { lines, logged } = setUp(snapshot);
    const wrapper = new FakeElement('div');

    lines.part.build(asHtml(wrapper), SESSION);

    expect(wrapper.children).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('redraw_TextChanges_RedrawsAndLogsOnce', () => {
    const { lines, logged } = setUp(snapshotWith(usageEvent()));
    const wrapper = new FakeElement('div');
    lines.part.build(asHtml(wrapper), SESSION);
    const later = snapshotWith(usageEvent({ contextTokens: 210_000 }));

    lines.redraw(later, NOW);
    lines.redraw(later, NOW);

    const drawn = findAll(wrapper, LINE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].textContent).toContain('210k/300k');
    expect(logged).toEqual([
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
      'session line s1: context 210k/300k, cache 42m, spend $1.23',
    ]);
  });

  it.each([
    { case: 'AbsentSession', snapshot: snapshotWith() },
    { case: 'NullUsage', snapshot: snapshotWith(null) },
  ])('redraw_UsageGone_RemovesLineAndLogsNoneOnce_$case', ({ snapshot }) => {
    const { lines, logged } = setUp(snapshotWith(usageEvent()));
    const wrapper = new FakeElement('div');
    lines.part.build(asHtml(wrapper), SESSION);

    lines.redraw(snapshot, NOW);
    lines.redraw(snapshot, NOW);

    expect(wrapper.children).toEqual([]);
    expect(logged).toEqual([
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
      'session line s1: none',
    ]);
  });

  it('rebuild_BuildThenStaleDispose_KeepsDrawingInNewWrapper', () => {
    const { lines } = setUp(snapshotWith(usageEvent()));
    const oldWrapper = new FakeElement('div');
    const newWrapper = new FakeElement('div');
    const oldBuilt = lines.part.build(asHtml(oldWrapper), SESSION);

    lines.part.build(asHtml(newWrapper), SESSION);
    oldBuilt.dispose?.();
    lines.redraw(snapshotWith(usageEvent({ contextTokens: 210_000 })), NOW);

    expect(findAll(oldWrapper, LINE)).toEqual([]);
    const drawn = findAll(newWrapper, LINE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].textContent).toContain('210k/300k');
  });

  it('rebuild_DisposeThenBuild_DrawsInNewWrapperAndLogsNothing', () => {
    const { lines, logged } = setUp(snapshotWith(usageEvent()));
    const oldWrapper = new FakeElement('div');
    const newWrapper = new FakeElement('div');
    const built = lines.part.build(asHtml(oldWrapper), SESSION);

    built.dispose?.();
    lines.part.build(asHtml(newWrapper), SESSION);
    const loggedByRebuild = [...logged];
    lines.redraw(snapshotWith(usageEvent({ contextTokens: 210_000 })), NOW);

    expect(loggedByRebuild).toEqual([
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
    ]);
    expect(findAll(oldWrapper, LINE)).toEqual([]);
    const drawn = findAll(newWrapper, LINE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].textContent).toContain('210k/300k');
  });

  it('forget_ThenUsageAgain_LogsTheLineAgain', () => {
    const { lines, logged } = setUp(snapshotWith(usageEvent()));
    const wrapper = new FakeElement('div');
    const built = lines.part.build(asHtml(wrapper), SESSION);

    built.dispose?.();
    lines.forget(SESSION);
    lines.part.build(asHtml(new FakeElement('div')), SESSION);

    expect(logged).toEqual([
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
      'session line s1: context 180k/300k, cache 42m, spend $1.23',
    ]);
  });
});
