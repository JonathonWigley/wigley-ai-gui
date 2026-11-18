import vimSource from '@replit/codemirror-vim-core?raw';
import { describe, expect, it } from 'vitest';
import type { ExCall } from '../../contracts/editor';
import { exBindName } from './ex-command-name';
import {
  type ExDefinition,
  exCallOf,
  exDefinitionProblem,
} from './ex-definitions';

// Each name and short name in the installed engine's `defaultExCommandMap`,
// with the command it names.
function engineExCommandNames(): { typed: string; name: string }[] {
  const list = /var defaultExCommandMap = \[([\s\S]*?)\];/.exec(vimSource);
  if (list === null) {
    throw new Error('vim.js holds no defaultExCommandMap to read');
  }
  const entries = list[1].matchAll(
    /\{\s*name:\s*'(\w+)'(?:,\s*shortName:\s*'(\w+)')?/g,
  );
  return [...entries].flatMap(([, name, shortName]) =>
    shortName === undefined
      ? [{ typed: name, name }]
      : [
          { typed: name, name },
          { typed: shortName, name },
        ],
  );
}

describe('exCallOf', () => {
  it.each<{ argString: string | undefined; expected: ExCall }>([
    { argString: undefined, expected: { argString: '', bang: false } },
    { argString: '', expected: { argString: '', bang: false } },
    { argString: '!', expected: { argString: '', bang: true } },
    { argString: ' !', expected: { argString: '', bang: true } },
    { argString: ' foo ', expected: { argString: 'foo', bang: false } },
    { argString: '! foo', expected: { argString: 'foo', bang: true } },
    { argString: 'foo!', expected: { argString: 'foo!', bang: false } },
  ])(
    'exCallOf_ReadsBangAndArgument: "$argString" → $expected',
    ({ argString, expected }) => {
      expect(exCallOf(argString)).toEqual(expected);
    },
  );
});

describe('exDefinitionProblem', () => {
  const hello = new Map<string, ExDefinition>([['hello', { prefix: 'he' }]]);
  const none = new Map<string, ExDefinition>();

  it.each<{
    name: string;
    prefix: string;
    defined: ReadonlyMap<string, ExDefinition>;
    problem: string | null;
  }>([
    {
      name: 'say-hi',
      prefix: 'sa',
      defined: none,
      problem: 'ex command name "say-hi" must be letters only',
    },
    {
      name: exBindName(12),
      prefix: 'wig',
      defined: none,
      problem: `ex command name "${exBindName(12)}" is reserved for key binds`,
    },
    {
      name: 'hello',
      prefix: '',
      defined: none,
      problem: 'ex command prefix "" must be a non-empty start of "hello"',
    },
    {
      name: 'hello',
      prefix: 'hx',
      defined: none,
      problem: 'ex command prefix "hx" must be a non-empty start of "hello"',
    },
    {
      name: 'hello',
      prefix: 'hel',
      defined: hello,
      problem: 'ex command hello is already defined',
    },
    {
      name: 'helm',
      prefix: 'he',
      defined: hello,
      problem: 'ex command helm: prefix he is already defined by hello',
    },
    {
      name: 'colo',
      prefix: 'c',
      defined: none,
      problem: 'ex command name "colo" names vim\'s command colorscheme',
    },
    {
      name: 'sample',
      prefix: 's',
      defined: none,
      problem: 'ex command prefix "s" would shadow vim\'s command substitute',
    },
    {
      name: 'subway',
      prefix: 'sub',
      defined: none,
      problem: 'ex command prefix "sub" would shadow vim\'s command substitute',
    },
    { name: 'wonder', prefix: 'wo', defined: none, problem: null },
    { name: 'mything', prefix: 'm', defined: none, problem: null },
    { name: 'help', prefix: 'hel', defined: hello, problem: null },
    { name: 'hello', prefix: 'he', defined: none, problem: null },
  ])(
    'exDefinitionProblem_NamesTheFirstProblem: $name, $prefix → $problem',
    ({ name, prefix, defined, problem }) => {
      expect(exDefinitionProblem(name, prefix, defined)).toBe(problem);
    },
  );

  it.each(engineExCommandNames())(
    "rejects $typed, which names the installed engine's $name",
    ({ typed, name }) => {
      expect(exDefinitionProblem(typed, typed, none)).toBe(
        `ex command name "${typed}" names vim's command ${name}`,
      );
    },
  );
});
