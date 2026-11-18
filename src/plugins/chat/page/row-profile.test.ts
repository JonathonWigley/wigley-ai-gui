import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessProfile } from '../../../contracts/agent';
import type { RegisteredProfile } from '../../../shared/harness-profiles';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createRowProfile, profileNameOf } from './row-profile';

const HOME = '/Users/u';
const PROFILES: RegisteredProfile[] = [
  { harnessId: 'claude', name: 'work', configDir: '~/.claude' },
  { harnessId: 'claude', name: 'personal', configDir: '~/.claude-personal' },
];

// A row profile over rows' folders and profiles the test sets.
function setUp() {
  const folders = new Map<string, string>();
  const held = new Map<string, string>();
  let profiles: readonly HarnessProfile[] = PROFILES;
  const log = () => undefined;
  const layouts = createChatLayouts(log);
  const rowProfile = createRowProfile({
    layouts,
    kit: {
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: (text: string) => Promise.resolve(text),
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos' as const,
      state: noLayoutState,
      log,
    },
    paths: posixPaths,
    homeDir: HOME,
    log,
    profiles: () => profiles,
    heldProfile: (sessionId) => held.get(sessionId) ?? null,
    profileDirOf: (sessionId) => folders.get(sessionId) ?? null,
  });
  const drawRow = (sessionId: string) => {
    const wrapper = new FakeElement('div');
    const drawn = rowProfile.part.build(asHtml(wrapper), sessionId);
    return { wrapper, dispose: () => drawn.dispose?.() };
  };
  const setProfiles = (next: readonly RegisteredProfile[]) => {
    profiles = next;
  };
  return { rowProfile, layouts, folders, held, drawRow, setProfiles };
}

describe('profileNameOf', () => {
  it.each([
    { folder: `${HOME}/.claude`, name: 'work' },
    { folder: `${HOME}/.claude-personal/`, name: 'personal' },
    { folder: '~/.claude-personal', name: 'personal' },
    { folder: `${HOME}/.claude-other`, name: '.claude-other' },
  ])('$folder reads as $name', ({ folder, name }) => {
    expect(profileNameOf(folder, PROFILES, posixPaths, HOME)).toBe(name);
  });
});

describe('createRowProfile', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build_RowWithAFolder_DrawsItsProfileName', () => {
    const { folders, drawRow } = setUp();
    folders.set('s1', `${HOME}/.claude-personal`);

    const { wrapper } = drawRow('s1');

    expect(wrapper.textContent).toBe('personal');
  });

  it('build_RowsOfTwoHarnesses_EachDrawsItsOwnProfileName', () => {
    const { folders, drawRow, setProfiles } = setUp();
    setProfiles([
      { harnessId: 'claude', name: 'work', configDir: '~/.claude' },
      { harnessId: 'lab', name: 'lab', configDir: '~/.lab' },
    ]);
    folders.set('s1', `${HOME}/.claude`);
    folders.set('s2', `${HOME}/.lab`);

    expect(drawRow('s1').wrapper.textContent).toBe('work');
    expect(drawRow('s2').wrapper.textContent).toBe('lab');
  });

  it('build_RowWithNoFolder_DrawsNothing', () => {
    const { drawRow } = setUp();

    const { wrapper } = drawRow('s1');

    expect(wrapper.childNodes).toEqual([]);
  });

  it('profilesChanged_ProfileRenamed_DrawsTheNewName', () => {
    const { rowProfile, folders, drawRow, setProfiles } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    const { wrapper } = drawRow('s1');

    setProfiles([{ harnessId: 'claude', name: 'job', configDir: '~/.claude' }]);
    rowProfile.profilesChanged();

    expect(wrapper.textContent).toBe('job');
    expect(wrapper.childNodes.length).toBe(1);
  });

  it('build_HeldSessionWhoseProfileLeftTheSetting_DrawsTheHeldName', () => {
    const { folders, held, drawRow } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    held.set('s1', 'gone');

    const { wrapper } = drawRow('s1');

    expect(wrapper.textContent).toBe('gone');
  });

  it('changed_SessionNowHeld_DrawsTheHeldName', () => {
    const { rowProfile, folders, held, drawRow } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    const { wrapper } = drawRow('s1');

    held.set('s1', 'personal');
    rowProfile.changed('s1');

    expect(wrapper.textContent).toBe('personal');
    expect(wrapper.childNodes.length).toBe(1);
  });

  it('changed_SameName_KeepsTheDrawnTag', () => {
    const { rowProfile, held, drawRow } = setUp();
    held.set('s1', 'work');
    const { wrapper } = drawRow('s1');
    const drawn = wrapper.childNodes[0];

    rowProfile.changed('s1');

    expect(wrapper.childNodes).toEqual([drawn]);
  });

  it('layoutsChange_KeptRow_DrawsWithTheNewLayout', () => {
    const { layouts, folders, drawRow } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    const { wrapper } = drawRow('s1');
    const rowProfile: ChatLayout['rowProfile'] = (parent, input) => {
      const element = document.createElement('b');
      element.textContent = `mine ${input.name}`;
      parent.append(element);
      return { element };
    };

    layouts.set(withUser<ChatLayout>(defaultLayout, { rowProfile }));

    expect(wrapper.textContent).toBe('mine work');
    expect(wrapper.childNodes.length).toBe(1);
  });

  it('dispose_DrawnRow_RemovesTheTag', () => {
    const { folders, drawRow } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    const { wrapper, dispose } = drawRow('s1');

    dispose();

    expect(wrapper.childNodes).toEqual([]);
  });
});
