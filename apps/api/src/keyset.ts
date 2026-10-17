import { sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { fail } from './problem.ts';

// Keyset cursor, shared by REST pages and GraphQL connections: the last row's created_at in UTC to the microsecond, and
// its id, as opaque base64url JSON.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cursorAt = (column: PgColumn) => sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type Keyed = { id: string; cursorAt: string };
const encode = (row: Keyed) => Buffer.from(JSON.stringify([row.cursorAt, row.id])).toString('base64url');

function decode(cursor: string): [string, string] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw fail(400, 'cursor is invalid');
  }
  const [at, last] = Array.isArray(decoded) ? decoded : [];
  if (typeof at !== 'string' || !AT.test(at) || typeof last !== 'string' || !UUID.test(last)) throw fail(400, 'cursor is invalid');
  return [at, last];
}

// Rows after the cursor in (created_at DESC, id DESC) order, the order of the keyset indexes.
export function after(createdAt: PgColumn, id: PgColumn, cursor: string | null | undefined) {
  if (cursor === undefined || cursor === null) return undefined;
  const [at, last] = decode(cursor);
  return sql`(${createdAt}, ${id}) < (${at}::timestamptz, ${last}::uuid)`;
}

// Rows before the cursor in that order, for a page going back: read ascending, then reversed.
export function before(createdAt: PgColumn, id: PgColumn, cursor: string | null | undefined) {
  if (cursor === undefined || cursor === null) return undefined;
  const [at, last] = decode(cursor);
  return sql`(${createdAt}, ${id}) > (${at}::timestamptz, ${last}::uuid)`;
}

// Fetch limit + 1 rows: the extra row only tells whether another page exists.
export function page<Row extends Keyed, Item>(rows: Row[], limit: number, toItem: (row: Row) => Item) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items: items.map(toItem), next_cursor: rows.length > limit && last ? encode(last) : null };
}

// The same page as a Relay connection. Without flags it goes forward only; the invoice list, which also pages back,
// passes its own.
export function connection<Row extends Keyed, Node>(
  rows: Row[],
  first: number,
  toNode: (row: Row) => Node,
  flags: { hasNextPage: boolean; hasPreviousPage: boolean } = { hasNextPage: rows.length > first, hasPreviousPage: false },
) {
  const edges = rows.slice(0, first).map((row) => ({ cursor: encode(row), node: toNode(row) }));
  return { edges, pageInfo: { ...flags, startCursor: edges[0]?.cursor ?? null, endCursor: edges.at(-1)?.cursor ?? null } };
}

// A connection's first or last argument: 1 to 100, as the REST limit.
export function pageSize(size: number | null | undefined, name = 'first') {
  const value = size ?? 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) throw fail(400, `${name} must be between 1 and 100`);
  return value;
}
