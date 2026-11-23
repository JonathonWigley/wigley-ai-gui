import type { PageApi, PagePart } from '../../../contracts/plugin';
import type { WorkChannel } from '../contract';
import { workManifest } from '../manifest';

type WorkPageApi = PageApi<typeof workManifest, WorkChannel>;

// Runs each work command by invoking main's channel method of the same name with the command's arg, returning the
// invoke so a reporting run rejects with main's refusal. It draws nothing and reads no slot.
export const workPagePart: PagePart<typeof workManifest> = {
  manifest: workManifest,
  start(api: WorkPageApi) {
    const { channel } = api;
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
        startSession: ({ arg }) => channel.invoke('startSession', arg),
        openJobRow: () => channel.invoke('openJobRow'),
      },
    };
  },
};
