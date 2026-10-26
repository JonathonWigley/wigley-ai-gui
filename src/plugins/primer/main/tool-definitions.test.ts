import { describe, expect, it } from 'vitest';
import { PRIMER_TOOLS } from './tool-definitions';

interface PropertySchema {
  type?: string;
  enum?: string[];
  default?: unknown;
  minItems?: number;
  maxItems?: number;
}

interface ObjectSchema {
  required?: string[];
  additionalProperties: boolean;
  properties: Record<string, PropertySchema>;
}

interface OpenPrimerSchema extends ObjectSchema {
  properties: {
    feature: ObjectSchema & PropertySchema;
    entries: PropertySchema & { items: ObjectSchema };
  };
}

function schemaOf(name: string): Record<string, unknown> {
  const tool = PRIMER_TOOLS.find((each) => each.name === name);
  if (tool === undefined) {
    throw new Error(`PRIMER_TOOLS has no ${name}`);
  }
  return tool.inputSchema;
}

function descriptionOf(name: string): string {
  return PRIMER_TOOLS.find((each) => each.name === name)?.description ?? '';
}

const openPrimer = schemaOf('open_primer') as unknown as OpenPrimerSchema;
const entrySchema = openPrimer.properties.entries.items;
const collectLastPrimer = schemaOf(
  'collect_last_primer',
) as unknown as ObjectSchema;

describe('PRIMER_TOOLS', () => {
  it('publishes open_primer and collect_last_primer', () => {
    expect(PRIMER_TOOLS.map((tool) => tool.name)).toEqual([
      'open_primer',
      'collect_last_primer',
    ]);
  });

  it('requires feature and entries, name and slug, and id, task, need and items', () => {
    expect(openPrimer.required).toEqual(['feature', 'entries']);
    expect(openPrimer.properties.feature.required).toEqual(['name', 'slug']);
    expect(entrySchema.required).toEqual(['id', 'task', 'need', 'items']);
    expect(openPrimer.additionalProperties).toBe(false);
    expect(openPrimer.properties.feature.additionalProperties).toBe(false);
    expect(entrySchema.additionalProperties).toBe(false);
  });

  it('caps entries at 60 and items at 20', () => {
    expect(openPrimer.properties.entries.maxItems).toBe(60);
    expect(entrySchema.properties.items.maxItems).toBe(20);
  });

  it('offers group as primer or standing and need as yes, no or unclear', () => {
    expect(entrySchema.properties.group).toMatchObject({
      enum: ['primer', 'standing'],
      default: 'primer',
    });
    expect(entrySchema.properties.need.enum).toEqual(['yes', 'no', 'unclear']);
  });

  it('names the app, never a browser', () => {
    for (const name of ['open_primer', 'collect_last_primer']) {
      expect(descriptionOf(name)).toContain('app');
      expect(descriptionOf(name)).not.toMatch(/browser/i);
    }
  });

  it('sends needs_manual_open back to open_primer, never collect_last_primer', () => {
    expect(descriptionOf('open_primer')).toContain(
      "Outcome 'needs_manual_open' means the relay could not start the app",
    );
    expect(descriptionOf('open_primer')).toContain(
      'collect_last_primer is never the answer to it.',
    );
    expect(descriptionOf('collect_last_primer')).not.toContain(
      'needs_manual_open',
    );
  });

  it('gives collect_last_primer one optional wait flag defaulting to true', () => {
    expect(collectLastPrimer.required).toBeUndefined();
    expect(Object.keys(collectLastPrimer.properties)).toEqual(['wait']);
    expect(collectLastPrimer.properties.wait).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });
});
