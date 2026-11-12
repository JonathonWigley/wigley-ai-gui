import './agent-pane.css';
import type { Registrations } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  kitCommandsOf,
  type OwnerKitServices,
} from '../../../shared/page/layout-host/base-kit';
import { requireElementIn } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { chatPageKey } from '../../chat/contract';
import type {
  AgentPane,
  AgentPaneSpec,
  ScopedAgentsChannel,
  ScopedAgentsPageExports,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type {
  AskBoxInput,
  CompleteScopedAgentsLayout,
  ScopedAgentsLayout,
} from '../layouts/layout';
import { scopedAgentsManifest } from '../manifest';
import { type AgentPaneView, createAgentPane } from './agent-pane';
import { readScopedAgentsLayout } from './layout/read-layout';
import { createScopedAgentsKit } from './layout/scoped-agents-kit';

type ScopedAgentsApi = PageApi<
  typeof scopedAgentsManifest,
  ScopedAgentsChannel
>;

// Hands each dependent agent panes (`addAgentPane`), each asking main for its
// spec's owner and agent id over the channel and drawing the session's chat
// view through chat's `mountChat`. Each pane is filed with the dependent's
// registrations, so it ends when the dependent stops. The ask boxes draw with
// the layout the `layout` setting names, every live pane redrawn on each
// layout set. `askSend` and `leaveBox` act on the pane that holds the keys,
// and do nothing while none does.
export const scopedAgentsPagePart: PagePart<typeof scopedAgentsManifest> = {
  manifest: scopedAgentsManifest,
  start(api: ScopedAgentsApi) {
    const { services } = api;
    const chat = api.dependency(chatPageKey);
    const parts = createLayoutParts<
      ScopedAgentsLayout,
      CompleteScopedAgentsLayout
    >({
      owner: scopedAgentsManifest.id,
      defaultLayout,
      log: services.log,
    });
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    const panes = new Set<AgentPaneView>();
    let heldPane: AgentPaneView | null = null;

    const drawAskBox = (
      parent: HTMLElement,
      input: AskBoxInput,
      frame: HTMLElement,
    ) =>
      parts.draw('askBox', parent, (askBox, into, rollback) => {
        const slot = appSlot(frame, 'textBox', rollback);
        const box = askBox(into, input, {
          ...createScopedAgentsKit(kitServices, rollback),
          textBox: slot.place,
        });
        slot.placeIfLeftOut(requireElementIn(into, box.element, 'askBox'));
        return box;
      });

    api.layouts.show<ScopedAgentsLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readScopedAgentsLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        for (const pane of panes) {
          pane.redraw();
        }
      },
    });

    const addAgentPane = (spec: AgentPaneSpec): AgentPane => {
      const pane = createAgentPane(
        {
          ask: (scope, text) =>
            api.channel.invoke('ask', spec.owner, spec.agentId, scope, text),
          sessionOf: (scope) =>
            api.channel.invoke('sessionOf', spec.owner, spec.agentId, scope),
          editor: services.editor,
          keys: api.keys,
          log: services.log,
          toast: services.toast,
          setScope: (scope) => api.keys.setScope(scope),
          setResizeTarget: (target) => api.panes.setResizeTarget(target),
          setFocusTarget: (target) => api.panes.setFocusTarget(target),
          mountChat: (element, sessionId) => chat.mountChat(element, sessionId),
          drawAskBox,
          // A pane giving up the keys clears the record only while it is the
          // one recorded.
          heldKeys(next) {
            if (next !== null || heldPane === pane) {
              heldPane = next;
            }
          },
        },
        spec,
      );
      panes.add(pane);
      return {
        ...pane,
        dispose() {
          panes.delete(pane);
          pane.dispose();
        },
      };
    };

    const exports = (consumer: Registrations): ScopedAgentsPageExports => ({
      addAgentPane: (spec) => consumer.track(addAgentPane(spec)),
    });

    return {
      commands: {
        askSend: () => heldPane?.send(),
        leaveBox: () => heldPane?.leaveBox(),
      },
      exports,
      dispose() {
        const live = [...panes];
        panes.clear();
        callEach(live, (pane) => pane.dispose());
      },
    };
  },
};
