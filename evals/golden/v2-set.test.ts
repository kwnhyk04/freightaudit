import { buildSeed } from '@freightaudit/db/scripts/seed';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import type { Manifest } from './build.ts';
import { type CaseV2, LIMITS, planV2, takenShipments } from './v2.ts';

// The committed v2 set against its plan: no hand edit, no stale PDF, nothing the api would refuse.
const root = new URL('v2/', import.meta.url);
const json = async <T>(path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8')) as T;

test('the committed v2 set is its plan, case for case, and every PDF matches its manifest and fits the api', async () => {
  const manifest = await json<Manifest>('manifest.json');
  expect(manifest).toMatchObject({ set: 'golden', version: 'v2', seed: 43, scale: 'small' });
  const plans = planV2(buildSeed('small'), await takenShipments());
  // The manifest's entries are the plan's cases without their invoices, plus each PDF's digest and size.
  expect(manifest.cases).toEqual(plans.map(({ case: planned }, i) => ({ ...planned, invoices: undefined, sha256: manifest.cases[i]?.sha256, bytes: manifest.cases[i]?.bytes })));
  for (const [i, entry] of manifest.cases.entries()) {
    const pdf = await readFile(new URL(entry.file, root));
    expect({ id: entry.id, sha256: createHash('sha256').update(pdf).digest('hex'), bytes: pdf.length }).toEqual({ id: entry.id, sha256: entry.sha256, bytes: entry.bytes });
    expect({ id: entry.id, fits: pdf.length <= LIMITS.bytes && entry.pages <= LIMITS.pages }).toEqual({ id: entry.id, fits: true });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(entry.pages);
    const golden = await json<CaseV2>(`cases/${entry.id}.json`);
    expect(golden).toEqual({ ...entry, invoices: plans[i]!.case.invoices });
    for (const invoice of golden.invoices) {
      // Each planted finding names a real line with its billed amount.
      for (const over of invoice.expected.overcharges) expect(invoice.line_items.some((line) => line.line_number === over.line_number && line.amount_cents === over.billed_cents)).toBe(true);
    }
  }
}, 120_000);
