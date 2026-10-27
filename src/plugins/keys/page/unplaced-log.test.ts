import { describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { Keymap, PageBind, ViewScope } from '../../../contracts/keymap';
import { startUnplacedLog } from './unplaced-log';

function keymap(page: PageBind[]): Keymap {
  return {
    editor: { leader: '<Space>', remaps: [], binds: [] },
    page,
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

const S_LINE = 'unplaced x a.trash in a.s';
const T_LINE = 'unplaced y a.copy in a.t';

// A log over a mutable keymap, scope and placed set; `setScope` sets the
// scope in force and tells the listener, as the core does.
function logSetup() {
  let map = keymap([
    { keys: ['x'], scope: 'a.s', command: 'a.trash' },
    { keys: ['y'], scope: 'a.t', command: 'a.copy' },
  ]);
  let scope: ViewScope = 'a.s';
  let listener: (scope: ViewScope) => void = () => undefined;
  const placed = new Set<CommandId>();
  const log = vi.fn();
  const unplaced = startUnplacedLog({
    keymap: () => map,
    scope: () => scope,
    placedIn: () => placed,
    onScopeChanged: (heard) => {
      listener = heard;
    },
    log,
  });
  return {
    unplaced,
    placed,
    log,
    setScope: (next: ViewScope) => {
      scope = next;
      listener(next);
    },
    setKeymap: (next: Keymap) => {
      map = next;
    },
  };
}

describe('startUnplacedLog', () => {
  it('scopeChange_LogsNothing', () => {
    const { log, setScope } = logSetup();

    setScope('a.t');
    setScope('a.s');

    expect(log).not.toHaveBeenCalled();
  });

  it('checkSeen_ChecksEveryScopeInForceOnce', () => {
    const { unplaced, log, setScope } = logSetup();

    setScope('a.t');
    unplaced.checkSeen();
    unplaced.checkSeen();

    expect(log.mock.calls).toEqual([
      ['keys', S_LINE],
      ['keys', T_LINE],
    ]);
  });

  it('checkSeen_UnseenScope_LeftOut', () => {
    const { unplaced, log } = logSetup();

    unplaced.checkSeen();

    expect(log.mock.calls).toEqual([['keys', S_LINE]]);
  });

  it('checkSeen_AnchorNamedAfterTheScopeLeft_LogsNothing', () => {
    const { unplaced, log, placed, setScope } = logSetup();

    setScope('a.t');
    placed.add('a.trash');
    unplaced.checkSeen();

    expect(log).not.toHaveBeenCalledWith('keys', S_LINE);
  });

  it('checkSeen_SameScopeTwice_RecordedOnce', () => {
    const { unplaced, log, setScope } = logSetup();

    setScope('a.t');
    setScope('a.s');
    setScope('a.t');
    unplaced.checkSeen();

    expect(log).toHaveBeenCalledTimes(2);
  });

  it('keymapChange_NewKeys_LogANewLine', () => {
    const { unplaced, log, setScope, setKeymap } = logSetup();
    setScope('a.t');
    unplaced.checkSeen();
    expect(log).toHaveBeenCalledWith('keys', S_LINE);

    setKeymap(
      keymap([
        { keys: ['z'], scope: 'a.s', command: 'a.trash' },
        { keys: ['y'], scope: 'a.t', command: 'a.copy' },
      ]),
    );
    unplaced.checkSeen();

    expect(log).toHaveBeenCalledWith('keys', 'unplaced z a.trash in a.s');
  });
});
