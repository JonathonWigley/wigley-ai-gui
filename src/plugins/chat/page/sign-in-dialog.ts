import type { EditorHost } from '../../../contracts/editor';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ChatChannel } from '../contract';
import { chatCommand, chatScope } from '../ids';
import type { SignInInput } from '../layouts/layout';
import type { WriteClipboard } from './clipboard';
import {
  createChatDialog,
  type DialogDeps,
  redrawOnLayoutChange,
} from './chat-dialogs';
import {
  createSignInPart,
  type DialogAction,
  dialogActions,
} from './dialog-kits';
import { createSignInFlow } from './sign-in-flow';

export interface SignInDialogDeps extends DialogDeps {
  editor: EditorHost;
  channel: Pick<PageChannel<ChatChannel>, 'invoke' | 'on'>;
  writeClipboard: WriteClipboard;
  toast(text: string, tone: ToastTone): void;
  // True once chat's page part stopped: a reply landing later does nothing.
  isStopped(): boolean;
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
// closed. `finished` is called once per open: with whether the profile is now
// signed in at the sign-in's end, and false on a cancel, a replacing `open` or
// a rejected `logIn`. After chat stops, a rejected `logIn` returns before it
// calls `finished`, so an open pending then may never finish.
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

export function createSignInDialog(deps: SignInDialogDeps): SignInDialog {
  const dialog = createChatDialog('Sign in', 'signIn', deps);
  const box = inputFrame();
  box.classList.add('chat-sign-in-box');

  // The Copy button runs the copy command and shows its keys in the box, which
  // holds focus while the dialog is open; it is enabled once main reports a
  // link.
  const copyHint = element('span', 'chat-dialog-key');
  deps.keys.anchor(copyHint, chatCommand('copySignInLink'), {
    scope: chatScope('signIn'),
    where: 'box',
  });
  const copy = textButton(
    'Copy',
    () => deps.run(chatCommand('copySignInLink')),
    { variant: 'ghost', hint: copyHint },
  );
  copy.disabled = true;
  const part = createSignInPart(deps, () => dialog.body, {
    codeBox: box,
    copy,
    actions: dialogActions(SIGN_IN_ACTIONS, deps),
  });
  let shown: SignInInput = { profile: '', link: null };
  part.draw(shown);
  const editor = deps.editor.create(box, '', {
    changed: () => undefined,
    focused: () => undefined,
    blurred: () => undefined,
    modeChanged: () => undefined,
  });
  redrawOnLayoutChange(deps, dialog, part, box, editor);
  const showLink = (url: string | null) => {
    shown = { ...shown, link: url };
    copy.disabled = url === null;
    part.update(shown);
  };

  return createSignInFlow({
    view: {
      show(profile) {
        dialog.setTitle(`Sign in to ${profile}`);
        shown = { profile, link: null };
        part.update(shown);
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
    writeClipboard: deps.writeClipboard,
    toast: deps.toast,
    log: deps.log,
    isStopped: deps.isStopped,
  });
}
