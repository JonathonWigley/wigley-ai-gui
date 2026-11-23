import { describe, expect, it } from 'vitest';
import type { DocsBinding } from '../contract';
import { contributionsFileText } from './contributions-file';

const USER_BINDING: DocsBinding = {
  globalFolders: [
    {
      path: '~/wigley-agents',
      referenceFiles: ['decisions.md'],
      subfolders: ['learning', 'wiki'],
      skip: ['archive'],
    },
  ],
  wikiMain: '~/wigley-agents/wiki/Main.md',
  linkPrefixes: { 'wigley:': 'wigley@wigley-ai-marketplace' },
  features: {
    homes: ['{repo}/docs/features', '~/wigley-features/{name}'],
    file: 'followups.md',
    areaFolder: 'followups',
  },
};

// The docs index reads this schema (`agent-plugin/scripts/docs-index/README.md`
// § Contributions file), so the text is pinned whole.
const USER_FILE = `{
  "version": 1,
  "globalFolders": [
    {
      "path": "~/wigley-agents",
      "referenceFiles": [
        "decisions.md"
      ],
      "subfolders": [
        "learning",
        "wiki"
      ],
      "skip": [
        "archive"
      ]
    }
  ],
  "linkPrefixes": {
    "wigley:": "wigley@wigley-ai-marketplace"
  },
  "features": {
    "homes": [
      "{repo}/docs/features",
      "~/wigley-features/{name}"
    ],
    "file": "followups.md",
    "areaFolder": "followups"
  }
}
`;

describe('contributionsFileText', () => {
  it('contributionsFileText_UserBinding_PinnedSchemaWithoutWikiMain', () => {
    expect(contributionsFileText(USER_BINDING)).toBe(USER_FILE);
  });

  it('contributionsFileText_NoFeatures_FeaturesNull', () => {
    const text = contributionsFileText({ ...USER_BINDING, features: null });

    expect(JSON.parse(text)).toMatchObject({ version: 1, features: null });
  });
});
