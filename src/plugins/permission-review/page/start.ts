import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';
import { chatPageKey } from '../../chat/contract';
import { formsConfirmsSlot, formsPageKey } from '../../forms/contract';
import { sessionsPageKey } from '../../sessions/contract';
import { permissionReviewsSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { permissionReviewManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { readPermissionReviewLayout } from './layout/read-permission-review-layout';
import { createVerdictParts } from './verdict-part';

type PermissionReviewApi = PageApi<
  typeof permissionReviewManifest,
  ChannelShape,
  Record<never, never>
>;

// Draws each request's review from `permission-review.reviews` inside chat's
// permission entries and on the question card of each round open in
// `forms.confirms`, through the `permission-review.layout` layout, redrawing
// a card each time its review or its round's confirm changes. Registers the
// verdict demo step.
export const permissionReviewPagePart: PagePart<
  typeof permissionReviewManifest
> = {
  manifest: permissionReviewManifest,
  start(api: PermissionReviewApi) {
    const { services } = api;
    const reviews = api.state.read(permissionReviewsSlot);
    const confirms = api.state.read(formsConfirmsSlot);
    const parts = createVerdictParts({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      review: (key) => reviews.get(key),
      isConfirmRound: (roundId) => confirms.get(roundId) !== undefined,
    });
    api.dependency(chatPageKey).addEntryPart(parts.entryPart);
    api.dependency(formsPageKey).addCardPart(parts.cardPart);
    const sessions = api.dependency(sessionsPageKey);
    registerDemoSteps(services, {
      activate: (sessionId) => sessions.activate(sessionId),
    });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readPermissionReviewLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => parts.setLayouts(shown),
    });

    return {
      commands: {},
      ready() {
        reviews.on((key) => parts.reviewChanged(key));
        confirms.on((roundId) => parts.confirmChanged(roundId));
        callEach([...reviews.all().keys()], (key) => parts.reviewChanged(key));
        callEach([...confirms.all().keys()], (roundId) =>
          parts.confirmChanged(roundId),
        );
      },
    };
  },
};
