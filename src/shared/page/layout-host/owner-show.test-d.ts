// Type tests, checked under `vitest --typecheck`: the line after each
// `@ts-expect-error` must fail to compile.
import { describe, expectTypeOf, it } from 'vitest';
import type { PageLayoutShow } from '../../../contracts/plugin';
import type { BaseKit } from './kit';

interface Layout {
  view?(
    parent: HTMLElement,
    input: { text: string },
    kit: BaseKit,
  ): { element: HTMLElement };
  name: string;
}

declare const show: PageLayoutShow<Layout>;
declare const parent: HTMLElement;

describe('PageLayoutShow.draw', () => {
  // Breaks if the input is not read from the part, or if a part typed with
  // `BaseKit` no longer matches the shape.
  it('draw_ReadsInputAndBuiltFromThePart', () => {
    // The body only type-checks: `show` and `parent` are never made.
    const typeChecksOnly = () => {
      expectTypeOf(
        show.draw('view', parent, { text: 't' }).built,
      ).toEqualTypeOf<{
        element: HTMLElement;
      }>();

      // @ts-expect-error: the input is the part's `{ text: string }`.
      show.draw('view', parent, { text: 1 });

      // @ts-expect-error: `name` is a field, not a part.
      show.draw('name', parent, { text: 't' });
    };
    expectTypeOf(typeChecksOnly).toBeFunction();
  });
});
