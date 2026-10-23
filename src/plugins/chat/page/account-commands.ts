import type { Disposable } from '../../../contracts/disposable';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import type { ChatChannel, SlashCommandContext } from '../contract';
import type { SignInDialog } from './sign-in-dialog';
import type { SlashCommands } from './slash-commands';

export interface AccountCommandDeps {
  commands: SlashCommands;
  signIn: Pick<SignInDialog, 'open'>;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  toast(text: string, tone: ToastTone): void;
}

// An account as a message names it.
export function accountText(account: string | null): string {
  return account ?? 'an unnamed account';
}

// Registers `/login`, `/logout` and `/status` on the session's profile. Each
// reports through a notice in the session's chat, or an info toast in an
// ended session, where main keeps no entries to show a notice in.
export function addAccountCommands(deps: AccountCommandDeps): Disposable[] {
  const { commands, channel } = deps;
  const report = (context: SlashCommandContext, text: string) => {
    if (context.ended) {
      deps.toast(text, 'info');
      return Promise.resolve();
    }
    return channel.invoke('notice', context.sessionId, text, 'info');
  };
  return [
    commands.add({
      name: 'login',
      description: "Sign in to this session's profile",
      run: ({ profile }) => deps.signIn.open(profile),
    }),
    commands.add({
      name: 'logout',
      description: "Sign out of this session's profile",
      run: async (context) => {
        await channel.invoke('logOut', context.profile);
        await report(context, `Signed out of ${context.profile}`);
      },
    }),
    commands.add({
      name: 'status',
      description: "Show this session's account",
      run: async (context) => {
        const status = await channel.invoke('accountStatus', context.profile);
        await report(
          context,
          status.signedIn
            ? `${context.profile}: signed in as ${accountText(status.account)}`
            : `${context.profile}: not signed in`,
        );
      },
    }),
  ];
}
