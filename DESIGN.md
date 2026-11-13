---
name: Beanbag
description: A crisp, understated household ledger in white, ink, and restrained blue.
colors:
  paper: "#ffffff"
  rail: "#f3f5fa"
  field: "#f6f7fa"
  ink: "#202735"
  secondary: "#505c70"
  muted: "#667085"
  line: "#e2e6ef"
  accent: "#3556c8"
  accent-hover: "#2645ad"
  accent-soft: "#e9eefc"
  cash: "#4263d5"
  stock: "#a9b6ec"
  stock-ink: "#535c91"
  outflow: "#8792a8"
  warning: "#845614"
  warning-paper: "#fff8eb"
  warning-line: "#eddfc4"
  error: "#a43135"
  error-paper: "#fff0f0"
typography:
  display:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "3.14rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "1.14rem"
    fontWeight: 600
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "0.86rem"
    fontWeight: 500
  amount:
    fontFamily: '"DM Sans", sans-serif'
    fontSize: "0.93rem"
    fontWeight: 500
rounded:
  marker: "2px"
  bar: "3px"
  compact: "5px"
  control: "6px"
  group: "8px"
  surface: "12px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "28": "28px"
  "32": "32px"
  "40": "40px"
  "64": "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.field}"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    padding: "0"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  navigation-item:
    textColor: "{colors.secondary}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  status:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-hover}"
    rounded: "{rounded.compact}"
    padding: "5px 7px"
  status-review:
    backgroundColor: "{colors.warning-paper}"
    textColor: "{colors.warning}"
  health-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
  period-preset:
    textColor: "{colors.secondary}"
    rounded: "{rounded.compact}"
    padding: "7px 13px"
  period-preset-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  chart-month:
    rounded: "{rounded.compact}"
    padding: "0 4px"
  chart-month-selected:
    backgroundColor: "{colors.field}"
---

# Design System: Beanbag

## Overview

**Creative North Star: "Crisp and understated — white, ink, restrained blue"**

White work surfaces and a cool navigation rail keep attention on amounts, dates,
and record decisions. Ink typography, fine rules, and measured spacing establish
hierarchy without surrounding every section with a card.

Cash, in-kind receipts, and checking spending remain visibly distinct. Unresolved
states receive explicit labels and amber treatment; color supports the wording.
This system is extracted from `src/ui/style.css` and `src/ui/main.tsx` after the
November 12, 2026 finish review. The frontmatter records implemented values.

**Key Characteristics:**

- White workspace, cool pale rail, and restrained blue actions.
- One self-hosted sans family with aligned financial figures.
- Open ruled groups, compact controls, and explicit state labels.
- Responsive records that preserve meaning and readable metadata.

## Colors

The palette pairs cool neutrals with blue cash data, lavender in-kind data, and
slate outflows. Frontmatter keys retain the CSS custom-property names.

### Primary

- **Restrained blue** (`accent`): primary actions, income emphasis, links, and focus outlines; `accent-hover` deepens interaction and `accent-soft` marks selection or supporting information.
- **Cash blue** (`cash`): checking-income series and markers.
- **Stock lavender** (`stock`, `stock-ink`): in-kind series and its legible text counterpart.
- **Outflow slate** (`outflow`): spending bars and category tracks.

### Neutral

- **Paper white** (`paper`): workspace, fields, buttons, and dialog surfaces.
- **Cool rail** (`rail`) and **inset field** (`field`): navigation, grouped controls, table headings, and selected chart columns.
- **Ink** (`ink`), **secondary ink** (`secondary`), and **muted ink** (`muted`): descending text emphasis.
- **Fine rule** (`line`): dividers and control outlines.

### Semantic states

- **Amber** (`warning`, `warning-paper`, `warning-line`): unresolved records and review notices.
- **Error red** (`error`, `error-paper`): failed actions and validation feedback.

**The Meaning Before Color Rule.** Pair every financial series and decision color
with a label; retain the cash versus in-kind distinction in nearby text.

The sidecar's eight-step tonal ramps are synthesized previews. They are not CSS
tokens or approved replacements for the implemented colors.

## Typography

**Display and Body Font:** DM Sans, with sans-serif fallback; self-hosted weights
(400, 500, 600, 700). The root size is (14px). There is no separate display or
monospace brand family.

### Hierarchy

- **Display:** the main income amount uses `display`; medium weight and tight tracking give it prominence. The spending amount is smaller.
- **Headline:** page titles use `headline`; panel titles use `title`.
- **Body:** the root and paragraph role use `body`; compact descriptions commonly use (0.93rem).
- **Label:** actions use `label`; field labels use (0.93rem) and medium weight.
- **Amount:** ledger values use `amount`. Strong values, amounts, dates, and detail values use tabular numerals where defined in the source.

**The Readable Metadata Rule.** At widths up to (700px), financial chart labels,
decision badges, account lines, and amount explanations use at least (0.86rem),
approximately (12px). Reflow the content instead of shrinking these labels.

## Layout

The desktop shell has a fixed navigation rail (208px) and a white main area with
a maximum width of (1480px), inset by (40px). Groups use fine rules and whitespace;
the recurring spacing rhythm is (8–12px) within controls, (16–24px) within groups,
and (28–32px) between sections.

- At (1700px) and above, main horizontal padding becomes (64px).
- At (1200px) and below, the rail becomes (188px), main padding becomes (28px), and two-column gaps tighten to (24px). Data-health sections stack.
- At (960px) and below, the rail becomes a top header with horizontal navigation; main padding is (24px).
- At (700px) and below, main padding is (20px), summary and chart groups stack, forms become one column, and ledger rows become a two-column record layout. The filter occupies the full row so the selected label remains visible.
- At (374px) and below, page padding becomes (16px); period presets use five equal columns and may wrap their labels.

Dialogs stay within the viewport: width is `min(660px, calc(100vw - 32px))` and
maximum height is (90dvh). Content scrolls within this bounded surface.

## Elevation & Depth

The workspace is flat. Pale fills, fine rules, and spacing separate levels of
information. The only shadow belongs to the modal dialog; the sidecar records
its exact CSS value and the translucent backdrop.

**The Dialog Depth Rule.** Keep ordinary panels and controls flat; use the existing
dialog shadow only for modal review and entry surfaces.

## Shapes

Controls use the `control` radius, larger contained surfaces use `surface`, and
notice groups use `group`. Compact badges and chart selections use `compact`.
Chart bars round only their upper corners with `bar`; legend squares use `marker`.
Thin borders provide edges without heavy outlines. Icons are small stroke SVGs.

## Components

### Buttons

Primary buttons use blue with white text; standard buttons use white with a fine
border. Both have a minimum height of (40px), compact label type, and an (8px)
icon gap. Text buttons use blue text with an underline on hover. Icon buttons
have a minimum target of (40px) and gain a pale blue hover fill.

All interactive controls use a blue focus outline (2px) with an offset (3px).
Buttons transition background, text, and border color over (160ms ease-out).
Disabled buttons reduce opacity to (0.5). Reduced-motion preference removes
transitions and animation. Preserve these states in new controls.

### Inputs / Fields

White fields have a fine border, the control radius, and a minimum height of
(42px). Labels sit above fields with an (8px) gap. Placeholder text uses muted
ink and the caret uses blue. Textareas can resize vertically. Mobile filter
labels retain their full width; validation feedback uses the error palette.

### Navigation

Desktop navigation uses muted text, stroke icons, and rounded rows with a
minimum height of (44px). Selection uses a pale blue fill and stronger blue
text. Below the rail breakpoint, selection becomes a blue bottom rule. At
mobile widths the rows reach (48px) and hide icons while retaining labels.

### Chips

Decision badges combine compact corners, a pale fill, and explicit text.
Review is amber, in-kind is lavender, and pending or excluded activity is
neutral. Badges communicate state; they are not interactive filters.

### Cards / Containers

Most analytical panels are open groups. Data health uses a bordered white
container with the surface radius and (24px) section padding, reduced to
(20px 16px) on mobile. Dialogs share the same surface radius and use separated
heading, body, and action regions. Review notices use amber fill and border.

### Period selection and monthly chart

Period presets sit inside a pale field with the group radius. A selected preset
is white, outlined, and semibold. Chart months are buttons: cash and in-kind
stack together beside a spending bar, and the selected month gains a pale
column and blue label. Hover and focus use the soft accent. Every month has an
accessible text description and opens its records.

### Ledger

Desktop rows align dates, descriptions, decision badges, and right-aligned
amounts. A light row hover and underlined record link indicate drilldown.
Mobile rows preserve date and account first, then description and amount,
followed by decision and record action; supporting financial text stays legible.

## Do's and Don'ts

### Do:

- **Do** use the implemented color roles and pair financial colors with explicit labels.
- **Do** align amounts with tabular numerals and preserve cash, in-kind, and excluded-state wording.
- **Do** reflow records and filters on mobile while keeping financial metadata at least approximately 12px.
- **Do** retain visible keyboard focus, accessible control names, and reduced-motion behavior.
- **Do** use invented, clearly illustrative content in public design previews.

### Don't:

- **Don't** give ordinary analytical panels the dialog shadow or wrap every metric in a raised card.
- **Don't** use color alone to imply a record's status or reporting inclusion.
- **Don't** truncate the selected mobile filter label to preserve a compact header.
- **Don't** treat synthesized sidecar tonal ramps as implemented application tokens.
