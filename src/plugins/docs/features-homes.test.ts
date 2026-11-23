import { describe, expect, it } from 'vitest';
import {
  inRepoHomeParts,
  outOfRepoHomeFolders,
  templateProblem,
} from './features-homes';

describe('features-home templates', () => {
  it.each<{
    template: string;
    parts: string[] | null;
    folder: string | null;
  }>([
    {
      template: '{repo}/docs/features',
      parts: ['docs', 'features'],
      folder: null,
    },
    { template: '{repo}/./notes/', parts: ['notes'], folder: null },
    {
      template: '~/wigley-features/{name}',
      parts: null,
      folder: '~/wigley-features',
    },
    { template: '/srv/features/{name}', parts: null, folder: '/srv/features' },
    { template: 'docs/features', parts: null, folder: null },
    { template: '{repo}/../x', parts: null, folder: null },
    { template: '{repo}/', parts: null, folder: null },
    { template: '{repo}/{name}', parts: null, folder: null },
    { template: 'wigley-features/{name}', parts: null, folder: null },
    { template: '~/x/{name}/y', parts: null, folder: null },
    { template: '~/{name}', parts: null, folder: null },
  ])(
    'template $template reads as in-repo $parts, out-of-repo $folder',
    ({ template, parts, folder }) => {
      const isRefused = parts === null && folder === null;

      expect({
        parts: inRepoHomeParts([template]),
        folders: outOfRepoHomeFolders([template]),
        isRefused: templateProblem(template) !== null,
      }).toEqual({
        parts: parts === null ? [] : [parts],
        folders: folder === null ? [] : [folder],
        isRefused,
      });
    },
  );

  it('templateProblem_RefusedTemplate_NamesItAndBothShapes', () => {
    expect(templateProblem('docs/features')).toBe(
      '"docs/features" is neither {repo}/<folder> nor <folder>/{name}',
    );
  });

  it('homes_MixedList_EachShapeInOrder', () => {
    const homes = [
      '~/b/{name}',
      '{repo}/docs/features',
      'bad',
      '{repo}/notes',
      '/a/{name}',
    ];

    expect(inRepoHomeParts(homes)).toEqual([['docs', 'features'], ['notes']]);
    expect(outOfRepoHomeFolders(homes)).toEqual(['~/b', '/a']);
  });
});
