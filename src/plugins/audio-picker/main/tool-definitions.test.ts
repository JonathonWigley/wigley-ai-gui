import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { COLLECT_AUDIO_PICKER_TOOL, OPEN_AUDIO_PICKER_TOOL } from '../contract';
import { createAudioPickerType } from './picker-type';
import { AUDIO_PICKER_TOOLS } from './tool-definitions';

describe('AUDIO_PICKER_TOOLS', () => {
  it('publishes the tools the audio picker type answers', () => {
    const type = createAudioPickerType(posixPaths);

    expect(AUDIO_PICKER_TOOLS.map((tool) => tool.name)).toEqual([
      OPEN_AUDIO_PICKER_TOOL,
      COLLECT_AUDIO_PICKER_TOOL,
    ]);
    expect([type.openTool, type.collectTool]).toEqual([
      OPEN_AUDIO_PICKER_TOOL,
      COLLECT_AUDIO_PICKER_TOOL,
    ]);
  });
});
