import type { Log } from '../../../contracts/log';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { ChatChannel, ChatProfile, RecentFolder } from '../contract';
import type { Picker } from './picker';
import {
  displayPath,
  type FolderItem,
  folderItems,
  preselectedProfile,
  profileLabel,
} from './start-prompt-items';

export interface StartPromptDeps {
  picker: Picker;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  profiles(): readonly ChatProfile[];
  reveal(sessionId: string): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// What the prompt has gathered once its first answers arrive.
interface PromptContext {
  deps: StartPromptDeps;
  recent: readonly RecentFolder[];
  homeDir: string;
  profiles: readonly ChatProfile[];
}

// Asks for a folder, then a profile when there is more than one, and starts a
// chat session there, revealing its Chat tab. Esc at either step starts
// nothing.
export function openStartPrompt(deps: StartPromptDeps): void {
  const { channel, log } = deps;
  void Promise.all([
    channel.invoke('recentFolders'),
    channel.invoke('homeDir'),
  ]).then(
    ([recent, homeDir]) => {
      const profiles = deps.profiles();
      if (profiles.length === 0) {
        log('chat', 'no profiles in the chat settings');
        deps.toast("Add a profile to chat's profiles setting first", 'error');
        return;
      }
      openFolderStep({ deps, recent, homeDir, profiles });
    },
    (error: unknown) => {
      log('chat', `start prompt not opened: ${errorText(error)}`);
      deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
    },
  );
}

function openFolderStep(context: PromptContext) {
  context.deps.picker.open<FolderItem>({
    title: 'Folder',
    items: folderItems(context.recent, context.homeDir),
    label: (item) => item.label,
    selected: 0,
    picked: (item) =>
      item.kind === 'recent'
        ? openProfileStep(context, item.folder.projectDir)
        : chooseFolder(context),
  });
}

// The folder dialog; dismissing it returns to the folder step.
function chooseFolder(context: PromptContext) {
  const { deps } = context;
  void deps.channel.invoke('chooseFolder').then(
    (projectDir) => {
      if (projectDir === null) {
        deps.log('chat', 'no folder chosen');
        openFolderStep(context);
        return;
      }
      openProfileStep(context, projectDir);
    },
    (error: unknown) => {
      deps.log('chat', `folder dialog failed: ${errorText(error)}`);
      deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
    },
  );
}

function openProfileStep(context: PromptContext, projectDir: string) {
  const { profiles } = context;
  if (profiles.length === 1) {
    startSession(context, projectDir, profiles[0]);
    return;
  }
  context.deps.picker.open<ChatProfile>({
    title: 'Profile',
    items: profiles,
    label: profileLabel,
    selected: preselectedProfile(profiles, context.recent, projectDir),
    picked: (profile) => startSession(context, projectDir, profile),
  });
}

function startSession(
  context: PromptContext,
  projectDir: string,
  profile: ChatProfile,
) {
  const { deps } = context;
  deps.log(
    'chat',
    `starting a session in ${displayPath(projectDir, context.homeDir)} with ${profile.name}`,
  );
  void deps.channel.invoke('start', { projectDir, profile: profile.name }).then(
    (sessionId) => deps.reveal(sessionId),
    (error: unknown) => {
      deps.log('chat', `session not started: ${errorText(error)}`);
      deps.toast(`Session not started: ${errorText(error)}`, 'error');
    },
  );
}
