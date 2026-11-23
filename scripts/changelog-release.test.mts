import { describe, expect, it } from 'vitest';
import { release } from './changelog-release.mts';

const INTRO = '# Changelog\n\nEach landing adds a version heading.\n';
const OLDER =
  '## 1.1.0 — 2026-11-01\n\n### Added\n\n- The first release.\n  Wrapped onto a second line.\n';
const TODAY = '2026-12-01';

function changelog(unreleased: string): string {
  return `${INTRO}\n## Unreleased\n\n${unreleased}\n${OLDER}`;
}

describe('release', () => {
  it.each([
    {
      name: 'FixedOnly_BumpsPatch',
      unreleased: '### Fixed\n\n- A fix.\n',
      released: '1.1.4',
    },
    {
      name: 'Added_BumpsMinorAndZeroesPatch',
      unreleased: '### Added\n\n- A thing.\n\n### Fixed\n\n- A fix.\n',
      released: '1.2.0',
    },
    {
      name: 'Changed_BumpsMinor',
      unreleased: '### Changed\n\n- A change.\n',
      released: '1.2.0',
    },
    {
      name: 'Removed_BumpsMinor',
      unreleased: '### Removed\n\n- A removal.\n',
      released: '1.2.0',
    },
  ])('release_$name', ({ unreleased, released }) => {
    expect(release(changelog(unreleased), '1.1.3', TODAY)?.version).toBe(
      released,
    );
  });

  it('release_FixedOnly_WritesHeadingWithItsEntries', () => {
    const result = release(
      changelog('### Added\n\n### Fixed\n\n- A fix.\n  Wrapped.\n'),
      '1.1.0',
      TODAY,
    );
    expect(result).toEqual({
      version: '1.1.1',
      changelog: `${INTRO}\n## Unreleased\n\n## 1.1.1 — ${TODAY}\n\n### Fixed\n\n- A fix.\n  Wrapped.\n\n${OLDER}`,
    });
  });

  it('release_EmptySubheadings_DroppedFromNewSection', () => {
    const result = release(
      changelog('### Added\n\n- A thing.\n\n### Changed\n\n### Removed\n'),
      '1.1.0',
      TODAY,
    );
    expect(result?.changelog).toContain(
      `## 1.2.0 — ${TODAY}\n\n### Added\n\n- A thing.\n\n## 1.1.0`,
    );
  });

  // Catches a release that rewrites history.
  it('release_OlderSections_KeptByteForByte', () => {
    const result = release(
      changelog('### Fixed\n\n- A fix.\n'),
      '1.1.0',
      TODAY,
    );
    expect(result?.changelog.endsWith(OLDER)).toBe(true);
  });

  it.each([
    { name: 'NoSubheadings', unreleased: '' },
    { name: 'EmptySubheadings', unreleased: '### Added\n\n### Fixed\n' },
  ])('release_ReturnsNull: $name', ({ unreleased }) => {
    expect(release(changelog(unreleased), '1.1.0', TODAY)).toBeNull();
  });

  it.each([
    { name: 'NoUnreleased', text: `${INTRO}\n${OLDER}`, version: '1.1.0' },
    {
      name: 'UnknownSubheading',
      text: changelog('### Security\n\n- A patch.\n'),
      version: '1.1.0',
    },
    {
      name: 'VersionNotSemver',
      text: changelog('### Fixed\n\n- A fix.\n'),
      version: '1.1',
    },
  ])('release_Throws: $name', ({ text, version }) => {
    expect(() => release(text, version, TODAY)).toThrow();
  });
});
