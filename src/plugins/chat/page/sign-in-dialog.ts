import type { EditorHost } from '../../../contracts/editor';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ChatChannel } from '../contract';
import { chatCommand } from '../ids';
import {
  type DialogAction,
  type DialogDeps,
  followKeymap,
} from './chat-dialogs';
import { keyHint } from './key-hint';
import { createSignInFlow } from './sign-in-flow';

export interface SignInDialogDeps extends DialogDeps {
  editor: EditorHost;
  channel: Pick<PageChannel<ChatChannel>, 'invoke' | 'on'>;
  toast(text: string, tone: ToastTone): void;
}

// The sign-in dialog, one at a time, belonging to a profile rather than a
// session. `open` starts a sign-in of the profile and shows the dialog: the
// link main reports with a Copy button, and a box for a code the sign-in page
// shows; while the dialog is open, `open` cancels its sign-in first.
// `submitCode` sends the box's trimmed text when not empty. `copyLink` copies
// the link once main reported one. `cancel` cancels the sign-in and closes the
// dialog. The sign-in's end closes the dialog and toasts the outcome: signed in
// only when it finished with no error and the profile reads signed in. A
// `logIn` that rejects closes it too. Each does nothing while the dialog is
// closed. `finished` is called exactly once per open: with whether the profile
// is now signed in at the sign-in's end, and false on a cancel, a replacing
// `open` or a rejected `logIn`.
export interface SignInDialog {
  open(profile: string, finished?: (signedIn: boolean) => void): void;
  submitCode(): void;
  copyLink(): void;
  cancel(): void;
}

const SIGN_IN_ACTIONS: readonly DialogAction[] = [
  {
    label: 'Cancel',
    variant: 'secondary',
    command: 'cancelSignIn',
    scope: 'signIn',
  },
  {
    label: 'Send code',
    variant: 'primary',
    command: 'submitCode',
    scope: 'signIn',
  },
];

const WAITING_TEXT = 'Waiting for the sign-in link…';

export function createSignInDialog(deps: SignInDialogDeps): SignInDialog {
  const dialog = createDialog('Sign in');
  const link = element('span', 'chat-sign-in-link', WAITING_TEXT);
  const linkRow = element('div', 'chat-sign-in-link-row');
  const box = inputFrame();
  box.classList.add('chat-sign-in-box');
  dialog.body.append(
    element('p', 'chat-dialog-text', 'Finish sign-in in your browser.'),
    linkRow,
    element(
      'p',
      'chat-dialog-text',
      'If the page shows a code, paste it here.',
    ),
    box,
  );
  deps.overlay.contribute(dialog.element);
  followKeymap(dialog, SIGN_IN_ACTIONS, deps);
  const editor = deps.editor.create(box, '', {
    changed: () => undefined,
    focused: () => undefined,
    blurred: () => undefined,
    modeChanged: () => undefined,
  });

  let hasLink = false;
  // The Copy button runs the copy command and shows its keys, drawn again on
  // each keymap change.
  const drawCopy = () => {
    const drawn = textButton(
      'Copy',
      () => deps.run(chatCommand('copySignInLink')),
      {
        variant: 'ghost',
        hint: keyHint(deps.keys, deps.platform, 'copySignInLink', 'signIn'),
      },
    );
    drawn.disabled = !hasLink;
    linkRow.replaceChildren(link, drawn);
    return drawn;
  };
  let copy = drawCopy();
  deps.keys.onChanged(() => {
    copy = drawCopy();
  });
  const showLink = (url: string | null) => {
    link.textContent = url ?? WAITING_TEXT;
    hasLink = url !== null;
    copy.disabled = !hasLink;
  };

  return createSignInFlow({
    view: {
      show(profile) {
        dialog.setTitle(`Sign in to ${profile}`);
        dialog.show();
        editor.focus({ insert: true });
      },
      showLink,
      code: () => editor.text(),
      hide() {
        editor.blur();
        editor.setText('');
        showLink(null);
        dialog.hide();
      },
    },
    channel: deps.channel,
    pushScope: deps.pushScope,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    toast: deps.toast,
    log: deps.log,
  });
}
