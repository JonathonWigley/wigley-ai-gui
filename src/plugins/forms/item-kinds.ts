import type { BuiltInItemKind, ItemKindSpec } from './contract';

// The built-in kinds' wire keys, which saved rounds and retro read; main's and
// the page's built-in kinds each register their kind's spec.
export const BUILT_IN_KIND_SPECS: Readonly<
  Record<BuiltInItemKind, ItemKindSpec>
> = {
  notice: {
    id: 'notice',
    argsKey: 'notices',
    bodyKey: 'notice_comments',
    resultKey: 'notices',
    fingerprintJoinsWhenEmpty: true,
    answerable: false,
  },
  finding: {
    id: 'finding',
    argsKey: 'findings',
    bodyKey: 'finding_answers',
    resultKey: 'findings',
    fingerprintJoinsWhenEmpty: false,
    answerable: true,
  },
  question: {
    id: 'question',
    argsKey: 'questions',
    bodyKey: 'answers',
    resultKey: 'answers',
    fingerprintJoinsWhenEmpty: true,
    answerable: true,
  },
};

export function isBuiltInItemKind(kind: string): kind is BuiltInItemKind {
  return Object.hasOwn(BUILT_IN_KIND_SPECS, kind);
}
