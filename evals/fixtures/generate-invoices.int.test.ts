import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInvoices } from './generate-invoices.ts';

// SHA-256 of every file in a directory, keyed by file name.
async function digests(dir: string) {
  const names = (await readdir(dir)).sort();
  const hashes = await Promise.all(names.map(async (name) => createHash('sha256').update(await readFile(join(dir, name))).digest('hex')));
  return Object.fromEntries(names.map((name, i) => [name, hashes[i]]));
}

test('the same seed renders byte-identical PDFs, scans and ground truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'freightaudit-fixtures-'));
  try {
    // Two separate runs, each with its own browser, one per template; the second renders seconds later than the first.
    await generateInvoices({ count: 6, out: join(root, 'first') });
    await generateInvoices({ count: 6, out: join(root, 'second') });
    const first = await digests(join(root, 'first'));
    expect(Object.keys(first)).toHaveLength(24);
    expect(await digests(join(root, 'second'))).toEqual(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
