# Design rules for the web app

How FreightAudit's screens are built, so a new screen looks like the rest. The approved mockups are in `docs/design/mockups/`; outside sources and their licences are in `docs/third-party.md`.

## Tokens and themes

- Every colour, radius and duration comes from the tokens at the top of `apps/web/app/globals.css`. No colour is typed in a rule.
- Light is the default set. Dark is the same token names with dark values, applied when the device prefers dark (unless the reviewer chose Light) or when the reviewer chose Dark. The two dark blocks must hold the same values; `apps/web/lib/theme.test.ts` fails when they differ.
- The theme switch (System, Light, Dark) sits at the sidebar's foot and in the phone drawer. The choice is kept in the `fa-theme` cookie, and the root layout sets `html[data-theme]` on the server, so a page never flashes the wrong theme. System is no cookie.

## Shared components

New tables, tabs, pagers and badges must use the shared components below, never a page-specific copy. Change the shared component, or add an option to it, when a page needs something it lacks.

| Need | Use | Where |
| --- | --- | --- |
| A table | `Table` with `Th` and `Td` | `apps/web/components/ui.tsx` |
| A table that becomes cards on a phone | `Table cards`, with each `Td`'s `card` role (`title`, `meta`, `amount`, `aside`, `wide`, `hide`) and its `label` | same |
| Filter tabs that live in the URL | `Tabs` | `apps/web/components/client.tsx` |
| Previous and next pages | `Pager` | `apps/web/components/ui.tsx` |
| An invoice's status | `StatusBadge` | same |
| Any other state pill | `Badge` with a `Tone` | same |
| An icon | `Icon` (Tabler paths, inline) | `apps/web/components/icons.tsx` |

- `Table`'s `look` is `list` (every table in the app) or `ledger` (the landing page's editorial tables). `label` or `labelledBy` makes its wrapper a named region the keyboard can scroll.
- A card label is text in the page (`Td label`), shown only on a phone, so screen readers read it with its value; never CSS `content`.
- A table without `cards` keeps every column on a phone and scrolls sideways inside its wrapper, never the page.
- `apps/web/e2e/demo.spec.ts` fails when a page renders a table that is neither a list table nor a ledger.
