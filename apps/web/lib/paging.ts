// Page and page size for every paged table, read from ?page= and ?size=, which the Pager writes.
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_SIZE = 20;

// Anything that is not a page number or one of the sizes falls back to page 1 and the default size.
export function pageParams(params: { page?: string; size?: string }) {
  const size = PAGE_SIZES.find((each) => String(each) === params.size) ?? DEFAULT_SIZE;
  const page = /^[1-9]\d{0,6}$/.test(params.page ?? '') ? Number(params.page) : 1;
  return { page, size, offset: (page - 1) * size };
}

// A path with the given parameters, leaving out the empty ones.
export const query = (path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return search.size > 0 ? `${path}?${search}` : path;
};

export const pageCount =(total: number, size: number) => Math.max(1, Math.ceil(total / size));

// The page buttons: the first, the last, the current page and its neighbours, with a gap for every run left out. A gap
// of one page shows that page instead, so a gap always hides two or more.
export function pageItems(current: number, pages: number): (number | 'gap')[] {
  const shown = [...new Set([1, current - 1, current, current + 1, pages])].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  for (const page of shown) {
    const previous = items.at(-1);
    if (typeof previous === 'number' && page - previous === 2) items.push(previous + 1);
    else if (typeof previous === 'number' && page - previous > 2) items.push('gap');
    items.push(page);
  }
  return items;
}

// The page that holds the current page's first row once the size changes, so that row stays on screen.
export const pageAfterResize = (page: number, from: number, to: number) => Math.floor(((page - 1) * from) / to) + 1;
