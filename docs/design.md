# Design rules for the web app

How FreightAudit's screens are built, so a new screen looks like the rest. The approved mockups are in `docs/design/mockups/`; outside sources and their licences are in `docs/third-party.md`.

## Tokens and themes

- Every colour, radius and duration comes from the tokens at the top of `apps/web/app/globals.css`. No colour is typed in a rule.
- Light is the default set. Dark is the same token names with dark values, applied when the device prefers dark (unless the reviewer chose Light) or when the reviewer chose Dark. The two dark blocks must hold the same values; `apps/web/lib/theme.test.ts` fails when they differ.
- The theme switch (System, Light, Dark) sits at the sidebar's foot and in the phone drawer. The choice is kept in the `fa-theme` cookie, and the root layout sets `html[data-theme]` on the server, so a page never flashes the wrong theme. System is no cookie. The landing header shows it with icons only (`ThemeSwitch compact`), and below 721 px as one button that steps System, Light and Dark.
- The landing page's own class names start with what they hold (`.how-steps`, `.bento`, `.feature`, `.closing`); `.steps` is the app's pipeline progress line and adds an arrow after each item.

## Logo

- The mark (`LogoMark` in `apps/web/components/logo.tsx`) is a slanted F whose middle bar is the ledger line, with a check cut out of it. On a 48-unit grid every bar is 8 units thick with a 2.5 radius, and one `skewX(-12)` slants them all.
- The bars take the text colour and the ledger bar `--brand` (#2563eb, the same in both themes). The app's `--accent` cannot carry the mark: #2b4c7e is 2.14:1 on the dark canvas and the dark #8fb0e6 is 2.21:1 on white. #2563eb is 5.17:1 on white, 4.82:1 on the light canvas, 3.57:1 on the dark canvas and 3.31:1 on the dark surface (measured 2026-11-02), above 3:1 for a graphic.
- Below 24 px the check is left out, so it never smudges: the favicon (`app/icon.svg`, whose bars follow the browser's scheme) and any `LogoMark` under 24. From 24 px the check is a cut-out, so it shows whatever sits behind it.
- Files: `docs/brand/fa-logo-light.svg`, `fa-logo-dark.svg`, `fa-logo-mono.svg` (currentColor) and `fa-app-icon.svg`, the source of `app/apple-icon.png` (180 px, the mark on the dark canvas). Use the standalone files at 24 px and up. `proxy.ts` leaves `/icon.svg` and `/apple-icon.png` public.
- It stands in the sidebar's tile and the landing header, beside the name.

## Shared components

New tables, tabs, pagers and badges must use the shared components below, never a page-specific copy. Change the shared component, or add an option to it, when a page needs something it lacks.

| Need | Use | Where |
| --- | --- | --- |
| A table | `Table` with `Th` and `Td` | `apps/web/components/ui.tsx` |
| A table that becomes cards on a phone | `Table cards`, with each `Td`'s `card` role (`title`, `meta`, `amount`, `aside`, `wide`, `hide`, `select` for a row's box) and its `label` | same |
| A decision or replay on ticked rows | `BulkBar`, with each row's checkbox `form="bulk"` and named by its kind | `apps/web/components/client.tsx` |
| Filter tabs that live in the URL | `Tabs` | `apps/web/components/client.tsx` |
| Previous and next pages | `Pager` | `apps/web/components/ui.tsx` |
| An invoice's status | `StatusBadge` | same |
| Any other state pill | `Badge` with a `Tone` | same |
| An icon | `Icon` (Tabler paths, inline) | `apps/web/components/icons.tsx` |

- `Table`'s `look` is `list` (every table in the app) or `ledger` (the landing hero's eval strip; the landing's full results are a list table). `label` or `labelledBy` makes its wrapper a named region the keyboard can scroll.
- A card label is text in the page (`Td label`), shown only on a phone, so screen readers read it with its value; never CSS `content`.
- A table without `cards` keeps every column on a phone and scrolls sideways inside its wrapper, never the page.
- `apps/web/e2e/demo.spec.ts` fails when a page renders a table that is neither a list table nor a ledger.
- Column widths: give a list table `cols`, one entry per column, and it lays out fixed above 720 px, so spare width is spread instead of going to the longest text. A rem width keeps a short column fixed at its longest real value plus padding (measured 2026-11-02 at 14 px: a date 86 px, this year's moment 119 px and one with its year 159 px, "+$12,345.67" 84 px, a file name 89 px, "Reconciliation" 89 px, the Replay button 62 px), a percentage gives a text column a set share, and `''` splits what is left evenly. Only the long-text columns share the spare width: Carrier and Status on Invoices, Error on Dead letters, Evidence on Findings. A `cols` entry may be an object: `narrow` gives the column another width from 721 to 1439 px, and `wideOnly` (with its `Th` and `Td` classed `wide-only`) shows it only from 1440 px. On Invoices below 1440 px, Open findings hides (the status pill gives the count; the phone cards never showed it) and Carrier narrows to 12%, so the table fits at 1280 px with the sidebar open. A pill in a sized table may wrap rather than run past its column. `minWidth` keeps the shares from collapsing; below it the wrapper scrolls. Long text, two-word headers and dates wrap inside their column; amounts stay on one line. The root font is 14 px, so 1rem is 14 px. The invoice's charges table has no `cols`: it sits in a narrow column with little spare width, and its 1280 px fit (13 px type, 6 px padding) relies on the natural layout.
- Status colours (`statusTone` in `apps/web/lib/labels.ts`): billing issues soft red (`bad`), ready to approve soft green (`ok`), reading needs a check and a confirmed duplicate amber (`warn`), failed solid red (`fail`), approved, rejected, received and checking neutral (`busy` pulses while the pipeline works). The pill always names its status, so colour is never the only signal, and a coloured status tab's count carries the same colour. Every tone's text is at least 5.3:1 against its fill in both themes (measured 2026-11-02).
