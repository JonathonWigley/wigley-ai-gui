import { describe, expect, it } from 'vitest';
import { parseDriveArgs } from './drive-args.mts';

describe('parseDriveArgs', () => {
  it("GIVEN argv ['key', 'Space k', 's'] WHEN parsed THEN it is send key with keys [' ', 'k', 's']", () => {
    expect(parseDriveArgs(['key', 'Space k', 's'])).toEqual({
      kind: 'send',
      command: 'key',
      args: { keys: [' ', 'k', 's'] },
      run: null,
    });
  });

  it("GIVEN argv ['do', 'forms.openRound', '{\"harness\":\"codex\"}'] WHEN parsed THEN args is { name: 'forms.openRound', args: { harness: 'codex' } }", () => {
    const invocation = parseDriveArgs([
      'do',
      'forms.openRound',
      '{"harness":"codex"}',
    ]);
    expect(invocation).toEqual({
      run: null,
      kind: 'send',
      command: 'do',
      args: { name: 'forms.openRound', args: { harness: 'codex' } },
    });
  });

  it("GIVEN argv ['start', '--packaged', '--harness', 'claude', '--run', 'x'] WHEN parsed THEN it is start packaged with harness claude and run x", () => {
    const invocation = parseDriveArgs([
      'start',
      '--packaged',
      '--harness',
      'claude',
      '--run',
      'x',
    ]);
    expect(invocation).toEqual({
      kind: 'start',
      packaged: true,
      harness: 'claude',
      userConfig: false,
      run: 'x',
    });
  });

  it("GIVEN argv ['start', '--bogus'] WHEN parsed THEN it throws naming --bogus", () => {
    expect(() => parseDriveArgs(['start', '--bogus'])).toThrow('--bogus');
  });

  it("GIVEN argv ['setting', 'transparency', '\"reduced\"'] WHEN parsed THEN args is { name: 'transparency', value: 'reduced' }", () => {
    const invocation = parseDriveArgs(['setting', 'transparency', '"reduced"']);
    expect(invocation).toEqual({
      run: null,
      kind: 'send',
      command: 'setting',
      args: { name: 'transparency', value: 'reduced' },
    });
  });

  it("GIVEN argv ['setting', 'window', '{\"width\":900}'] WHEN parsed THEN args is { name: 'window', value: { width: 900 } }", () => {
    const invocation = parseDriveArgs(['setting', 'window', '{"width":900}']);
    expect(invocation).toEqual({
      run: null,
      kind: 'send',
      command: 'setting',
      args: { name: 'window', value: { width: 900 } },
    });
  });

  it("GIVEN argv ['eval', '{ document.title }'] WHEN parsed THEN args is { script: '{ document.title }' }", () => {
    const invocation = parseDriveArgs(['eval', '{ document.title }']);
    expect(invocation).toEqual({
      run: null,
      kind: 'send',
      command: 'eval',
      args: { script: '{ document.title }' },
    });
  });

  it("GIVEN argv ['drag', '.handle', '40', '0', '--hold'] WHEN parsed THEN args is { selector: '.handle', dx: 40, dy: 0, hold: true }", () => {
    const invocation = parseDriveArgs(['drag', '.handle', '40', '0', '--hold']);
    expect(invocation).toEqual({
      run: null,
      kind: 'send',
      command: 'drag',
      args: { selector: '.handle', dx: 40, dy: 0, hold: true },
    });
  });

  it("GIVEN argv ['start', '--harness', 'real'] WHEN parsed THEN it throws naming fake and claude", () => {
    const parse = () => parseDriveArgs(['start', '--harness', 'real']);
    expect(parse).toThrow(/fake/);
    expect(parse).toThrow(/claude/);
  });

  it("GIVEN argv ['query', '--run', 'x', '--', ':root', '--wg-accent'] WHEN parsed THEN --wg-accent is a style and the run is x", () => {
    const invocation = parseDriveArgs([
      'query',
      '--run',
      'x',
      '--',
      ':root',
      '--wg-accent',
    ]);
    expect(invocation).toEqual({
      run: 'x',
      kind: 'send',
      command: 'query',
      args: { selector: ':root', styles: ['--wg-accent'] },
    });
  });

  it.each([
    { argv: ['quit', '--run', 'x'], keepSessions: false },
    { argv: ['quit', '--keep-sessions', '--run', 'x'], keepSessions: true },
  ])(
    "GIVEN argv $argv WHEN parsed THEN it is the CLI's own quit of run x, keepSessions $keepSessions",
    ({ argv, keepSessions }) => {
      expect(parseDriveArgs(argv)).toEqual({
        kind: 'quit',
        keepSessions,
        run: 'x',
      });
    },
  );

  it("GIVEN argv ['restart', '--keep-sessions'] WHEN parsed THEN it throws naming the flag", () => {
    expect(() => parseDriveArgs(['restart', '--keep-sessions'])).toThrow(
      '--keep-sessions',
    );
  });

  it.each(['../x', '..', 'a/b', 'a\\b', '.', ''])(
    'GIVEN --run %j WHEN parsed THEN it throws naming --run, so the run folder stays inside .drive/',
    (run) => {
      expect(() => parseDriveArgs(['quit', '--run', run])).toThrow('--run');
    },
  );

  it("GIVEN --run '20261022-101500-ab12' WHEN parsed THEN the run is that id", () => {
    expect(parseDriveArgs(['quit', '--run', '20261022-101500-ab12'])).toEqual({
      kind: 'quit',
      keepSessions: false,
      run: '20261022-101500-ab12',
    });
  });

  it("GIVEN argv ['query', ':root', '--wg-accent'] WHEN parsed THEN it throws naming --wg-accent", () => {
    expect(() => parseDriveArgs(['query', ':root', '--wg-accent'])).toThrow(
      '--wg-accent',
    );
  });
});
