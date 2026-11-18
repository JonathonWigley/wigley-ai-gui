import type { AgentProcessEvents } from './agent';
import type { Disposable } from './disposable';

// The demo harness's id and its one profile.
export const DEMO_HARNESS_ID = 'demo';
export const DEMO_PROFILE = 'demo';

export type DemoSection =
  | 'shell'
  | 'sessions'
  | 'forms'
  | 'workflows'
  | 'modes'
  | 'bars'
  | 'live';

// Panel order and titles.
export const DEMO_SECTIONS: readonly { id: DemoSection; title: string }[] = [
  { id: 'shell', title: 'Shell' },
  { id: 'sessions', title: 'Sessions and chat' },
  { id: 'forms', title: 'Agent forms' },
  { id: 'workflows', title: 'Workflows' },
  { id: 'modes', title: 'Modes' },
  { id: 'bars', title: 'Bars' },
  { id: 'live', title: 'Live' },
];

export interface DemoBeat {
  // Short, shown under the step in the panel.
  name: string;
  // Autoplay dwells max(`demo.autoplaySeconds`, `dwellSeconds`) on the beat.
  dwellSeconds?: number;
  // Sets this beat's whole state, so it may run right after `enter` without the
  // beats before it (previous from beat 0 shows the last beat at once).
  show(): void | Promise<void>;
}

// What a step's page half set up; `beats` holds at least one beat.
export interface DemoStage extends Disposable {
  beats: readonly DemoBeat[];
}

// A step's page half.
export interface DemoStep {
  // `<plugin id>.<name>`; one id per step across both processes.
  id: string;
  section: DemoSection;
  // Within its section, ascending.
  order: number;
  title: string;
  // One high-level line for the whole step.
  caption: string;
  // Repo-relative paths (`src/plugins/…`) the step agent is told about.
  files: readonly string[];
  enter(context: DemoPageContext): Promise<DemoStage>;
}

export interface DemoPageContext {
  scratchDir: string;
  // The main half's sessions by its keys; {} when none.
  sessions: Readonly<Record<string, string>>;
}

// A step's main half (optional), under the same id as its page half.
export interface DemoMainStep {
  id: string;
  enter(context: DemoMainContext): Promise<DemoMainStage>;
}

export interface DemoMainStage extends Disposable {
  // Key → chat session id.
  sessions: Readonly<Record<string, string>>;
}

export interface DemoMainContext {
  scratchDir: string;
  // A demo session: chat.launch on DEMO_PROFILE, ephemeral, in scratchDir;
  // `text` is the first user message (a fake trigger such as `fake: tool`, or
  // plain text). Resolves to the session id.
  launchSession(text: string): Promise<string>;
  // The fake process events of a demo session this run launched; throws for any
  // other id.
  processEvents(sessionId: string): AgentProcessEvents;
}

export interface DemoStepRegistry<S extends { id: string }> {
  // Throws on a duplicate id, or an id not prefixed `<plugin id>.`.
  register(step: S): Disposable;
  // The live steps in registration order.
  list(): readonly S[];
  onChanged(listener: () => void): Disposable;
}
