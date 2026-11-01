# Third-party design sources

Work copied or adapted into this repo from outside it, with its licence. No package is installed for any of these.

| What | Where it is used | Source | Licence |
| --- | --- | --- | --- |
| Sidebar layout: two labelled groups, folding to an icon rail, user row at the foot | `apps/web/components/sidebar.tsx`, the shell rules in `apps/web/app/globals.css` | "sidebar" by Wensity Labs on 21st.dev, https://21st.dev/@wensity/components/sidebar (viewed 2026-11-01). Used as a visual reference only: none of its code, colours or packages were copied. | MIT, as listed on the component's page |
| List tables: rounded container, plain header, roomy rows that tint on hover | `.list-table` and `.table-wrap.list` in `apps/web/app/globals.css`, used by the invoice list and the review queue | "cnippet-table" (invoices example) by cnippet.dev on 21st.dev, https://21st.dev/@cnippet.dev/components/cnippet-table, published 2026-07-14; its source is ui.cnippet.dev/ui/data/table. Used as a visual reference only: none of its code, colours or packages were copied. | MIT License, as the 21st.dev page states it (read by the user on 2026-11-01) |
| Toolbar and pager: filled search field, icon-only page buttons | `.search`, `.list-tools`, `.page-button` in `apps/web/app/globals.css`; `Pager` in `apps/web/components/ui.tsx` | A screenshot the user supplied of a 21st.dev table (`_tmp/21st/freight-audit-table.png`); built from scratch | No code taken |
| Icon paths: layout-dashboard, file-invoice, list-check, alert-triangle, upload, layout-sidebar-left-collapse and -expand, menu-2, x, logout, login, database, chevron-left, chevron-right, chevrons-left | `apps/web/components/icons.tsx` (`ICONS`) | Tabler Icons 3.31.0, https://github.com/tabler/tabler-icons | MIT, Copyright (c) 2020-2024 Paweł Kuna |
