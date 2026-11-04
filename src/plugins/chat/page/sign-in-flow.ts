import type { Log } from '../../../contracts/log';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { ChatChannel } from '../contract';
import { accountText } from './account-commands';
import type { WriteClipboard } from './clipboard';
import type { SignInDialog } from './sign-in-dialog';

// The dialog's look, which the flow drives: `show` shows it for the profile
// with its box focused in insert mode, `showLink` shows the link (null: none
// yet), `code` reads the box, and `hide` empties and hides it.
export interface SignInView {
  show(profile: string): void;
  showLink(url: string | null): void;
  code(): string;
  hide(): void;
}

export interface SignInFlowDeps {
  view: SignInView;
  channel: Pick<PageChannel<ChatChannel>, 'invoke' | 'on'>;
  // Pushes the dialog's own scope.
  pushScope(): PushedScope;
  writeClipboard: WriteClipboard;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

interface OpenSignIn {
  id: number;
  profile: string;
  finished(signedIn: boolean): void;
  scope: PushedScope;
  url: string | null;
}

// The sign-in dialog's behaviour over its view, as `SignInDialog` states it.
// Each open is a sign-in of its own id, and main's messages for any other id
// are logged and ignored.
export function createSignInFlow(deps: SignInFlowDeps): SignInDialog {
  const { view, channel, log } = deps;
  let nextId = 1;
  let open: OpenSignIn | null = null;

  const close = () => {
    const held = open;
    if (held === null) {
      return null;
    }
    open = null;
    view.hide();
    held.scope.pop();
    return held;
  };

  const cancel = () => {
    const cancelled = close();
    if (cancelled === null) {
      return;
    }
    void channel
      .invoke('cancelLogIn', cancelled.id)
      .catch((error: unknown) =>
        log('chat', `cancelLogIn failed: ${errorText(error)}`),
      );
    cancelled.finished(false);
    log('chat', `sign-in cancelled for ${cancelled.profile}`);
  };

  channel.on('logInLink', ({ id, profile, url }) => {
    if (open?.id !== id) {
      log('chat', `sign-in link for ${profile} with no dialog open for it`);
      return;
    }
    open.url = url;
    view.showLink(url);
    log('chat', `sign-in link shown for ${profile}`);
  });
  channel.on('logInEnded', ({ id, profile, status, error }) => {
    if (open?.id !== id) {
      log('chat', `sign-in for ${profile} ended with its dialog closed`);
      return;
    }
    // A failed sign-in may still read signed in, as a wrong code on a profile
    // already signed in does.
    const isSignedIn = status?.signedIn === true && error === null;
    close()?.finished(isSignedIn);
    if (isSignedIn) {
      log('chat', `signed in to ${profile}`);
      deps.toast(
        `Signed in to ${profile} as ${accountText(status.account)}`,
        'success',
      );
      return;
    }
    const reason = error ?? `${profile} is still signed out`;
    log('chat', `sign-in failed for ${profile}: ${reason}`);
    deps.toast(`Sign-in failed: ${reason}`, 'error');
  });

  return {
    open(profile, finished = () => undefined) {
      if (open !== null) {
        log('chat', `sign-in for ${open.profile} replaced`);
        cancel();
      }
      const opened: OpenSignIn = {
        id: nextId++,
        profile,
        finished,
        scope: deps.pushScope(),
        url: null,
      };
      open = opened;
      view.show(profile);
      log('chat', `sign-in dialog shown for ${profile}`);
      void channel
        .invoke('logIn', opened.id, profile)
        .catch((error: unknown) => {
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
      const code = view.code().trim();
      if (code === '') {
        log('chat', 'no sign-in code to send');
        return;
      }
      void channel
        .invoke('logInCode', open.id, code)
        .catch((error: unknown) =>
          log('chat', `logInCode failed: ${errorText(error)}`),
        );
      log('chat', `sign-in code sent for ${open.profile}`);
    },
    cancel,
    copyLink() {
      const url = open?.url ?? null;
      if (url === null) {
        log('chat', 'no sign-in link yet');
        return;
      }
      void deps.writeClipboard(url).then(
        () => log('chat', 'sign-in link copied'),
        (error: unknown) =>
          log('chat', `sign-in link not copied: ${errorText(error)}`),
      );
    },
  };
}
