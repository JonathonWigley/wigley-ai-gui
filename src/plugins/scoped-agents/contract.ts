// The scoped-agents plugin's shared names: the owned chat session a plugin
// registers per (owner, agent id, scope), the store each registration keeps
// its records in, the pane its page shows the session in, and the channel
// between the plugin's main and page parts.

import type { Disposable } from '../../contracts/disposable';
import type { OuterPanes, ResizeTarget } from '../../contracts/panes';
import type { ChannelShape, DependencyKey } from '../../contracts/plugin';
import type { AgentSession } from '../sessions/contract';

export interface ScopedAgentRecord {
  sessionId: string;
  hostSessionId: string;
}

// Where a registration keeps each scope's record. Practice: the current
// attempt's interviewer in progress.json; backlog: one JSON file in its plugin
// data.
export interface ScopedAgentStore {
  read(scope: string): Promise<ScopedAgentRecord | null>;
  // Writes to the scope's state as it is when the write runs.
  write(scope: string, record: ScopedAgentRecord | null): Promise<void>;
  // Every scope's record, for scopeOf and following /clear's new host id.
  // Never rejects for one scope's failure: it leaves that scope out.
  entries(): Promise<{ scope: string; record: ScopedAgentRecord }[]>;
  // The record a fresh launch for `scope` replaces, closed after the launch;
  // null for none.
  superseded(scope: string): Promise<ScopedAgentRecord | null>;
  // Throws the reason an ask for `scope` may not launch now (Practice: no
  // attempt); resolves otherwise.
  checkAsk(scope: string): Promise<void>;
}

export interface ScopedAgentSpec {
  // The host's manifest id: 'practice', 'backlog'.
  owner: string;
  // Unique within its owner: 'interviewer', 'assistant'.
  agentId: string;
  // Chat gets it as `projectDir`, so its `sessionOpened` names this folder.
  folder(scope: string): string;
  instructions(scope: string): Promise<string>;
  // The resumed row's title.
  title(scope: string): Promise<string>;
  store: ScopedAgentStore;
}

export interface ScopedAgent extends Disposable {
  // The sessionId; launches, or sends to the brought-back one.
  ask(scope: string, text: string): Promise<string>;
  // Resumes a row chat no longer holds.
  sessionOf(scope: string): Promise<string | null>;
  scopeOf(session: AgentSession): Promise<string | null>;
}

// `spec.owner` names the registering plugin; the registration is filed with
// the consumer's registrations, so it ends when the consumer stops.
export interface ScopedAgentsMainExports {
  addScopedAgent(spec: ScopedAgentSpec): ScopedAgent;
}

export const scopedAgentsMainKey: DependencyKey<
  ScopedAgentsMainExports,
  'main',
  'scoped-agents'
> = { id: 'scoped-agents', process: 'main' };

export interface AgentPaneSpec {
  owner: string;
  agentId: string;
  // The ask box's heading.
  heading(): string;
  // The ask box's hint line.
  hint: string;
  // The host shows or hides the slot holding `element`.
  setShown(shown: boolean): void;
  // The slot's divider.
  resizeTarget: ResizeTarget;
  // The pane took the keys: the host's focus is the pane.
  tookKeys(): void;
  // Esc in the ask box / Alt+h: the host takes the keys back.
  leave(): void;
}

export interface AgentPane extends Disposable {
  element: HTMLElement;
  isShown(): boolean;
  toggle(): void;
  // Practice: `<slug>` (null then the slug on a new attempt); backlog:
  // 'global' once.
  scopeOpened(scope: string | null): void;
  // Re-reads sessionOf after a host-made ask (backlog's sweep).
  refresh(): void;
  hostTookKeys(): void;
  modeHidden(): void;
  outerPanes: OuterPanes;
  redraw(): void;
}

export interface ScopedAgentsPageExports {
  addAgentPane(spec: AgentPaneSpec): AgentPane;
}

export const scopedAgentsPageKey: DependencyKey<
  ScopedAgentsPageExports,
  'page',
  'scoped-agents'
> = { id: 'scoped-agents', process: 'page' };

// The page's pane reaches a registration's `ask` and `sessionOf` by its owner
// and agent id; each rejects `No scoped agent <owner>/<agentId>.` for a pair
// with no live registration.
export interface ScopedAgentsChannel extends ChannelShape {
  invoke: {
    ask(
      owner: string,
      agentId: string,
      scope: string,
      text: string,
    ): Promise<string>;
    sessionOf(
      owner: string,
      agentId: string,
      scope: string,
    ): Promise<string | null>;
  };
  messages: Record<never, never>;
}
