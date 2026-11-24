import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type BackendKind,
  type BuildsMainExports,
  buildsMainKey,
} from '../../builds/contract';
import { buildsLocalMainPart } from './start';

describe('buildsLocalMainPart', () => {
  it('adds the local backend kind to builds', () => {
    const added: BackendKind[] = [];
    const builds = fakeDependency(
      buildsMainKey,
      (consumer): BuildsMainExports => ({
        addBackend: (kind) => {
          added.push(kind);
          return consumer.track({ dispose: () => undefined });
        },
      }),
    );

    startMainPart(buildsLocalMainPart, { dependencies: [builds] });

    expect(added.map(({ kind }) => kind)).toEqual(['local']);
  });
});
