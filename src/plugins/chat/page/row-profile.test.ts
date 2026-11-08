import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatProfile } from '../contract';
import { DEFAULT_PROFILES } from '../manifest';
import { createChatLayouts } from './chat-layouts';
import { createRowProfile, profileNameOf } from './row-profile';

const HOME = '/Users/u';

// A row profile over rows' folders and profiles the test sets.
function setUp() {
  const folders = new Map<string, string>();
  let profiles: readonly ChatProfile[] = DEFAULT_PROFILES;
  const log = () => undefined;
  const rowProfile = createRowProfile({
    layouts: createChatLayouts(log),
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
    profileDirOf: (sessionId) => folders.get(sessionId) ?? null,
  });
  const drawRow = (sessionId: string) => {
    const wrapper = new FakeElement('div');
    const drawn = rowProfile.part.build(asHtml(wrapper), sessionId);
    return { wrapper, dispose: () => drawn.dispose?.() };
  };
  const setProfiles = (next: readonly ChatProfile[]) => {
    profiles = next;
  };
  return { rowProfile, folders, drawRow, setProfiles };
}

describe('profileNameOf', () => {
  it.each([
    { folder: `${HOME}/.claude`, name: 'work' },
    { folder: `${HOME}/.claude-personal/`, name: 'personal' },
    { folder: '~/.claude-personal', name: 'personal' },
    { folder: `${HOME}/.claude-other`, name: '.claude-other' },
  ])('$folder reads as $name', ({ folder, name }) => {
    expect(profileNameOf(folder, DEFAULT_PROFILES, posixPaths, HOME)).toBe(
      name,
    );
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

  it('build_RowWithNoFolder_DrawsNothing', () => {
    const { drawRow } = setUp();

    const { wrapper } = drawRow('s1');

    expect(wrapper.childNodes).toEqual([]);
  });

  it('profilesChanged_ProfileRenamed_DrawsTheNewName', () => {
    const { rowProfile, folders, drawRow, setProfiles } = setUp();
    folders.set('s1', `${HOME}/.claude`);
    const { wrapper } = drawRow('s1');

    setProfiles([{ name: 'job', configDir: '~/.claude' }]);
    rowProfile.profilesChanged();

    expect(wrapper.textContent).toBe('job');
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
