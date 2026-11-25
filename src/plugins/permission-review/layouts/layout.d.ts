// The permission-review layout contract: what a layout in `layouts/permission-review/<name>/layout.js` draws a
// request's review with. The app draws one `verdict` inside chat's permission entry and on forms' confirm card once a
// review of that request exists, and nothing before or after, which leaves the card as it was. The app sets
// `data-layout-owner="permission-review"` and `data-layout="<name>"` on the element the verdict returns, `<name>`
// being the layout that drew it, so `[data-layout-owner="permission-review"][data-layout="<name>"] …` in a layout's
// CSS selects only its own verdict.
//
// The app keeps:
// - the wrapper chat or forms hands the part, inside the card, which is theirs;
// - no keys and no focus: the verdict takes neither.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One request's review. `state` is `reviewing` while the reviewer runs, `done` once it replied and `unavailable` when
// there is no review (the ask failed or timed out). `heading` reads `Reviewing…`, `Approve · low risk` or
// `Review unavailable`; `detail` is the reviewer's summary when done, why there is none when unavailable, and null
// while reviewing. `verdict` and `risk` are null unless done.
export interface VerdictInput {
  state: 'reviewing' | 'done' | 'unavailable';
  heading: string;
  detail: string | null;
  verdict: 'approve' | 'deny' | null;
  risk: 'low' | 'medium' | 'high' | null;
}

// What a part returns: its root, appended to `parent`. `update`, when given, takes each later input of the same
// request in place of a redraw; without it, the part is drawn again.
export interface VerdictPart {
  element: HTMLElement;
  update?(input: VerdictInput): void;
}

// Each part comes from the first layout that defines it among the `permission-review.layout` setting and `default`; a
// part that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  verdict?(parent: HTMLElement, input: VerdictInput, kit: BaseKit): VerdictPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
