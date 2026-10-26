import { buildSeed } from '@freightaudit/db/scripts/seed';
import { type CasePlan, PROFILES, planV2, takenShipments } from './v2.ts';

const seeded = buildSeed('small');
let taken: Set<string>;
let plans: CasePlan[];
beforeAll(async () => {
  taken = await takenShipments();
  plans = planV2(seeded, taken);
});
const day = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

test('98 cases by kind, path and split as planned, with a ci subset of 20 from the test split', () => {
  const table: Record<string, [number, number, number]> = {};
  for (const { case: golden } of plans) {
    const row = (table[`${golden.kind}/${golden.path}`] ??= [0, 0, 0]);
    row[0] += 1;
    if (golden.split === 'dev') row[1] += 1;
    if (golden.ci) row[2] += 1;
  }
  // [cases, dev, ci] per kind and path, as in the approved plan.
  expect(table).toEqual({
    'clean/digital': [16, 4, 3],
    'clean/scanned': [16, 4, 2],
    'overcharge/digital': [12, 3, 3],
    'overcharge/scanned': [8, 2, 2],
    'duplicate_invoice/digital': [3, 1, 1],
    'duplicate_invoice/scanned': [2, 1, 0],
    'repeated_page/digital': [4, 2, 1],
    'repeated_page/scanned': [8, 4, 1],
    'multi_invoice/digital': [3, 1, 1],
    'multi_invoice/scanned': [2, 1, 1],
    'packet/scanned': [4, 2, 1],
    'partial_credit/digital': [2, 1, 0],
    'partial_credit/scanned': [1, 0, 0],
    'credit_memo/digital': [1, 1, 0],
    'credit_memo/scanned': [1, 0, 0],
    'revised_invoice/digital': [2, 1, 0],
    'revised_invoice/scanned': [1, 0, 0],
    'tricky_number/digital': [2, 1, 1],
    'tricky_number/scanned': [2, 1, 0],
    'handwritten/scanned': [2, 1, 1],
    'upside_down/scanned': [2, 1, 0],
    'missing_pro/digital': [1, 1, 0],
    'missing_pro/scanned': [1, 0, 1],
    'non_usd/digital': [2, 1, 1],
  });
  const ci = plans.filter(({ case: golden }) => golden.ci);
  expect(ci.every(({ case: golden }) => golden.split === 'test')).toBe(true);
  expect(ci.filter(({ case: golden }) => golden.path === 'digital')).toHaveLength(11);
  expect(ci.flatMap(({ case: golden }) => golden.invoices).filter((invoice) => invoice.expected.overcharges.length > 0)).toHaveLength(6);
  expect(plans.map(({ case: golden }) => golden.id)).toEqual(Array.from({ length: 98 }, (_, i) => `g2-${String(i + 1).padStart(3, '0')}`));
  expect(plans.filter(({ case: golden }) => golden.adversarial)).toHaveLength(37);
});

test('every kind has dev cases to tune on and test cases held out', () => {
  const splits = new Map<string, Set<string>>();
  for (const { case: golden } of plans) splits.set(golden.kind, (splits.get(golden.kind) ?? new Set()).add(golden.split));
  expect([...splits].filter(([, seen]) => seen.size < 2).map(([kind]) => kind)).toEqual([]);
});

test('no shipment is billed twice, none is one golden v1 or comparison v1 bills, and every printed invoice number is unique', () => {
  const shipments = plans.flatMap(({ case: golden }) => golden.shipments);
  expect(new Set(shipments).size).toBe(shipments.length);
  expect(shipments.filter((pro) => taken.has(pro))).toEqual([]);
  expect(taken.size).toBeGreaterThan(100);
  const numbers = plans.flatMap(({ case: golden }) => golden.invoices.flatMap((invoice) => [invoice.invoice_number, ...(invoice.revised_from ? [invoice.revised_from] : [])]));
  expect(new Set(numbers).size).toBe(numbers.length);
});

test('every digital case has a title line beside the carrier, and every scan one v2 noise profile', () => {
  for (const { case: golden } of plans) {
    if (golden.path === 'digital') expect({ id: golden.id, title: golden.traits.includes('title_line') }).toEqual({ id: golden.id, title: true });
    else expect({ id: golden.id, profiles: golden.traits.filter((trait) => (PROFILES as readonly string[]).includes(trait)).length }).toEqual({ id: golden.id, profiles: 1 });
  }
  expect(plans.filter(({ case: golden }) => golden.split === 'dev' && golden.path === 'digital' && golden.traits.includes('title_line'))).toHaveLength(17);
});

test('each kind ends as planned', () => {
  for (const { case: golden, pages } of plans) {
    const marks = pages.flatMap((page) => page.overlays.map((overlay) => overlay.mark));
    for (const invoice of golden.invoices) {
      const sum = invoice.line_items.reduce((total, line) => total + line.amount_cents, 0);
      expect({ id: golden.id, sum }).toEqual({ id: golden.id, sum: invoice.total_cents });
      if (golden.kind === 'missing_pro') expect(invoice).toMatchObject({ pro_number: null, expected: { status: 'needs_review', reason: 'no_shipment_match', overcharges: [] } });
      else if (golden.kind === 'non_usd') expect(invoice.expected).toEqual({ status: 'needs_review', reason: `unsupported_currency: ${invoice.currency}`, overcharges: [] });
      else expect(invoice.expected).toEqual({ status: 'reconciled', overcharges: invoice.overcharges });
    }
    const [first] = golden.invoices;
    const one = golden.invoices.length === 1;
    switch (golden.kind) {
      case 'overcharge':
        expect(first!.overcharges).toHaveLength(1);
        break;
      case 'duplicate_invoice':
        expect(first!.overcharges.map((over) => [over.type, over.line_number])).toEqual(first!.line_items.map((line) => ['duplicate_charge', line.line_number]));
        break;
      case 'credit_memo':
        expect(first).toMatchObject({ kind: 'credit_memo', overcharges: [] });
        expect(first!.line_items.every((line) => line.amount_cents < 0)).toBe(true);
        break;
      case 'partial_credit': {
        const credit = first!.line_items.at(-1)!;
        expect(credit.amount_cents).toBeLessThan(0);
        expect(first!.line_items.slice(0, -1).some((line) => line.charge_code === credit.charge_code && line.amount_cents > -credit.amount_cents)).toBe(true);
        expect(first!.overcharges).toEqual([]);
        break;
      }
      case 'repeated_page':
        expect({ one, more: golden.pages > 1 }).toEqual({ one: true, more: true });
        break;
      case 'packet':
        expect({ one, pages: golden.pages >= 3 && golden.pages <= 8 }).toEqual({ one: true, pages: true });
        break;
      case 'multi_invoice':
        expect(golden.invoices.length).toBeGreaterThanOrEqual(2);
        expect(new Set(golden.invoices.map((invoice) => invoice.carrier)).size).toBe(golden.invoices.length);
        expect(golden.invoices.map((invoice) => invoice.first_page)).toEqual([...golden.invoices.map((invoice) => invoice.first_page)].sort((a, b) => a - b));
        break;
      case 'revised_invoice':
        expect(first!.revised_from).toMatch(/^\d{8}$/);
        expect(marks).toContain('revised');
        break;
      case 'tricky_number':
        expect(first!.invoice_number).toMatch(/^0|-|(\d)\1{4}/);
        break;
      case 'handwritten':
        expect(marks).toContain('note');
        break;
      case 'upside_down':
        expect(pages.some((page) => page.scan?.flip)).toBe(true);
        break;
    }
    if (golden.kind !== 'multi_invoice') expect({ id: golden.id, one }).toEqual({ id: golden.id, one: true });
  }
});

test('tilt, stamps and fax headers stay in their ranges, and no stamp or fax date is a date the invoice prints', () => {
  for (const { case: golden, pages } of plans) {
    // Every date the case prints: invoice and due dates, the early-payment date, ship and delivery dates.
    const printed = golden.invoices.flatMap((invoice) => [invoice.invoice_date, invoice.due_date, day(invoice.invoice_date, 10), invoice.refs?.shipped_on, invoice.refs?.delivered_on]);
    for (const page of pages) {
      const scan = page.scan;
      if (scan) {
        const tilt = Math.abs(scan.degrees);
        expect({ id: golden.id, ok: scan.profile === 'skew' ? tilt >= 3 && tilt <= 6 : tilt <= 1.5 }).toEqual({ id: golden.id, ok: true });
        expect({ id: golden.id, flip: scan.flip }).toEqual({ id: golden.id, flip: golden.kind === 'upside_down' && page === pages[0] });
        expect(scan.sideways).toBe('layout' in page.source && page.source.layout === 'landscape');
      }
      // A stamp dates from its page's invoice; a fax header, sent once for the document, from the first.
      const owner = golden.invoices['invoice' in page.source && page.source.invoice !== undefined ? page.source.invoice : 0]!;
      for (const overlay of page.overlays) {
        if (overlay.mark !== 'stamp' && overlay.mark !== 'fax') continue;
        const after = daysBetween((overlay.mark === 'stamp' ? owner : golden.invoices[0]!).invoice_date, overlay.date);
        expect({ id: golden.id, ok: overlay.mark === 'stamp' ? after >= 3 && after <= 9 : after >= 1 && after <= 9 }).toEqual({ id: golden.id, ok: true });
        expect({ id: golden.id, printed: printed.includes(overlay.date) }).toEqual({ id: golden.id, printed: false });
      }
    }
    expect(golden.scans).toEqual(pages.map((page) => page.scan));
    expect(golden.pages).toBe(pages.length);
  }
});

test('the same seed plans the same set', () => {
  expect(planV2(seeded, taken)).toEqual(plans);
});
