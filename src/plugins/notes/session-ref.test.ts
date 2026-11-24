import { describe, expect, it } from 'vitest';
import { harnessInfo } from '../../shared/agent-harness-registry.test-support';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { NoteSession } from './contract';
import { sessionChipText, sessionLine } from './session-ref';

const HOME = '/Users/u';
const SESSION: NoteSession = {
  sessionId: 'row-1',
  harness: 'claude',
  hostSessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
  projectDir: '/Users/u/Documents/ai-dev/wigley-ai-gui',
};
const BARE: NoteSession = { ...SESSION, harness: null, projectDir: null };
const HARNESSES = new Map([['claude', harnessInfo({ label: 'Claude Code' })]]);

describe('sessionLine', () => {
  it('sessionLine_FullSession_LabelIdAndTildeFolder', () => {
    expect(sessionLine(SESSION, HARNESSES, posixPaths, HOME)).toBe(
      'Source session: Claude Code a1b2c3d4-0000-4000-8000-000000000001 in ~/Documents/ai-dev/wigley-ai-gui',
    );
  });

  it('sessionLine_NoHarnessNoFolder_IdAlone', () => {
    expect(sessionLine(BARE, HARNESSES, posixPaths, HOME)).toBe(
      'Source session: a1b2c3d4-0000-4000-8000-000000000001',
    );
  });

  it('sessionLine_UnregisteredCodex_StandInLabel', () => {
    const codex: NoteSession = { ...BARE, harness: 'codex' };
    expect(sessionLine(codex, HARNESSES, posixPaths, HOME)).toBe(
      'Source session: Codex a1b2c3d4-0000-4000-8000-000000000001',
    );
  });
});

describe('sessionChipText', () => {
  it('sessionChipText_FullSession_LabelShortIdAndTildeFolder', () => {
    const chip = sessionChipText(SESSION, HARNESSES, posixPaths, HOME);

    expect(chip).toContain('a1b2c3d4');
    expect(chip).toContain('~/Documents/ai-dev/wigley-ai-gui');
  });

  it('sessionChipText_NoHarnessNoFolder_ShortIdAlone', () => {
    expect(sessionChipText(BARE, HARNESSES, posixPaths, HOME)).toBe('a1b2c3d4');
  });
});
