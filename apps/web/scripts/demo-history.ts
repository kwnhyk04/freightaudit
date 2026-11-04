// Writes lib/demo-history.json: generated invoices that fill the sample's overview over the four weeks to its newest day
// (2026-10-17), as the facts the overview counts. They are figures only, with no detail page or PDF; the eleven real
// sample invoices stay as exported. The seed is fixed, so a rerun writes the same file. Usage: node scripts/demo-history.ts
import { writeFileSync } from 'node:fs';

let seed = 20_261_017;
const random = () => ((seed = (seed * 16_807) % 2_147_483_647) - 1) / 2_147_483_646;
const between = (low: number, high: number) => Math.floor(low + random() * (high - low + 1));
const pick = <T>(weighted: [T, number][]) => {
  let roll = random() * weighted.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of weighted) if ((roll -= weight) < 0) return value;
  return weighted.at(-1)![0];
};

// The sample's fictional carriers; overbilling leans on two of them.
const CARRIERS: [string, number][] = [
  ['Halcyon Ridge Freight', 24],
  ['Nimbus Road Lines', 20],
  ['Copperline Haulage', 18],
  ['Bramblewood Express', 16],
  ['Quarry Lane Transport', 12],
  ['Tern & Tide Carriers', 10],
];
const OVERBILLS: Record<string, number> = { 'Halcyon Ridge Freight': 0.35, 'Tern & Tide Carriers': 0.4, 'Bramblewood Express': 0.25, 'Nimbus Road Lines': 0.12, 'Copperline Haulage': 0.1, 'Quarry Lane Transport': 0.08 };
const QUIET = new Set(['2026-10-04', '2026-10-11']);
const DAY = 86_400_000;
const first = Date.parse('2026-09-20T00:00:00Z');

type Finding = { status: 'open' | 'confirmed' | 'dismissed'; billedCents: number; expectedCents: number };
const finding = (status: Finding['status'], carrier: string): Finding => {
  const expectedCents = between(18_000, 240_000);
  const over = random() < OVERBILLS[carrier]! * 2 ? between(4_000, 95_000) : between(500, 6_000);
  return { status, billedCents: expectedCents + over, expectedCents };
};

const rows = [];
for (let d = 0; d < 28; d++) {
  const day = new Date(first + d * DAY).toISOString().slice(0, 10);
  // Uneven days of about 40 to 60, two quiet Sundays, and the newest day lighter, as its eleven arrive besides.
  const count = QUIET.has(day) ? between(3, 8) : d === 27 ? between(28, 34) : between(38, 62);
  for (let n = 0; n < count; n++) {
    const receivedAt = first + d * DAY + between(6 * 3_600, 19 * 3_600) * 1_000;
    const carrier = pick(CARRIERS);
    const settledAt = receivedAt + Math.round(1_500 * Math.exp(random() * 4.2));
    const outcome = pick<'matched' | 'findings' | 'review' | 'rejected' | 'failed'>([['matched', 47], ['findings', 36], ['review', 9], ['rejected', 5], ['failed', 3]]);
    const base = { receivedAt: new Date(receivedAt).toISOString(), carrier, shipment: true, corrected: false, settledAt: new Date(settledAt).toISOString(), findings: [] as Finding[] };
    if (outcome === 'matched') rows.push({ ...base, status: random() < 0.55 ? 'approved' : 'reconciled' });
    else if (outcome === 'findings') {
      const decided = pick<Finding['status']>([['open', 55], ['confirmed', 30], ['dismissed', 15]]);
      const findings = Array.from({ length: random() < 0.25 ? 2 : 1 }, () => finding(decided, carrier));
      rows.push({ ...base, status: decided === 'open' ? 'reconciled' : 'approved', findings });
    } else if (outcome === 'review') rows.push({ ...base, status: 'needs_review', shipment: false, carrier: random() < 0.5 ? null : carrier });
    else if (outcome === 'rejected') rows.push({ ...base, status: 'rejected', shipment: false });
    else rows.push({ ...base, status: 'failed', shipment: false, carrier: null });
  }
}
rows.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
writeFileSync(new URL('../lib/demo-history.json', import.meta.url), `${JSON.stringify(rows)}\n`);
console.log(`${rows.length} invoices`);
