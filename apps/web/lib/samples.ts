// Golden-set PDFs a reviewer uploads in one tap on the upload page, read from public/samples/. pnpm db:reset-demo loads
// none of them, so each runs through the pipeline fresh; the public demo's api accepts only golden-set files.
export const SAMPLES = [
  {
    key: 'g001',
    file: 'clean-digital-g001.pdf',
    label: 'Clean digital invoice',
    note: 'Every line matches the rate card, so it reconciles with no findings and waits only for approval.',
  },
  {
    key: 'g067',
    file: 'scanned-uncontracted-g067.pdf',
    label: 'Scanned invoice with an overcharge',
    note: "Read from the page image; it bills residential delivery, which isn't on the rate card.",
  },
  {
    key: 'g062',
    file: 'duplicate-fuel-g062.pdf',
    label: 'Fuel surcharge billed twice',
    note: 'The same charge appears on two lines of one invoice.',
  },
] as const;

// Where the rest of the golden set lives.
export const GOLDEN_SET_URL = 'https://github.com/kwnhyk04/freightaudit/tree/main/evals/golden/v1/cases';
