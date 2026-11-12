import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The contract of a scoped-agents layout: the ask box an agent pane shows while its open scope has no session, for
// Practice's interviewer and Backlog's assistant alike. The part appends its root element to `parent` and returns it;
// the app sets `data-layout="<name>"` and `data-layout-owner="scoped-agents"` on that root. A layout's `layout.css`
// restyles under `[data-layout-owner="scoped-agents"][data-layout="<name>"]`.
//
// Slots. `askBox`'s `textBox` places the app's ask frame (`ui-input scoped-agents-ask-box`, holding the vim box and the
// send hint) and returns it; left out, the frame is appended at the end of the part's root. A second call throws
// `textBox placed twice`, which fails the part, so it draws with `default`.

// A part's root, appended to `parent`.
export interface ScopedAgentsPane {
  element: HTMLElement;
}

// The agent pane's ask box. `heading` is the host's heading (Practice: the open problem's title); `hint` says what the
// agent does.
export interface AskBoxInput {
  heading: string;
  hint: string;
}

// The kit every scoped-agents part draws with: the base kit, its keys in `scoped-agents.ask`.
export interface ScopedAgentsKit extends BaseKit {}
export interface AskBoxKit extends ScopedAgentsKit {
  // A second call throws `textBox placed twice`, so the part draws with `default`.
  textBox(parent: HTMLElement): HTMLElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. `askBox` draws into a pane each time its
// open scope shows with no session, and again on each layout set. Kit scope: `askBox` `scoped-agents.ask`.
export interface ScopedAgentsLayout {
  askBox?(
    parent: HTMLElement,
    input: AskBoxInput,
    kit: AskBoxKit,
  ): ScopedAgentsPane;
}

// A layout with every part defined, as `default` is.
export interface CompleteScopedAgentsLayout extends Required<ScopedAgentsLayout> {}
