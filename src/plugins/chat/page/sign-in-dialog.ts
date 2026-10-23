import type { EditorHost } from '../../../contracts/editor';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ChatChannel } from '../contract';
import { accountText } from './account-commands';
import {
  type DialogAction,
  type DialogDeps,
  followKeymap,
} from './chat-dialogs';

export interface SignInDialogDeps extends DialogDeps {
  editor: EditorHost;
  channel: Pick<PageChannel<ChatChannel>, 'invoke' | 'on'>;
  toast(text: string, tone: ToastTone): void;
}

// The sign-in dialog, one at a time, belonging to a profile rather than a
// session. `open` starts the profile's sign-in and shows the dialog: the link
// main reports with a Copy button, and a box for a code the sign-in page
// shows; while the dialog is open, `open` focuses its box and starts nothing.
// `submitCode` sends the box's trimmed text when not empty. `cancel` cancels
// the sign-in, closes the dialog and calls `finished(false)`. The sign-in's
// end closes the dialog, calls `finished` with whether the profile is now
// signed in, and toasts the outcome; a `logIn` that rejects closes it too,
// calling `finished(false)`. Each does nothing while the dialog is closed.
export interface SignInDialog {
  open(profile: string, finished?: (signedIn: boolean) => void): void;
  submitCode(): void;
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

interface OpenSignIn {
  profile: string;
  finished(signedIn: boolean): void;
  scope: PushedScope;
  url: string | null;
}

export function createSignInDialog(deps: SignInDialogDeps): SignInDialog {
  const { channel, log } = deps;
  const dialog = createDialog('Sign in');
  const link = element('span', 'chat-sign-in-link', WAITING_TEXT);
  const copy = textButton('Copy', () => copyLink(), { variant: 'ghost' });
  const linkRow = element('div', 'chat-sign-in-link-row');
  linkRow.append(link, copy);
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

  let open: OpenSignIn | null = null;
  const showLink = (url: string | null) => {
    link.textContent = url ?? WAITING_TEXT;
    copy.disabled = url === null;
  };
  const close = () => {
    const held = open;
    if (held === null) {
      return null;
    }
    open = null;
    editor.blur();
    held.scope.pop();
    editor.setText('');
    showLink(null);
    dialog.hide();
    return held;
  };
  const copyLink = () => {
    const url = open?.url ?? null;
    if (url === null) {
      log('chat', 'no sign-in link yet');
      return;
    }
    void navigator.clipboard.writeText(url).then(
      () => log('chat', 'sign-in link copied'),
      (error: unknown) =>
        log('chat', `sign-in link not copied: ${errorText(error)}`),
    );
  };

  channel.on('logInLink', ({ profile, url }) => {
    if (open?.profile !== profile) {
      log('chat', `sign-in link for ${profile} with no dialog open for it`);
      return;
    }
    open.url = url;
    showLink(url);
    log('chat', `sign-in link shown for ${profile}`);
  });
  channel.on('logInEnded', ({ profile, status, error }) => {
    if (open?.profile !== profile) {
      log('chat', `sign-in for ${profile} ended with its dialog closed`);
      return;
    }
    const ended = close();
    const signedIn = status?.signedIn === true;
    ended?.finished(signedIn);
    if (signedIn) {
      deps.toast(
        `Signed in to ${profile} as ${accountText(status.account)}`,
        'success',
      );
      return;
    }
    deps.toast(
      `Sign-in failed: ${error ?? `${profile} is still signed out`}`,
      'error',
    );
  });

  showLink(null);
  return {
    open(profile, finished = () => undefined) {
      if (open !== null) {
        editor.focus({ insert: true });
        log('chat', `sign-in dialog already open for ${open.profile}`);
        return;
      }
      const opened: OpenSignIn = {
        profile,
        finished,
        scope: deps.pushScope(),
        url: null,
      };
      open = opened;
      dialog.setTitle(`Sign in to ${profile}`);
      dialog.show();
      editor.focus({ insert: true });
      log('chat', `sign-in dialog shown for ${profile}`);
      void channel.invoke('logIn', profile).catch((error: unknown) => {
        if (open === opened) {
          close();
          finished(false);
        }
        log('chat', `sign-in not started: ${errorText(error)}`);
        deps.toast(`Sign-in not started: ${errorText(error)}`, 'error');
      });
    },
    submitCode() {
      if (open === null) {
        return;
      }
      const code = editor.text().trim();
      if (code === '') {
        log('chat', 'no sign-in code to send');
        return;
      }
      void channel
        .invoke('logInCode', code)
        .catch((error: unknown) =>
          log('chat', `logInCode failed: ${errorText(error)}`),
        );
      log('chat', `sign-in code sent for ${open.profile}`);
    },
    cancel() {
      const cancelled = close();
      if (cancelled === null) {
        return;
      }
      void channel
        .invoke('cancelLogIn')
        .catch((error: unknown) =>
          log('chat', `cancelLogIn failed: ${errorText(error)}`),
        );
      cancelled.finished(false);
      log('chat', `sign-in cancelled for ${cancelled.profile}`);
    },
  };
}
