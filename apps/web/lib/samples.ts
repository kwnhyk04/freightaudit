// Golden-set PDFs a visitor can try on the upload page, served from public/samples/. pnpm db:reset-demo loads none of
// them, so each runs through the pipeline fresh; the public demo's api accepts only golden-set files.
export const SAMPLES = [
  { file: 'clean-digital-g001.pdf', label: 'Clean digital invoice', note: 'Every line matches the contract.' },
  {
    file: 'scanned-uncontracted-g067.pdf',
    label: 'Scanned invoice with an overcharge',
    note: 'Read from the page image; it bills a charge the contract does not include.',
  },
  {
    file: 'duplicate-invoice-g071.pdf',
    label: 'Duplicate invoice',
    note: 'Bills a shipment the demo already holds an invoice for, so every line is flagged as a duplicate charge.',
  },
] as const;

// Where the rest of the golden set lives.
export const GOLDEN_SET_URL = 'https://github.com/kwnhyk04/freightaudit/tree/main/evals/golden/v1/cases';
