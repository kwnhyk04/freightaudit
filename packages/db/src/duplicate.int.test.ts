import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { possibleDuplicate } from './duplicate.ts';
import { carriers, invoices, tenants } from './schema.ts';
import { createTestDatabase } from './testing.ts';

test('another invoice of the carrier under the number, not rejected, is a possible duplicate naming the earliest; without a carrier or a number there is none', async () => {
  const database = await createTestDatabase();
  const pool = new pg.Pool({ connectionString: database.url });
  try {
    const db = drizzle(pool);
    const [tenant] = await db.insert(tenants).values({ name: 'Test tenant' }).returning();
    const tenantId = tenant!.id;
    const [carrier, other] = await db.insert(carriers).values([{ tenantId, name: 'A' }, { tenantId, name: 'B' }]).returning();
    let files = 0;
    const invoice = async (filename: string, status: 'approved' | 'rejected' | 'needs_review', carrierId: string, at: string) => {
      const contentSha256 = String(++files).padStart(64, '0');
      const [row] = await db.insert(invoices).values({ tenantId, status, filename, contentSha256, carrierId, invoiceNumber: '98211354', createdAt: new Date(at) }).returning();
      return row!;
    };
    const self = await invoice('this.pdf', 'needs_review', carrier!.id, '2026-10-19T10:00:00Z');
    const lookup = (read: { carrierId?: string | null; invoiceNumber?: string | null } = {}) =>
      possibleDuplicate(db, { tenantId, invoiceId: self.id, carrierId: carrier!.id, invoiceNumber: '98211354', ...read });
    // The invoice itself, a rejected one and another carrier's are no duplicate.
    await invoice('bad-scan.pdf', 'rejected', carrier!.id, '2026-09-01T10:00:00Z');
    await invoice('another-carrier.pdf', 'approved', other!.id, '2026-09-02T10:00:00Z');
    expect(await lookup()).toBeUndefined();
    // 23:30 UTC is already the next day in Taipei; the finding gives the earliest one's UTC day.
    await invoice('second-scan.pdf', 'approved', carrier!.id, '2026-09-04T10:00:00Z');
    await invoice('first-scan.pdf', 'approved', carrier!.id, '2026-09-03T23:30:00Z');
    expect(await lookup()).toEqual({
      type: 'duplicate_invoice',
      expectedCents: 0n,
      billedCents: 0n,
      evidence: 'Possible duplicate: invoice 98211354 from this carrier was also received on 2026-09-03 as first-scan.pdf.',
    });
    // An invalid reading saves neither, and a reading may match no carrier.
    expect([await lookup({ carrierId: null }), await lookup({ invoiceNumber: null })]).toEqual([undefined, undefined]);
  } finally {
    await pool.end();
    await database.drop();
  }
});
