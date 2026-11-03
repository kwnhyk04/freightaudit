import { pageAfterResize, pageCount, pageItems, pageParams } from './paging.ts';

test('page and size come from the address, else page 1 at 20 a page', () => {
  expect(pageParams({})).toEqual({ page: 1, size: 20, offset: 0 });
  expect(pageParams({ page: '3', size: '50' })).toEqual({ page: 3, size: 50, offset: 100 });
  for (const page of ['0', '-2', '1.5', 'x', '01', '99999999']) expect(pageParams({ page }).page).toBe(1);
  for (const size of ['25', '0', '1000', 'ten']) expect(pageParams({ size }).size).toBe(20);
});

test('the page count is at least one', () => {
  expect([0, 1, 20, 21, 120].map((total) => pageCount(total, 20))).toEqual([1, 1, 1, 2, 6]);
});

test('the buttons show the first, the last, the current page and its neighbours, a gap for two or more left out', () => {
  expect(pageItems(1, 1)).toEqual([1]);
  expect(pageItems(1, 3)).toEqual([1, 2, 3]);
  expect(pageItems(1, 6)).toEqual([1, 2, 'gap', 6]);
  expect(pageItems(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(pageItems(4, 8)).toEqual([1, 2, 3, 4, 5, 'gap', 8]);
  expect(pageItems(5, 8)).toEqual([1, 'gap', 4, 5, 6, 7, 8]);
  expect(pageItems(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
  expect(pageItems(12, 12)).toEqual([1, 'gap', 11, 12]);
});

test('a new size keeps the first row of the page on screen', () => {
  // Rows 41 to 60 at 20 a page: row 41 is on page 5 at 10, page 1 at 50, page 9 at 5.
  expect(pageAfterResize(3, 20, 10)).toBe(5);
  expect(pageAfterResize(3, 20, 50)).toBe(1);
  expect(pageAfterResize(3, 20, 100)).toBe(1);
  expect(pageAfterResize(4, 20, 50)).toBe(2);
  expect(pageAfterResize(1, 20, 10)).toBe(1);
});
