import { element } from '../../../shared/page/dom';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { statusDot } from '../../../shared/page/ui/status-dot';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionRow, SessionsState } from '../contract';
import { sessionsManifest } from '../manifest';
import { harnessText, hasOtherSession } from './tabs';

export interface SidebarView {
  element: HTMLElement;
  // `statusOf` reads a session's second line, null for none.
  render(
    state: SessionsState | null,
    statusOf: (sessionId: string) => string | null,
  ): void;
}

// Sessions mode's side bar: a "Sessions" header holding the previous and
// next session edge prompts, hidden while no other session is there to move
// to, over one row per session in main's order, each reading its label, its
// harness dimmed, an attention dot while a round waits unopened, all on a
// first line that never wraps, and its status on a second line; the selected
// row is marked, and clicking a row activates its session.
export function mountSidebarView(
  activate: (sessionId: string) => void,
  keys: Pick<KeysPageExports, 'anchor'>,
): SidebarView {
  const side = element('div', 'session-side');
  const pair = buildSessionPair(keys);
  const sidebar = element('nav', 'session-sidebar');
  sidebar.setAttribute('aria-label', 'Sessions');
  side.append(sectionHeader('Sessions', pair), sidebar);
  return {
    element: side,
    render(state, statusOf) {
      const selectedSessionId = state?.selectedSessionId ?? null;
      pair.classList.toggle(
        'is-no-target',
        state === null || !hasOtherSession(state),
      );
      sidebar.replaceChildren(
        ...(state?.rows ?? []).map((session) =>
          buildRow(
            session,
            session.sessionId === selectedSessionId,
            statusOf(session.sessionId),
            activate,
          ),
        ),
      );
    },
  };
}

// `⌥⇧I ▲ ▼ ⌥⇧O`: the previous and next session anchors, each chevron on
// its inner side, hidden until `render` hands it main's first state.
function buildSessionPair(keys: Pick<KeysPageExports, 'anchor'>): HTMLElement {
  const previous = element('span');
  const next = element('span');
  keys.anchor(previous, qualify(sessionsManifest.id, 'prevSession'));
  keys.anchor(next, qualify(sessionsManifest.id, 'nextSession'));
  const pair = element('span', 'session-edge is-no-target');
  pair.append(
    previous,
    element('span', 'ui-key-chevron', '▲'),
    element('span', 'ui-key-chevron', '▼'),
    next,
  );
  return pair;
}

function buildRow(
  session: SessionRow,
  isSelected: boolean,
  status: string | null,
  activate: (sessionId: string) => void,
): HTMLElement {
  const entry = row({
    density: 'list',
    label: session.label,
    detail: harnessText(session.harness) || null,
    trailing: session.marked ? statusDot('attention') : null,
    onClick: () => activate(session.sessionId),
  });
  entry.classList.add('session-row');
  entry.title =
    status === null ? session.label : `${session.label} · ${status}`;
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  if (status !== null) {
    entry.append(element('span', 'session-row-status', status));
  }
  return entry;
}
