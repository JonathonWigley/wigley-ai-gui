import type { PageApi, PagePart } from '../../../contracts/plugin';
import { chatPageKey } from '../../chat/contract';
import type { WorkChannel, WorkStartArg } from '../contract';
import { workManifest } from '../manifest';

type WorkPageApi = PageApi<typeof workManifest, WorkChannel>;

// Runs each work command by invoking main's channel method of the same name with the command's arg, returning the
// invoke so a reporting run rejects with main's refusal. It draws nothing and reads no slot. `startSession` alone does
// more: a launched session's toast shows with tone `success`, and a target no project fits opens chat's new-session
// prompt with main's message in the box, then links the session it starts to the cards main named.
export const workPagePart: PagePart<typeof workManifest> = {
  manifest: workManifest,
  start(api: WorkPageApi) {
    const { channel } = api;
    const chat = api.dependency(chatPageKey);

    const startSession = async (arg: WorkStartArg) => {
      const result = await channel.invoke('startSession', arg);
      if (result.kind === 'launched') {
        api.services.toast(result.toast, 'success');
        return;
      }
      const sessionId = await chat.newSessionWithDraft(result.message);
      if (sessionId !== null && result.cardIds.length > 0) {
        await channel.invoke('linkSession', {
          cardIds: result.cardIds,
          sessionId,
        });
      }
    };

    return {
      commands: {
        sweep: () => channel.invoke('sweep'),
        send: ({ arg }) => channel.invoke('send', arg),
        dismiss: ({ arg }) => channel.invoke('dismiss', arg),
        restore: ({ arg }) => channel.invoke('restore', arg),
        snooze: ({ arg }) => channel.invoke('snooze', arg),
        addToBoard: ({ arg }) => channel.invoke('addToBoard', arg),
        moveCard: ({ arg }) => channel.invoke('moveCard', arg),
        acceptSuggestion: ({ arg }) => channel.invoke('acceptSuggestion', arg),
        notYet: ({ arg }) => channel.invoke('notYet', arg),
        deleteTask: ({ arg }) => channel.invoke('deleteTask', arg),
        startSession: ({ arg }) => startSession(arg),
        openJobRow: () => channel.invoke('openJobRow'),
      },
    };
  },
};
