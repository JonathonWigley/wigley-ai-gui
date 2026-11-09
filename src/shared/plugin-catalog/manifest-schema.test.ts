import { describe, expect, it } from 'vitest';
import { PLUGIN_ID_PATTERN } from '../define-plugin';
import { validManifest } from './manifest.test-support';
import { manifestSchema } from './manifest-schema';
import { SHORT_ID_PATTERN, TOKEN_KINDS } from './validate-manifest';

// The parts of the schema the test reads.
interface SchemaParts {
  required: string[];
  properties: {
    id: { pattern: string };
    commands: { propertyNames: { pattern: string } };
    scopes: { propertyNames: { pattern: string } };
    themeTokens: {
      additionalProperties: { properties: { kind: { enum: string[] } } };
    };
  };
}

describe('manifestSchema', () => {
  it("states the manifest's fields and the id rule", () => {
    const schema = manifestSchema as SchemaParts;

    expect(new Set(Object.keys(schema.properties))).toEqual(
      new Set(Object.keys(validManifest())),
    );
    expect(new Set(schema.required)).toEqual(
      new Set([
        'id',
        'label',
        'description',
        'dependsOn',
        'reads',
        'commands',
        'scopes',
        'settings',
        'settingInfo',
        'themeTokens',
      ]),
    );
    expect(schema.properties.id.pattern).toBe(PLUGIN_ID_PATTERN);
    expect(schema.properties.commands.propertyNames.pattern).toBe(
      SHORT_ID_PATTERN,
    );
    expect(schema.properties.scopes.propertyNames.pattern).toBe(
      SHORT_ID_PATTERN,
    );
    expect(
      schema.properties.themeTokens.additionalProperties.properties.kind.enum,
    ).toEqual(TOKEN_KINDS);
  });
});
