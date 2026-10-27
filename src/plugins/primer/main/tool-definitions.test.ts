import { describe, expect, it } from 'vitest';
import { parsePrimer } from './primer';
import { PrimerError } from './primer-error';
import { primerType } from './primer-type';
import { PRIMER_TOOLS } from './tool-definitions';

interface PropertySchema {
  enum?: string[];
}

interface ObjectSchema {
  required?: string[];
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

const openPrimer = schemaOf('open_primer') as unknown as OpenPrimerSchema;
const featureSchema = openPrimer.properties.feature;
const entrySchema = openPrimer.properties.entries.items;

type Part = 'args' | 'feature' | 'entry';

// Valid open_primer args with the entry's fields overridden by `entry`, then
// `field` of `part` deleted when one is named.
function primerArgs(
  entry: Record<string, unknown> = {},
  missing?: { part: Part; field: string },
): Record<string, unknown> {
  const feature: Record<string, unknown> = {
    name: 'Notes popup',
    slug: 'notes-popup',
  };
  const first: Record<string, unknown> = {
    id: '3',
    task: 'Data model',
    need: 'yes',
    items: ['Add the record type'],
    ...entry,
  };
  const args: Record<string, unknown> = { feature, entries: [first] };
  if (missing !== undefined) {
    const parts = { args, feature, entry: first };
    delete parts[missing.part][missing.field];
  }
  return args;
}

function rowsOf(part: Part, schema: ObjectSchema) {
  return (schema.required ?? []).map((field) => ({ part, field }));
}

describe('PRIMER_TOOLS', () => {
  it('publishes the tools the primer type answers', () => {
    expect(PRIMER_TOOLS.map((tool) => tool.name)).toEqual([
      primerType.openTool,
      primerType.collectTool,
    ]);
  });

  it.each([
    ...rowsOf('args', openPrimer),
    ...rowsOf('feature', featureSchema),
    ...rowsOf('entry', entrySchema),
  ])(
    'requires $part.$field, which the parser refuses to miss',
    ({ part, field }) => {
      expect(() => parsePrimer(primerArgs())).not.toThrow();
      expect(() => parsePrimer(primerArgs({}, { part, field }))).toThrow(
        PrimerError,
      );
    },
  );

  it.each(['group', 'need'])(
    'offers each %s the parser accepts, and the parser refuses any other',
    (field) => {
      const offered = entrySchema.properties[field].enum ?? [];

      expect(offered.length).toBeGreaterThan(0);
      for (const value of offered) {
        const primer = parsePrimer(primerArgs({ [field]: value }));
        expect(primer.entries[0]).toMatchObject({ [field]: value });
      }
      expect(() => parsePrimer(primerArgs({ [field]: 'sometimes' }))).toThrow(
        PrimerError,
      );
    },
  );
});
