import { readFile } from 'node:fs/promises';
import { collectEvidence, EVIDENCE_FILE } from './evidence.ts';

// The landing page's figures must be the sources' figures: rerun `pnpm --filter @freightaudit/web evidence` when this fails.
test('lib/evidence.json matches the load test, the golden manifest and the property-based tests', async () => {
  expect(JSON.parse(await readFile(EVIDENCE_FILE, 'utf8'))).toEqual(await collectEvidence());
});
