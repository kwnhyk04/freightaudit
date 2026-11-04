# Third-party design sources

Work copied or adapted into this repo from outside it, with its licence. No package is installed for any of these.

| What | Where it is used | Source | Licence |
| --- | --- | --- | --- |
| Sidebar layout: two labelled groups, folding to an icon rail, user row at the foot | `apps/web/components/sidebar.tsx`, the shell rules in `apps/web/app/globals.css` | "sidebar" by Wensity Labs on 21st.dev, https://21st.dev/@wensity/components/sidebar (viewed 2026-11-01). Used as a visual reference only: none of its code, colours or packages were copied. | MIT, as listed on the component's page |
| List tables: rounded container, plain header, roomy rows that tint on hover | `.list-table` and `.table-wrap.list` in `apps/web/app/globals.css`, used by every table in the app through `Table` in `apps/web/components/ui.tsx` | "cnippet-table" (invoices example) by cnippet.dev on 21st.dev, https://21st.dev/@cnippet.dev/components/cnippet-table, published 2026-07-14; its source is ui.cnippet.dev/ui/data/table. Used as a visual reference only: none of its code, colours or packages were copied. | MIT License, as the 21st.dev page states it (read by the user on 2026-11-01) |
| Toolbar: filled search field. Its icon-only page buttons (`.page-button`, the old `Pager` in `ui.tsx`) were replaced on 2026-11-03 by the numeric pager below | `.search`, `.list-tools` in `apps/web/app/globals.css` | A screenshot the user supplied of a 21st.dev table (`_tmp/21st/freight-audit-table.png`); built from scratch | No code taken |
| Pager under every paged table: "Page 2 of 6" on the left; Previous, the page numbers with a gap mark and Next in the middle; a "20 / page" select on the right. 40 px ghost buttons 4 px apart with 6 px corners and 14 px medium type, the current page outlined, a 2 px ring 2 px out on keyboard focus, half opacity when disabled, a 40 px select with a faded chevron | `Pager` in `apps/web/components/client.tsx`; `.pager`, `.pager-status`, `.pager-list`, `.pager-button`, `.pager-gap`, `.pager-size` in `apps/web/app/globals.css`; the page rule in `apps/web/lib/paging.ts` | "Numeric pagination" (`pagination9.tsx`) on 21st.dev, pasted by the user as code on 2026-11-03 with no author or page URL, built on shadcn/ui's Pagination, Button and Select and Origin UI's `use-pagination` hook. Its sizes, spacing, layout and states were ported into FA's own CSS, with its colours mapped to FA's tokens (foreground `--text`, muted `--text-2`, accent `--neutral-tint`, input `--rule-strong`, background `--surface`, ring `--accent` over `--canvas`). Changed on purpose: real buttons instead of links, a native `<select>` instead of Radix Select, Tabler paths instead of lucide-react, and the user's page rule (first, last, the current page and its neighbours) instead of the hook's window of five, so none of the hook's code is used. No Tailwind, shadcn, Radix, class-variance-authority or lucide-react is installed. | MIT, as the user states it; shadcn/ui's notice below |
| Icon paths: layout-dashboard, file-invoice, list-check, alert-triangle, upload, layout-sidebar-left-collapse and -expand, menu-2, x, logout, login, database, chevron-left, chevron-right, chevron-down, dots, device-desktop, sun, moon, cloud-upload | `apps/web/components/icons.tsx` (`ICONS`) | Tabler Icons 3.31.0, https://github.com/tabler/tabler-icons | MIT, Copyright (c) 2020-2024 Paweł Kuna |
| Sample invoices as a bento grid: each sample a card, a small drawing on top and its title and line below, the whole card one button that tints, and lifts its drawing, under a pointer | `SampleButton` and `SamplePicture` in `apps/web/components/client.tsx`, the grid in `apps/web/app/(app)/upload/page.tsx`; `.sample-grid`, `.sample-card` and `.sample-picture` in `apps/web/app/globals.css`; since 2026-11-03 also the invoice page's cards, which share `.sample-card`'s shell (`.bento-card` and `.review-cards` in `apps/web/app/globals.css`, `InvoiceDetail` and `Summary` in `apps/web/components/detail.tsx`), without drawings | "Bento Grid" by Manu Arora (Aceternity UI), as named by the user, who pasted its code on 2026-11-03. The pasted `BentoGrid` and `BentoCard` (`name`, `Icon`, `cta`, Radix icons) read like Magic UI's Bento Grid (Dillion Verma), also MIT; not confirmed which. Its structure (a grid of cards, the background on top, the text below, a hover tint and lift) was adapted to FA's CSS and tokens. No Tailwind, no packages (Radix, class-variance-authority, framer-motion) and none of its copy, and the drawings are FA's own. | MIT, as the user states it; notice below |
| Upload card: a heading with a round icon, a dashed dropzone with a cloud icon and a button, the files below a rule with a remove button | `UploadArea` in `apps/web/components/upload.tsx`; `.upload-card`, `.drop`, `.pick` in `apps/web/app/globals.css` | "file-upload-card" on 21st.dev, pasted by the user as a prompt on 2026-11-01 (the prompt gives no author or page URL). Checked on 2026-11-01: none of its code, colours, packages (lucide-react, framer-motion, Radix, class-variance-authority) or behaviour (close button, progress bars, upload on pick) is in our files. | Licence not stated; used as a visual reference only, no code copied |
| Landing header and hero: a sticky header (mark and name, links, theme toggle, sign-in, main button, a menu on phones), a pill above the headline, one figure under the buttons, a dashboard card on a tilted card behind it, two faint circles and a 40 px grid behind the hero | `Header` and `Hero` in `apps/web/components/landing.tsx`, `LandingMenu` and `ThemeSwitch compact` in `apps/web/components/client.tsx`; `.landing-top`, `.landing-menu`, `.hero`, `.hero-pill`, `.invoice-card` and `.invoice-stack` in `apps/web/app/globals.css` | "Event Dashboard Hero" (`hero4`) by anelkabag (BagUI) on 21st.dev, https://21st.dev/@anelkabag/components/hero4, pasted by the user as a prompt on 2026-11-02; the page's licence field read on 2026-11-02. Built in FA's own CSS, tokens and components: none of its code, Tailwind classes, colours, packages (motion, lucide-react), copy, logos or images is in our files. | "no-license", as the component's page states it; used as a visual reference only, no code copied |
| Features bento: seven cards on a six-column grid (one wide and one narrow, then three, then two), each a small working picture on top and a title with one line below; the visuals are a trace waterfall, a replay scrubber, an alert stack, a cost bar chart, a code window, keys and a masked log line | `Features` and `Feature` in `apps/web/components/landing.tsx`; `.bento-head`, `.bento`, `.feature`, `.waterfall`, `.scrubber`, `.alert-stack`, `.cost-chart`, `.code-window`, `.keys`, `.log-panel` in `apps/web/app/globals.css` | `marketing-feature-bento` ("Everything between the prompt and the answer.") on 21st.dev, pasted by the user as code on 2026-11-02 (round 3), with no author or page URL. Its page could not be found: a web search and four 21st.dev URLs tried on 2026-11-02 (`/s/...`, `/@beste/...`, `/community/...`) found nothing or returned 404, so its licence could not be read. The screenshot named for it, `_tmp/21st/bento-8.png`, was not on disk. Built from scratch in FA's CSS, tokens and components: none of its code, Tailwind classes, `--bjork-*` colours, packages (framer-motion) or copy is in our files. | Unknown, treated as no licence; used as a visual reference only, no code copied |
| How it works: three numbered steps joined by a line, each card an icon, a title, a line and a few points | `HowItWorks` in `apps/web/components/landing.tsx`; `.how-steps` in `apps/web/app/globals.css` | A 21st.dev "HowItWorks" component pasted in the round-2 prompt (2026-11-02), with no author or URL; a web search on 2026-11-02 did not find its page. The screenshot named for it, `_tmp/21st/steps-5.png`, was not on disk. None of its code, Tailwind classes, packages (lucide-react) or copy is in our files. | Unknown; used as a visual reference only, no code copied |
| Closing section: one large centred line, a short note and a button, over a phrase scrolling large and faint behind it (a two-half marquee, still with reduced motion). Since fa-final (2026-11-02) the band sits behind the hero instead, centred in it since the repo cleanup, and the closing is the line, the note and the button on a plain band | `Marquee` in `Hero` and `Closing` in `apps/web/components/landing.tsx`; `.hero .marquee`, `.marquee-track` and `.closing` in `apps/web/app/globals.css` | `cta69` ("Let's make something worth keeping.") on 21st.dev, pasted by the user as code on 2026-11-02 (round 3), with no author or page URL; its demo links beste.co. Its page could not be found (same searches as the bento, 2026-11-02), so its licence could not be read. Built from scratch: none of its code, Tailwind classes, packages, badge, footnote or copy is in our files; FA's own words stay. Round 2's version was built from the user's description of `_tmp/21st/h3-closing.png`, which was not on disk. | Unknown, treated as no licence; used as a visual reference only, no code copied |
| Overview as a bento grid: four columns from 1024 px with a two-wide hero (the headline figure, its change and weekly columns under it), a two-wide, two-tall line chart with a dashed comparison line, the latest week's figures keyed to the lines and a crosshair on hover, small stat cards, a semicircle gauge, a breakdown and a recent-activity list (an icon tile, a title over its detail and time, an amount over its status); a tile's quiet heading; the curve's control points halfway across, level with their ends | `Overview` in `apps/web/components/overview.tsx`, `weekPoints` and `curve` in `apps/web/lib/overview.ts`, the skeleton in `apps/web/app/(app)/dashboard/loading.tsx`; `.overview`, `.tile`, `.figure`, `.gauge`, `.week-columns`, `.tip`, `.line-figures`, `.line-chart`, `.dot`, `.zones`, `.latest` in `apps/web/app/globals.css` | "Web3Bento" (`web3-bento.tsx`) by Vasnev.art (@romanvasnev) on 21st.dev, https://21st.dev/@romanvasnev/components/web3-bento, pasted by the user as code on 2026-11-04; the page's licence field ("mit") read on 2026-11-04. Its layout, card anatomy (20 px corners, hairline, no shadow, monospace figures), daily bar strip, line chart with gradient fill, glowing end marker and dashed comparison, range pill, needle gauge, activity rows, `smooth()` curve (as `sampled`), count-up and entrance motion were ported into FA's own CSS and tokens, with FA's data in every card (`components/overview-motion.tsx` holds the client parts). Changed on purpose: FA's neutrals and one blue (`--chart`, two tones of it for the bars) instead of its lime, lilac and card gradients; bars proportional from 0 instead of an 18% floor; tooltips that also work by keyboard and touch and are read out; a range switch that morphs the charts; reduced motion respected throughout; the cards stack, gas price, staking, liquidity and block-stream tiles dropped. No Tailwind, shadcn or package is installed; none of its copy, data or demo names is in our files. | MIT, as its 21st.dev page states it; notice below |
| Logo mark: a slanted F whose middle bar is a ledger line with a check | `apps/web/components/logo.tsx`, `apps/web/app/icon.svg`, `apps/web/app/apple-icon.png` | The user's own concept sheet (2026-11-02), redrawn from scratch as SVG in FA's colours | The user's own work |

## Bento Grid notice

The sample invoices' bento grid adapts the structure of the Bento Grid component named above. Its licence:

```
MIT License

Copyright (c) Manu Arora

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Web3Bento notice

The overview's bento grid ports the Web3Bento component named above. Its 21st.dev page gives the licence as MIT and no copyright line, so the holder is named as the page names the author (read on 2026-11-04):

```
MIT License

Copyright (c) Vasnev.art (@romanvasnev on 21st.dev)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui notice

The pager ports the sizes and states of shadcn/ui's Pagination, Button and Select, through the 21st.dev "Numeric pagination" component named above. shadcn/ui's licence (the copyright line as its repository states it, not re-checked on 2026-11-03):

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
