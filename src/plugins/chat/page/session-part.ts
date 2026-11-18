import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { harnessLabel } from '../../../shared/agent-harness-label';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import type { ChatSidePart } from '../contract';
import type {
  ComposerInput,
  PartView,
  SessionFactsInput,
} from '../layouts/layout';
import {
  type ChatLayouts,
  chatPartDraws,
  surfaceBaseKit,
  type SurfaceKitDeps,
} from './chat-layouts';
import { modelEffortText } from './composer-input';
import { displayPath } from './start-prompt-items';
import { callEach } from '../../../shared/call-each';

// A session's facts for the Session section, read live.
export interface SessionFactsSource {
  input(): SessionFactsInput;
  onChanged(listener: () => void): Disposable;
}

interface DrawnFacts {
  element: HTMLElement;
  view: PartView<SessionFactsInput>;
}

// The Session facts, from chat's own state: the repo, the branch when there is
// one, the folder with the home folder as `~`, the worktrees the agents wrote
// in, the harness's id and its label in `harnesses` (when it is not
// registered, `harnessLabel`'s stand-in label, else the id), and the model and effort when the session declares a model
// control.
export function sessionFactsOf(
  input: ComposerInput,
  place: { projectDir: string; worktrees: readonly string[]; harness: string },
  deps: {
    homeDir: string;
    paths: Paths;
    harnesses: ReadonlyMap<string, AgentHarnessInfo>;
  },
): SessionFactsInput {
  return {
    repo: input.repo,
    branch: input.branch,
    folder: displayPath(place.projectDir, deps.homeDir, deps.paths),
    worktrees: place.worktrees,
    harness: place.harness,
    harnessLabel: harnessLabel(deps.harnesses, place.harness),
    modelEffort:
      input.modelEffort === null ? null : modelEffortText(input.modelEffort),
  };
}

// The session hub's Session part, first in the hub: the `sessionFacts` layout
// part, updated in place on each change of its source, else drawn again; once an
// `update` throws, the part draws with `default` until the layouts change. A
// session with no source draws nothing.
export function createSessionPart(
  deps: SurfaceKitDeps & {
    layouts: ChatLayouts;
    log: PluginLog;
    sourceOf(sessionId: string): SessionFactsSource | null;
  },
): ChatSidePart {
  const draws = chatPartDraws(deps.layouts, 'sessionFacts', deps.log);
  return {
    id: 'chat.session',
    title: 'Session',
    order: 0,
    build(parent, sessionId) {
      const source = deps.sourceOf(sessionId);
      if (source === null) {
        return {};
      }
      const draw = (input: SessionFactsInput): DrawnPart<DrawnFacts> =>
        draws.draw(parent, (builder, at, rollback) => {
          const view = builder(
            at,
            input,
            surfaceBaseKit(deps, 'chat', rollback),
          );
          return { element: view.element, view };
        });
      const clear = (shown: DrawnPart<DrawnFacts>) => {
        shown.built.element.remove();
        shown.dispose();
      };
      let drawn = draw(source.input());
      const subscription = source.onChanged(() => {
        const input = source.input();
        if (draws.update(drawn, input) !== 'ran') {
          const next = draw(input);
          clear(drawn);
          drawn = next;
        }
      });
      return {
        dispose() {
          callEach<() => void>(
            [() => subscription.dispose(), () => clear(drawn)],
            (step) => step(),
          );
        },
      };
    },
  };
}
