import { describe, expect, it } from 'vitest';
import type { PluginManifest, ProcessName } from '../../contracts/plugin';
import { type RawManifest, validManifest } from './manifest.test-support';
import { handlerProblems, validateManifest } from './validate-manifest';

describe('validateManifest', () => {
  it('accepts a manifest with every field, dropping $schema', () => {
    const { $schema: _schema, ...expected } = validManifest();

    const check = validateManifest(validManifest());

    expect(check).toEqual({ ok: true, manifest: expected });
  });

  // A change to `validManifest()` making one fault, or a function returning the
  // raw value checked in its place.
  type Fault = (manifest: RawManifest) => unknown;
  const keyLists = ['binds', 'app', 'global', 'intercept'];
  const mainLists = ['app', 'global', 'intercept'];
  const modifiers = ['control', 'alt', 'shift', 'meta'];

  it.each<[string, Fault]>([
    ['manifest must be a JSON object', () => []],
    ['manifest must be a JSON object', () => 'notes-plus'],
    [
      'unknown field "version"',
      (m) => {
        m.version = '1.0.0';
      },
    ],
    [
      '$schema must be a string',
      (m) => {
        m.$schema = 1;
      },
    ],
    [
      'id must be a string',
      (m) => {
        m.id = 7;
      },
    ],
    [
      'Plugin id "My-Plugin" must be lowercase letters, digits and -',
      (m) => {
        m.id = 'My-Plugin';
      },
    ],
    [
      'Plugin id "_types" must be lowercase letters, digits and -',
      (m) => {
        m.id = '_types';
      },
    ],
    [
      'Plugin id "core" is reserved for the core',
      (m) => {
        m.id = 'core';
      },
    ],
    [
      'label must be a string',
      (m) => {
        m.label = 1;
      },
    ],
    [
      'description must be a string',
      (m) => {
        delete m.description;
      },
    ],
    [
      'dependsOn must be an object with main and page',
      (m) => {
        m.dependsOn = ['sessions'];
      },
    ],
    [
      'reads must be an object with main and page',
      (m) => {
        m.reads = null;
      },
    ],
    [
      'dependsOn has unknown field "both"',
      (m) => {
        m.dependsOn.both = [];
      },
    ],
    [
      'reads has unknown field "editor"',
      (m) => {
        m.reads.editor = [];
      },
    ],
    [
      'dependsOn.main must be an array of strings',
      (m) => {
        delete m.dependsOn.main;
      },
    ],
    [
      'dependsOn.page must be an array of strings',
      (m) => {
        m.dependsOn.page = [1];
      },
    ],
    [
      'reads.main must be an array of strings',
      (m) => {
        m.reads.main = 'layouts';
      },
    ],
    [
      'dependsOn.page names the plugin itself',
      (m) => {
        m.dependsOn.page.push('notes-plus');
      },
    ],
    [
      'reads.main names the plugin itself',
      (m) => {
        m.reads.main.push('notes-plus');
      },
    ],
    [
      'commands must be an object',
      (m) => {
        m.commands = [];
      },
    ],
    [
      'command "a.b" id must be a letter, then letters and digits',
      (m) => {
        m.commands['a.b'] = m.commands.sync;
      },
    ],
    [
      'command "1st" id must be a letter, then letters and digits',
      (m) => {
        m.commands['1st'] = m.commands.sync;
      },
    ],
    [
      'command "open" must be an object',
      (m) => {
        m.commands.open = 'Open note';
      },
    ],
    [
      'command "open" label must be a string',
      (m) => {
        delete m.commands.open.label;
      },
    ],
    [
      'command "open" group must be a string',
      (m) => {
        m.commands.open.group = 2;
      },
    ],
    [
      'command "open" runsIn must be "main" or "page"',
      (m) => {
        m.commands.open.runsIn = 'both';
      },
    ],
    [
      'command "open" has unknown field "hint"',
      (m) => {
        m.commands.open.hint = 'x';
      },
    ],
    [
      'command "open" arg must be "number", "string" or an object of those',
      (m) => {
        m.commands.open.arg = 'date';
      },
    ],
    [
      'command "open" arg must be "number", "string" or an object of those',
      (m) => {
        m.commands.open.arg = { day: 'date' };
      },
    ],
    [
      'scopes must be an object',
      (m) => {
        m.scopes = 'list';
      },
    ],
    [
      'scope "my-list" id must be a letter, then letters and digits',
      (m) => {
        m.scopes['my-list'] = 'A list';
      },
    ],
    [
      'scope "any" is reserved for binds that act in every scope',
      (m) => {
        m.scopes.any = 'Anywhere';
      },
    ],
    [
      'scope "list" title must be a string',
      (m) => {
        m.scopes.list = true;
      },
    ],
    [
      'keys must be an object',
      (m) => {
        m.keys = [];
      },
    ],
    [
      'keys has unknown field "chords"',
      (m) => {
        m.keys.chords = [];
      },
    ],
    [
      'keys.groups must be an object',
      (m) => {
        m.keys.groups = 'Notes';
      },
    ],
    [
      'keys.groups "<Leader>n" must be a string',
      (m) => {
        m.keys.groups['<Leader>n'] = 1;
      },
    ],
    [
      'keys.remaps must be an array',
      (m) => {
        m.keys.remaps = {};
      },
    ],
    [
      '"keys.remaps[0]" must be an object, not a string.',
      (m) => {
        m.keys.remaps[0] = 'jk';
      },
    ],
    [
      '"keys.remaps[0].when" is not a field of an editor remap.',
      (m) => {
        m.keys.remaps[0].when = 'x';
      },
    ],
    [
      '"keys.remaps[0].to" is missing.',
      (m) => {
        delete m.keys.remaps[0].to;
      },
    ],
    [
      '"keys.remaps[0].mode" must be one of normal, insert, not "visual".',
      (m) => {
        m.keys.remaps[0].mode = 'visual';
      },
    ],
    [
      '"keys.remaps[0].keys" is empty.',
      (m) => {
        m.keys.remaps[0].keys = '';
      },
    ],
    ...keyLists.flatMap((list): [string, Fault][] => [
      [
        `keys.${list} must be an array`,
        (m) => {
          m.keys[list] = {};
        },
      ],
      [
        `keys.${list}[0] must be an object`,
        (m) => {
          m.keys[list][0] = 'sync';
        },
      ],
      [
        `keys.${list}[0] has unknown field "when"`,
        (m) => {
          m.keys[list][0].when = 'x';
        },
      ],
      [
        `keys.${list}[0] command must be a string`,
        (m) => {
          delete m.keys[list][0].command;
        },
      ],
      [
        `keys.${list}[0] command "nope" is not a declared command`,
        (m) => {
          m.keys[list][0].command = 'nope';
        },
      ],
      [
        `keys.${list}[0] arg must be a number, a string or an object of those`,
        (m) => {
          m.keys[list][0].arg = { day: true };
        },
      ],
    ]),
    [
      'keys.binds[0] keys must be a string',
      (m) => {
        m.keys.binds[0].keys = ['<Leader>no'];
      },
    ],
    [
      'keys.binds[0] scope must be a string',
      (m) => {
        m.keys.binds[0].scope = 1;
      },
    ],
    [
      'keys.binds[0] where must be "page", "box" or "both"',
      (m) => {
        m.keys.binds[0].where = 'editor';
      },
    ],
    [
      'keys.binds[0] mode must be "normal" or "insert"',
      (m) => {
        m.keys.binds[0].mode = 'visual';
      },
    ],
    [
      'keys.binds[0] command "sync" runs in main; bind it under keys.app, keys.global or keys.intercept',
      (m) => {
        m.keys.binds[0].command = 'sync';
      },
    ],
    ...mainLists.map((list): [string, Fault] => [
      `keys.${list}[0] command "open" runs in the page; bind it under keys.binds`,
      (m) => {
        m.keys[list][0].command = 'open';
      },
    ]),
    [
      'keys.app[0] accelerator must be a string',
      (m) => {
        delete m.keys.app[0].accelerator;
      },
    ],
    [
      'keys.global[0] accelerator must be a string',
      (m) => {
        m.keys.global[0].accelerator = 1;
      },
    ],
    [
      'keys.intercept[0] key must be a string',
      (m) => {
        m.keys.intercept[0].key = 78;
      },
    ],
    ...modifiers.map((modifier): [string, Fault] => [
      `keys.intercept[0] ${modifier} must be a boolean`,
      (m) => {
        m.keys.intercept[0][modifier] = 'yes';
      },
    ]),
    [
      'settings must be an object',
      (m) => {
        m.settings = 320;
      },
    ],
    [
      'settings.view.width is not a JSON value',
      (m) => {
        m.settings.view.width = () => 1;
      },
    ],
    [
      'optionalSettings must be an object',
      (m) => {
        m.optionalSettings = 'string';
      },
    ],
    [
      'optionalSettings "filter" must be "string", "number" or "boolean"',
      (m) => {
        m.optionalSettings.filter = 'text';
      },
    ],
    [
      'settingInfo must be an object',
      (m) => {
        m.settingInfo = [];
      },
    ],
    [
      'settingInfo "filter" must have a label and a description',
      (m) => {
        delete m.settingInfo.filter.description;
      },
    ],
    [
      'settingInfo "filter" must have a label and a description',
      (m) => {
        m.settingInfo.filter = 'Filter';
      },
    ],
    [
      'settingInfo "filter" must have a label and a description',
      (m) => {
        m.settingInfo.filter.hint = 'x';
      },
    ],
    [
      'themeTokens must be an object',
      (m) => {
        m.themeTokens = 'accent';
      },
    ],
    [
      'theme token "accent" must be an object',
      (m) => {
        m.themeTokens.accent = '#3366ff';
      },
    ],
    [
      'theme token "accent" kind must be one of color, length, duration, number, shadow, filter, raw',
      (m) => {
        m.themeTokens.accent.kind = 'colour';
      },
    ],
    [
      'theme token "accent" default must be a string',
      (m) => {
        m.themeTokens.accent.default = 0;
      },
    ],
    [
      'theme token "accent" has unknown field "dark"',
      (m) => {
        m.themeTokens.accent.dark = '#000';
      },
    ],
    [
      'Plugin "notes-plus" declares no scope "other"',
      (m) => {
        m.keys.binds[0].scope = 'other';
      },
    ],
    [
      'setting "filter" defaults to null and declares no kind in optionalSettings',
      (m) => {
        delete m.optionalSettings.filter;
      },
    ],
    [
      'setting "view.width" declares a kind in optionalSettings but defaults to a value',
      (m) => {
        m.optionalSettings['view.width'] = 'number';
      },
    ],
    [
      'setting "view.width" has no declaration in settingInfo',
      (m) => {
        delete m.settingInfo['view.width'];
      },
    ],
    [
      'settingInfo declares "view", which is no leaf setting',
      (m) => {
        m.settingInfo.view = { label: 'View', description: 'The view.' };
      },
    ],
    [
      'theme token "Accent" must be lowercase letters and digits joined by - or _',
      (m) => {
        m.themeTokens.Accent = m.themeTokens.accent;
        delete m.themeTokens.accent;
      },
    ],
  ])('rejects a manifest with each fault, naming it: %s', (problem, fault) => {
    const manifest = validManifest();
    const raw = fault(manifest) ?? manifest;

    const check = validateManifest(raw);

    expect(check).toEqual({
      ok: false,
      problems: [expect.stringContaining(problem)],
    });
  });

  it.each<[string, Fault, string[]]>([
    [
      'two shape faults',
      (m) => {
        m.label = 1;
        m.description = 2;
      },
      ['label must be a string', 'description must be a string'],
    ],
    [
      'a shape fault and a pass-2 fault',
      (m) => {
        m.label = 1;
        delete m.optionalSettings.filter;
      },
      ['label must be a string'],
    ],
  ])(
    'reports every shape problem, and pass 2 only when the shape is right: %s',
    (_name, fault, problems) => {
      const manifest = validManifest();
      fault(manifest);

      expect(validateManifest(manifest)).toEqual({ ok: false, problems });
    },
  );
});

describe('handlerProblems', () => {
  const handler = () => {};

  it.each<[ProcessName, object, string[]]>([
    ['main', { sync: handler }, []],
    ['main', {}, ['missing sync']],
    ['main', { sync: handler, open: handler }, ['undeclared open']],
    ['page', { sync: handler }, ['missing open', 'undeclared sync']],
    ['main', { sync: 'text' }, ['missing sync']],
  ])(
    'lists missing then undeclared handlers of a process: %s %o',
    (process, commands, problems) => {
      const manifest = validManifest() as unknown as PluginManifest;

      expect(handlerProblems(manifest, process, commands)).toEqual(problems);
    },
  );
});
