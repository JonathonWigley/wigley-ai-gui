import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  COLLECT_AUDIO_PICKER_TOOL,
  MAX_CANDIDATES,
  MAX_MOMENTS,
  MAX_VARIANT_FILES,
  OPEN_AUDIO_PICKER_TOOL,
  PLAY_MODES,
} from '../contract';
import { createAudioPickerType } from './picker-type';
import { AUDIO_PICKER_TOOLS } from './tool-definitions';

interface ListSchema {
  maxItems?: number;
  items: ObjectSchema;
}

interface ObjectSchema {
  properties: Record<string, ListSchema & { enum?: string[] }>;
}

function schemaOf(name: string): ObjectSchema {
  const tool = AUDIO_PICKER_TOOLS.find((each) => each.name === name);
  if (tool === undefined) {
    throw new Error(`AUDIO_PICKER_TOOLS has no ${name}`);
  }
  return tool.inputSchema as unknown as ObjectSchema;
}

const moments = schemaOf(OPEN_AUDIO_PICKER_TOOL).properties.moments;
const candidates = moments.items.properties.candidates;
const candidate = candidates.items.properties;

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

  it.each([
    { field: 'play enum', actual: candidate.play.enum, limit: [...PLAY_MODES] },
    { field: 'moments maxItems', actual: moments.maxItems, limit: MAX_MOMENTS },
    {
      field: 'candidates maxItems',
      actual: candidates.maxItems,
      limit: MAX_CANDIDATES,
    },
    {
      field: 'files maxItems',
      actual: candidate.files.maxItems,
      limit: MAX_VARIANT_FILES,
    },
  ])("the schema keeps parse's limits ($field)", ({ actual, limit }) => {
    expect(actual).toEqual(limit);
  });
});
