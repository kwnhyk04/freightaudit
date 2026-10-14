import { loadEnv } from '@freightaudit/config/env';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { logJson, type Log } from '../src/log.ts';

// Expand/contract step between 0002 and 0003a (docs/migrations.md): gives every flat rate and invoice line a version.
// Resumable: it only touches rows that are still null, so a rerun continues where a crash stopped.

// Retries a statement that hit lock_timeout (SQLSTATE 55P03), backing off 1 s, 2 s, then 4 s.
async function retry<T>(run: () => Promise<T>, log: Log): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if ((err as { code?: string }).code !== '55P03' || attempt > 3) throw err;
      log('lock timeout, retrying', { attempt });
      await sleep(1_000 * 2 ** (attempt - 1));
    }
  }
}

export async function backfillRateCardVersions(client: pg.ClientBase, { batchSize = 2_000, log = logJson }: { batchSize?: number; log?: Log } = {}) {
  // Give way to application traffic: a statement waiting on a lock fails after 3 s and is retried.
  await client.query("SET lock_timeout = '3s'");

  // Version 1 per carrier from its flat rates, in force for all time; skipped where the carrier already has a version.
  const versions = await retry(
    () =>
      client.query(`
        INSERT INTO rate_card_versions (tenant_id, carrier_id, version, effective)
        SELECT DISTINCT tenant_id, carrier_id, 1, '(,)'::tstzrange FROM rate_cards WHERE carrier_id IS NOT NULL
        ON CONFLICT DO NOTHING`),
    log,
  );
  // Rate cards are small (carriers times charge codes), so one statement covers them.
  const rates = await retry(
    () =>
      client.query(`
        UPDATE rate_cards r SET rate_card_version_id = v.id
        FROM rate_card_versions v
        WHERE r.rate_card_version_id IS NULL AND v.carrier_id = r.carrier_id AND v.version = 1`),
    log,
  );
  log('rate cards linked', { versions: versions.rowCount, rates: rates.rowCount });

  const total = Number((await client.query('SELECT count(*) FROM invoice_lines WHERE rate_card_version_id IS NULL')).rows[0].count);
  let lines = 0;
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (let batch = 1; ; batch++) {
    // Keyset over the primary key: each batch is an index range scan, and rows with no matching version are passed, not retried forever.
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM invoice_lines WHERE id > $1 AND rate_card_version_id IS NULL ORDER BY id LIMIT $2',
      [cursor, batchSize],
    );
    if (rows.length === 0) break;
    cursor = rows.at(-1)!.id;
    // Each batch commits on its own, so row locks last only one short statement.
    // The version is the one in force on the ship date, or on the invoice date while the shipment is unmatched (UTC days).
    const { rowCount } = await retry(
      () =>
        client.query(
          `UPDATE invoice_lines l SET rate_card_version_id = v.id
           FROM invoices i
           LEFT JOIN shipments s ON s.id = i.shipment_id
           JOIN rate_card_versions v ON v.carrier_id = i.carrier_id
             AND v.effective @> (coalesce(s.shipped_on, i.invoice_date)::timestamp AT TIME ZONE 'UTC')
           WHERE l.id = ANY($1::uuid[]) AND l.rate_card_version_id IS NULL AND i.id = l.invoice_id`,
          [rows.map((row) => row.id)],
        ),
      log,
    );
    lines += rowCount ?? 0;
    log('batch done', { batch, updated: rowCount, lines, total });
  }

  const remaining = Number(
    (
      await client.query(`SELECT (SELECT count(*) FROM rate_cards WHERE rate_card_version_id IS NULL)
        + (SELECT count(*) FROM invoice_lines WHERE rate_card_version_id IS NULL) AS count`)
    ).rows[0].count,
  );
  const result = { versions: versions.rowCount ?? 0, rates: rates.rowCount ?? 0, lines, remaining };
  log('backfill finished', result);
  return result;
}

if (import.meta.main) {
  const { DATABASE_URL } = loadEnv(['DATABASE_URL']);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    // Rows left without a version would make 0003a fail: fix their carrier or dates, then rerun.
    if ((await backfillRateCardVersions(client)).remaining > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}
