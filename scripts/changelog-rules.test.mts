import { describe, expect, it } from 'vitest';
import {
  addedEntryLines,
  needsEntry,
  uncategorizedEntries,
  versionMismatch,
} from './changelog-rules.mts';

const INTRO = '# Changelog\n\nEach landing adds a version heading.\n';
const OLDER = '## 1.0.0 — 2026-11-01\n\n### Added\n\n- The first release.\n';

function changelog(unreleased: string, older = OLDER): string {
  return `${INTRO}\n## Unreleased\n\n${unreleased}\n${older}`;
}

const THIRTY_ENTRIES = Array.from(
  { length: 30 },
  (_, index) => `- Entry ${index}.`,
).join('\n');

describe('needsEntry', () => {
  // Catches a prefix match without the trailing slash (`docs-site/` read as
  // `docs/`) and a root-markdown rule that drops nested markdown.
  it.each([
    { path: 'src/main/app.ts', kept: true },
    { path: 'agent-plugin/scripts/relay/relay.py', kept: true },
    { path: 'scripts/check-boundary.mts', kept: true },
    { path: 'package.json', kept: true },
    { path: 'docs-site/x.ts', kept: true },
    { path: 'agent-plugin/skills/forms/SKILL.md', kept: true },
    { path: 'docs/features/x/design.md', kept: false },
    { path: '.claude/skills/drive/SKILL.md', kept: false },
    { path: '.agents/skills/x.md', kept: false },
    { path: 'README.md', kept: false },
    { path: 'CHANGELOG.md', kept: false },
  ])('needsEntry_KeepsAppCode: $path kept $kept', ({ path, kept }) => {
    expect(needsEntry([path])).toEqual(kept ? [path] : []);
  });
});

describe('addedEntryLines', () => {
  // Catches a check any changelog edit satisfies: an older section's line or a
  // reworded intro must not count.
  it.each([
    {
      name: 'AddedUnderUnreleased_Counts',
      base: changelog('### Added\n'),
      head: changelog('### Added\n\n- A new thing.\n'),
      added: ['- A new thing.'],
    },
    {
      name: 'AddedBelowThirtyEntries_Counts',
      base: changelog(`### Added\n\n${THIRTY_ENTRIES}\n`),
      head: changelog(`### Added\n\n${THIRTY_ENTRIES}\n- One more.\n`),
      added: ['- One more.'],
    },
    {
      name: 'AddedUnderOlderVersion_DoesNotCount',
      base: changelog('### Added\n'),
      head: changelog('### Added\n', `${OLDER}- A late line.\n`),
      added: [],
    },
    {
      name: 'AddedIntroSentence_DoesNotCount',
      base: changelog('### Added\n'),
      head: changelog('A sentence about this release.\n\n### Added\n'),
      added: [],
    },
    {
      name: 'MissingBase_CountsEveryEntry',
      base: '',
      head: `${INTRO}\n## Unreleased\n\n### Fixed\n\n- A fix.\n`,
      added: ['- A fix.'],
    },
    {
      name: 'ReleasedUnderNewHeading_Counts',
      base: changelog('### Added\n'),
      head: changelog(
        '',
        `## 1.1.0 — 2026-12-01\n\n### Added\n\n- A new thing.\n\n${OLDER}`,
      ),
      added: ['- A new thing.'],
    },
    {
      name: 'BaseEntriesReleased_DoNotCount',
      base: changelog('### Added\n\n- Written ahead.\n'),
      head: changelog(
        '',
        `## 1.1.0 — 2026-12-01\n\n### Added\n\n- Written ahead.\n\n${OLDER}`,
      ),
      added: [],
    },
  ])('addedEntryLines_$name', ({ base, head, added }) => {
    expect(addedEntryLines(base, head)).toEqual(added);
  });
});

describe('uncategorizedEntries', () => {
  // Catches an entry `changelog:release` never moves: one above the first
  // `###` under Unreleased. An older version's lines are not Unreleased's.
  it.each([
    {
      name: 'UnderHeading_None',
      text: changelog('### Added\n\n- A new thing.\n'),
      found: [],
    },
    {
      name: 'AboveFirstHeading_Found',
      text: changelog('- Loose.\n\n### Fixed\n\n- A fix.\n'),
      found: ['- Loose.'],
    },
    {
      name: 'NoHeadingAtAll_Found',
      text: changelog('- Loose.\n'),
      found: ['- Loose.'],
    },
    {
      name: 'OlderVersionWithoutHeading_None',
      text: changelog('', '## 1.0.0 — 2026-11-01\n\n- Old loose line.\n'),
      found: [],
    },
  ])('uncategorizedEntries_$name', ({ text, found }) => {
    expect(uncategorizedEntries(text)).toEqual(found);
  });
});

describe('versionMismatch', () => {
  // Catches a check that compares only two of the three files.
  it.each([
    {
      name: 'AllEqual_Null',
      versions: {
        'package.json': '1.1.0',
        'a.json': '1.1.0',
        'b.json': '1.1.0',
      },
      named: null,
    },
    {
      name: 'ThirdDiffers_NamesIt',
      versions: {
        'package.json': '1.1.0',
        'a.json': '1.1.0',
        'b.json': '1.0.0',
      },
      named: 'b.json 1.0.0',
    },
    {
      name: 'FirstDiffers_NamesIt',
      versions: {
        'package.json': '1.2.0',
        'a.json': '1.1.0',
        'b.json': '1.1.0',
      },
      named: 'package.json 1.2.0',
    },
  ])('versionMismatch_$name', ({ versions, named }) => {
    const reason = versionMismatch(versions);
    if (named === null) {
      expect(reason).toBeNull();
    } else {
      expect(reason).toContain(named);
    }
  });
});
