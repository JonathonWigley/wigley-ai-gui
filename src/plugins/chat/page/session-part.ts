import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { CHAT_HARNESS_ID, type ChatSidePart } from '../contract';
import type {
  ComposerInput,
  PartView,
  SessionFactInput,
  SessionFactsInput,
} from '../layouts/layout';
import {
  type ChatLayouts,
  chatPartDraws,
  surfaceBaseKit,
  type SurfaceKitDeps,
} from './chat-layouts';
import type { ChatTabs } from './chat-view';
import { modelEffortText } from './composer-input';
import { displayPath } from './start-prompt-items';

interface DrawnFacts {
  element: HTMLElement;
  view: PartView<SessionFactsInput>;
}

// The Session section's rows, from chat's own state: the repo, the branch when
// there is one, the folder with the home folder as `~`, the harness, and the model
// and effort when the session declares a model control.
export function sessionFactsOf(
  input: ComposerInput,
  projectDir: string,
  deps: { homeDir: string; paths: Paths },
): SessionFactsInput {
  const branch: SessionFactInput[] =
    input.branch === null ? [] : [{ label: 'Branch', value: input.branch }];
  const model: SessionFactInput[] =
    input.modelEffort === null
      ? []
      : [{ label: 'Model', value: modelEffortText(input.modelEffort) }];
  return {
    facts: [
      { label: 'Project', value: input.repo },
      ...branch,
      {
        label: 'Folder',
        value: displayPath(projectDir, deps.homeDir, deps.paths),
      },
      { label: 'Harness', value: CHAT_HARNESS_ID },
      ...model,
    ],
  };
}

// The session hub's Session section: the `sessionFacts` layout part, updated in
// place on each change of its source, else drawn again; once an `update` throws,
// the part draws with `default` until the layouts change. A session with no
// source draws nothing.
export function createSessionPart(
  deps: SurfaceKitDeps & {
    layouts: ChatLayouts;
    log: Log;
    sourceOf(sessionId: string): ReturnType<ChatTabs['sessionFactsSource']>;
  },
): ChatSidePart {
  const draws = chatPartDraws(deps.layouts, 'sessionFacts', deps.log);
  return {
    id: 'chat.session',
    title: 'Session',
    order: 40,
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
          subscription.dispose();
          clear(drawn);
        },
      };
    },
  };
}
