---
version: 1
slug: "src-ui-main-tsx"
primary_target: "src/ui/main.tsx"
related_targets: ["src/ui/style.css", "src/ui/account-value.tsx"]
---

# Household dashboard

Mode: Operate. Target: src/ui/main.tsx and src/ui/style.css.

The owner requested a replacement visual treatment using Impeccable. Product
truth is established by PRODUCT.md and repository instructions. The following
layout follows the owner's selected “Crisp and understated — white, ink,
restrained blue” direction. After viewing it, the owner said “design looks good
now.”

## Direction contract

THESIS: A clear monthly household review. Date, confirmed amounts, and unresolved
records have distinct places; the cream-and-sage presentation is replaced.

OWN-WORLD: The discipline of a household calendar: white work surface, cool pale
blue navigation, ink typography, blue cash and lavender in-kind series. One
self-hosted sans family, aligned figures, compact controls, open ruled groups.

STORY: Choose the period, distinguish cash from shares, inspect a total, resolve
uncertainty. Incoming stock and excluded internal movements remain explicit.

FIRST VIEWPORT: A 208px navigation rail beside a roomy work area. Period controls
sit above an open two-column income/spending summary and three secondary flows.
The review notice links to the queue. The monthly chart begins within the first
desktop viewport. Its selected month is marked like the current calendar column;
choosing that month opens its records. Mobile turns the rail into compact top
navigation and stacks the work areas without shrinking labels.

FORM: Grounded candidate 7, household calendar; seed:b88b9cbfa1f575dd. Familiar
product navigation and controls; the source contributes only palette, type,
density, and the marked reporting month. No decision page or image comp is needed
to make this reversible implementation reviewable under the session's autonomy
instructions. This is a code-led app surface, not a stored workflow preference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Working design brief

- Intent: an adult reviewing household finances at a desk in ordinary daylight,
  or checking a record on a phone; precise and readable.
- Hierarchy: reporting period, confirmed recorded income, cash/stock components,
  checking spending, net flows, review action, trend, recent activity.
- Palette: white, ink, cool blue paper, cash blue, stock lavender, outflow slate,
  amber reserved for unresolved states.
- Depth: borders and tonal regions, with shadow reserved for the dialog.
- Surfaces: a quiet rail, white workspace, lightly inset controls.
- Typography: DM Sans, tabular amounts, 13–14px body, 28px page heading,
  44px main amount; no serif, ornamental eyebrow, or tiny tracked labels.
- Spacing: 4px base; 8/12px within controls, 16/24px groups, 32px sections.
- Rejected defaults: oversized greeting, identical metric cards, redundant health
  panel on the overview. All prior operations remain available.

## Direction evaluation

Grounded candidates in resonance order: household annual report, transit
wayfinding, explanation-of-benefits statement, museum labels, architectural
drawing index, technical publication tables, household calendar.

The six catalog challengers lose household identification and task clarity to the
calendar direction. Their disciplines inform the proposal without importing their
motifs: Datamatics contributes precise numeric alignment; the cassette inlay
contributes visibly separate cash/in-kind groups; Saville's catalog contributes
one dominant focal point; airport signage contributes unambiguous selected state;
the convention catalog contributes denser readable records; the star atlas
contributes visibly distinct data series. All are declined as visual worlds.

## Validation

Read-only simplification: the owner asked to remove the task-oriented review
experience. Preserve the accepted palette/type/layout, reduce navigation to
Overview, Activity and Data health, and remove all financial/connection forms.
Unclassified records appear as an informational exclusion note beside income
totals and a filter in Activity. Record details retain evidence and history only.
The header labels the view read-only; Data health may reload saved data with GET.
This supersedes earlier workflow references to queues, decision previews and
receipt dialogs. No new visual system or design-document rewrite is required.

November 12 extension: the owner requested the latest tracked-account net worth
and a history chart. Preserve the accepted white/ink/blue system. An open ruled
balance section now precedes the period's income summary, with a current total,
two-account breakdown, snapshot timestamp, and a single blue line of saved daily
observations. A native range input selects exact snapshots; a details/table view
provides every value and freshness evidence. Mobile stacks the amount and account
breakdown at normal type sizes. Empty, missing, conflicting and stale data stay
visible. No market values enter receipt-income totals, and no new palette,
typeface, radius or navigation pattern is introduced. The offline private report
reuses this component without interactive controls and requires no server.

November 12 flow-rule follow-up: labels now cover cash/share flows in either
account. Use Cash income, Total expenses and separate cash versus in-kind net
measures. Transfers use their recorded institution price without per-event
origin approval. Incomplete entries distinguish missing prices from unknown
classification. Net worth subtracts each snapshot's reported borrowing natively.
Show a borrowing deduction when nonzero; no owner-confirmation labels or workflow.
Unknown borrowing shows account value before borrowing instead of an invented zero.
Keep the accepted visual system and the strictly read-only interaction model.

History backfill: support institution-dated daily exports and calculated checking
history without pretending historical dates were collection times. Preserve the
same chart, range control, spacing and palette. Use History & freshness and a
daily table with checking, brokerage net, combined value and source. An imported
already-net brokerage value needs no additional loan deduction or confirmation.
Display a later imported pair as of its provider date; keep missing dates as gaps.

Period picker refinement: replace the five presets with Last 1 month (default),
Last 3 months, Last 6 months, Year to date, Last year and Max. The owner confirmed
rolling 1/3/6-month defaults with calendar choices. Put one native period select
below the tab row: month, quarter, half-year or year, with an explicit date span.
Max covers every saved date. Preserve the current white/ink/blue controls; use
three columns over two rows on narrow screens, readable labels and keyboard tabs.
All totals and charts follow the range; latest account value stays independent.
This is an extension of the accepted system, with no design-token rewrite.

Transaction-history correction: long ranges must not present the original
90-day transaction slice as a full-period income/expense result. Show loaded
transaction dates beside the recorded totals, label partial periods clearly,
and replace totals/charts with an unavailable-history state when neither account
has data for the range. Keep balance history independent and preserve the
accepted controls, typography and palette. No ingestion control enters the UI.

Use only the loopback illustrative repository. Build before browser checks,
exercise all three views and read-only record details, inspect desktop/mobile
screenshots, and run the Impeccable detector once. Finish with a visual review of
the changed flows. No shipping raster assets are planned.

Account-value attribution extension: preserve the existing balance chart and add
an open ruled change breakdown below its date selector. Show total change,
income less expenses, and an explicitly estimated investment gain/loss. Match
the balances and flow dates, expose any shorter period and explain the residual
in a native details element. Missing history and unresolved flows show unavailable
amounts. Use the existing secondary amount treatment at 1.7rem, the current
palette and tabular figures; stack the groups on mobile without introducing
cards or new controls. The detector's advisory about this existing size is a
documentation-ramp gap, not a new visual direction. Preserve the accepted design
artifacts. Desktop/mobile checks cover the equation, a loss despite growing
account value, period changes, missing history and no write requests.

Time-weighted return is a fourth amount beside investment gain/loss. Reuse the
same typography and open ruled treatment; use two columns at intermediate widths
and stack on phones. Label it as a daily estimate for the period and explain
flow timing in the existing calculation details. Missing daily values or
undefined percentage bases leave TWR unavailable while preserving any supported
dollar attribution. Preserve the existing net-worth/account-value fallback guard.
