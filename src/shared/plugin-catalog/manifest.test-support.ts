// A manifest as `manifest.json` holds it, which a test changes freely.
export type RawManifest = Record<string, any>;

// A manifest using every field, as a built-in declares it.
export function validManifest(): RawManifest {
  return {
    $schema: '../_types/manifest.schema.json',
    id: 'notes-plus',
    label: 'Notes plus',
    description: 'Adds a list of notes.',
    dependsOn: { main: ['sessions'], page: ['forms'] },
    reads: { main: ['layouts'], page: ['primer'] },
    commands: {
      open: {
        label: 'Open note',
        group: 'Notes',
        runsIn: 'page',
        arg: 'string',
        targets: true,
      },
      sync: {
        label: 'Sync notes',
        group: 'Notes',
        runsIn: 'main',
        risky: true,
      },
    },
    scopes: { list: 'In the notes list' },
    keys: {
      binds: [
        {
          keys: '<Leader>no',
          scope: 'list',
          command: 'open',
          where: 'both',
          arg: 'today',
        },
      ],
      groups: { '<Leader>n': 'Notes' },
      app: [{ accelerator: 'CommandOrControl+Shift+N', command: 'sync' }],
      global: [
        { accelerator: 'CommandOrControl+Alt+N', command: 'sync', arg: 3 },
      ],
      intercept: [{ key: 'n', meta: true, shift: false, command: 'sync' }],
    },
    settings: { view: { width: 320 }, filter: null },
    optionalSettings: { filter: 'string' },
    settingInfo: {
      'view.width': {
        label: 'List width',
        description: 'The width of the list.',
      },
      filter: {
        label: 'Filter',
        description: 'The text the list shows notes for.',
      },
    },
    themeTokens: { accent: { kind: 'color', default: '#3366ff' } },
  };
}
