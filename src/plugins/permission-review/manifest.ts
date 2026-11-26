import { definePlugin } from '../../shared/define-plugin';

// A second opinion on every approval: main reviews each unanswered permission
// entry in `chat.entries` and each confirm round in `forms.confirms` through
// the session harness's one-shot `ask`, into the `permission-review.reviews`
// slot, and the page draws the verdict inside chat's permission entry and on
// forms' confirm card through the `layout` setting's permission-review layout.
// It names `sessions` for the session it forgets on `sessions.ended`, the names
// in its log lines, its self-test's activation and its demo step's.
export const permissionReviewManifest = definePlugin({
  id: 'permission-review',
  label: 'Permission review',
  description:
    'Reviews each approval with a separate model: a one-line summary and an approve-or-deny verdict on the card.',
  dependsOn: {
    main: ['chat', 'forms', 'sessions'],
    page: ['chat', 'forms', 'sessions'],
  },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The permission-review layout the verdict on a permission card and a confirm form draws in: a folder name in permission-review's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
