// The usage layout contract: the parts a usage layout draws for the status-bar plan line, each session's line, its
// context line, its spend, its side-bar row's line and cache mark and the right-bar details, and the kit each part
// gets. The app keeps the status-bar slot (always on, at the bar's end), the right-bar slot (there only while the
// details are open), each session's line slot (in its tab bar while the usage-tab-line plugin is on), its context line
// slot (above its Chat box), its spend slot (in its Chat status line), each session's row line slot and row cache slot
// (under its side-bar row), the open state, the shown session and every redraw: on each snapshot, each change of the
// shown session, each layouts set and once a minute.
//
// Every input is already worded for the screen: counts, percents, money and times arrive as text, and each meter's
// fill and tone beside its text. The one number that is no reading is `compactingElapsedMs`, for timing an animation.
import type { BaseKit, MeterTone } from '../../../shared/page/layout-host/kit';

export type UsageTone = MeterTone;
// `text` is what the meter reads (`42%`, `180k/300k` for a session's context, `180k` on its row line); `percent` is
// 0–100.
export interface MeterInput {
  label: string;
  text: string;
  percent: number;
  tone: UsageTone;
}
// One session's context line: its context meter and its cache countdown (`cache 42m`, `cache cold`), null cache while
// the session has reported none. `compacting` is the chip naming the trigger while the session compacts
// (`compacting · auto`, `compacting`, `compacting · autocompact`), null otherwise; `compactingElapsedMs` is how long it
// has compacted at this draw, null with it, so an animation a redraw builds again can start where the last one was.
export interface ContextLineInput {
  context: MeterInput;
  cache: string | null;
  compacting: string | null;
  compactingElapsedMs: number | null;
}
// One session's spend (`$1.23`), null while the session has reported none.
export interface SpendLineInput {
  spend: string | null;
}
// One session's whole line: its context line and its spend.
export interface SessionLineInput extends ContextLineInput, SpendLineInput {}
// One session's line under its side-bar row: its context meter, whose text is the used tokens alone (`180k`), the zero
// line (`0k`) while the session has no usage.
export interface RowLineInput {
  context: MeterInput;
}
// One session's cache mark on its side-bar row: `isCold` once the cache has expired, and `tooltip` worded for the
// screen (`cache warm · 2m left`, `cache cold`).
export interface RowCacheInput {
  isCold: boolean;
  tooltip: string;
}
// One plan as the status bar shows it. `note` (`plan loading`, `plan unavailable`, `no plan rows`, `no profiles`)
// stands in place of `plans` when set. `extraUsage` reads as in `DetailsProfileInput`. `stale` is true while the
// plan's last poll failed after a good one.
export interface StatusLinePlanInput {
  plans: readonly MeterInput[];
  extraUsage: string | null;
  note: string | null;
  stale: boolean;
}
// One profile's plan on the status bar.
export interface StatusLineProfileInput extends StatusLinePlanInput {
  name: string;
}
// The status-bar plan line: the shown plan, `profileName` its profile (null when there is no profile at all), and
// every profile's plan in `profiles`, in harness registration order then each harness's profile order.
export interface StatusLineInput extends StatusLinePlanInput {
  profileName: string | null;
  profiles: readonly StatusLineProfileInput[];
}
// One plan row; `resets` reads `resets in 2h 14m` or `resets now`, null with no reset time.
export interface DetailsRowInput extends MeterInput {
  resets: string | null;
}
// One profile's plan. `extraUsage` reads `$12.34 / $50.00`, `$12.34 / no limit` or `off`, null when the plan has
// none. `freshness` says how old the numbers are; `error` is the last poll's failure.
export interface DetailsProfileInput {
  name: string;
  isDefault: boolean;
  state: 'fresh' | 'stale' | 'error' | 'loading';
  rows: readonly DetailsRowInput[];
  extraUsage: string | null;
  freshness: string;
  error: string | null;
}
// The shown session's context against its autocompact limit, both limits (`limitsDiffer` when both are set and
// unequal), what is left before autocompact, its cache expiry and its spend.
export interface DetailsSessionInput {
  context: MeterInput;
  window: string;
  configuredLimit: string;
  reportedLimit: string;
  remaining: string;
  limitsDiffer: boolean;
  cache: string;
  spend: string;
}
// Every profile in plan order, and the shown session, null while no session with usage shows.
export interface DetailsInput {
  profiles: readonly DetailsProfileInput[];
  session: DetailsSessionInput | null;
}

// The kit every usage part gets.
export interface UsageKit extends BaseKit {}

// Each part comes from the first layout that defines it among the `usage.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// Every part appends one element to `parent` and returns it. `statusLine` draws the status-bar plan line,
// `sessionLine` one session's line into the tab bar slot its host gives it while usage-tab-line is on (a zero line,
// context `0k` and no cache or spend, while that session has no usage; while `compacting` is set, the default layout
// draws the chip first and pulses the meter), `contextLine` its context and cache above its Chat box (the same zero
// line, chip and pulse), `spendLine` its spend in its Chat status line (still one element while spend is null, which
// the default layout hides), `rowLine` one session's line under its side-bar row (its context `0k` while that
// session has no usage), `rowCache` one session's cache mark on that row (cold while that session has no usage; not drawn for a
// session the snapshot does not hold or usage with no cache expiry), and `details` the right-bar details.
export interface Layout {
  statusLine?(
    parent: HTMLElement,
    input: StatusLineInput,
    kit: UsageKit,
  ): HTMLElement;
  sessionLine?(
    parent: HTMLElement,
    input: SessionLineInput,
    kit: UsageKit,
  ): HTMLElement;
  contextLine?(
    parent: HTMLElement,
    input: ContextLineInput,
    kit: UsageKit,
  ): HTMLElement;
  spendLine?(
    parent: HTMLElement,
    input: SpendLineInput,
    kit: UsageKit,
  ): HTMLElement;
  rowLine?(
    parent: HTMLElement,
    input: RowLineInput,
    kit: UsageKit,
  ): HTMLElement;
  rowCache?(
    parent: HTMLElement,
    input: RowCacheInput,
    kit: UsageKit,
  ): HTMLElement;
  details?(
    parent: HTMLElement,
    input: DetailsInput,
    kit: UsageKit,
  ): HTMLElement;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
