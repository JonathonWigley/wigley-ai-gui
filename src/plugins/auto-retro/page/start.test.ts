import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type SessionRow,
  type SessionsPageExports,
  type SidebarSection,
  sessionsPageKey,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { autoRetroStateSlot } from '../contract';
import { autoRetroPagePart } from './start';

function rowOf(sessionId: string): SessionRow {
  return sessionRow(sessionId, {
    label: sessionId,
    project: 'wigley-agents',
    projectDir: '/home/me/wigley-agents',
    hostSessionId: `host-${sessionId}`,
  });
}

// The part on the harness, over a sessions that records each section added
// with whether its handle is still live, filing the handle with
// `consumer.track` as the real view does.
function startPart() {
  const sections: { section: SidebarSection; live: boolean }[] = [];
  const harness = startPagePart(autoRetroPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addSection(section: SidebarSection) {
              const added = { section, live: true };
              sections.push(added);
              return consumer.track({
                dispose() {
                  added.live = false;
                },
              });
            },
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
  const state = harness.state.publish(autoRetroStateSlot);
  const liveSections = () =>
    sections.filter(({ live }) => live).map(({ section }) => section);
  return { harness, sections, state, liveSections };
}

describe('autoRetroPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retroSection_SlotRows_ClaimsThoseRows', () => {
    const part = startPart();

    part.state.set({ rows: ['r1'], queued: 0 });

    const [first] = part.liveSections();
    expect(part.liveSections()).toHaveLength(1);
    expect(first).toMatchObject({ id: 'auto-retro', label: 'Retro' });
    expect(first.claims(rowOf('r1'))).toBe(true);
    expect(first.claims(rowOf('r2'))).toBe(false);

    part.state.set({ rows: ['r1', 'r2'], queued: 0 });

    const [second] = part.liveSections();
    expect(part.liveSections()).toHaveLength(1);
    expect(second).not.toBe(first);
    expect(second.claims(rowOf('r2'))).toBe(true);
  });

  it('retroHeader_Queued_DrawsTheCountOnlyWhileAboveZero', () => {
    const part = startPart();
    part.state.set({ rows: ['r1'], queued: 2 });
    const [section] = part.liveSections();
    const parent = document.createElement('div');
    const added = part.sections.length;

    section.header?.build(parent);

    expect(parent.textContent).toBe('2 queued');

    part.state.set({ rows: ['r1'], queued: 0 });

    expect(parent.children).toHaveLength(0);

    part.state.set({ rows: ['r1'], queued: 3 });

    expect(parent.textContent).toBe('3 queued');
    expect(part.sections).toHaveLength(added);
  });
});
