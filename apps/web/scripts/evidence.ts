// The landing page's engineering evidence, copied from the files that hold it into lib/evidence.json, so the web reads
// only its own files (the Docker build sees no loadtest/, evals/golden/ or test files). Run: pnpm --filter @freightaudit/web evidence
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ROOT = new URL('../../../', import.meta.url);
export const EVIDENCE_FILE = new URL('apps/web/lib/evidence.json', ROOT);

// The figures as they stand in their sources; evidence.test.ts fails when lib/evidence.json no longer matches them.
export async function collectEvidence(root = ROOT) {
  const json = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const load = await json('loadtest/system-results.json');
  const manifest: { cases: { ci?: boolean }[] } = await json('evals/golden/v2/manifest.json');
  // Every domain test that sets fast-check's global run count, and that count; the page names one count only if all agree.
  const domain = new URL('packages/domain/src/', root);
  const runs: number[] = [];
  for (const file of (await readdir(domain)).filter((name) => name.endsWith('.test.ts')).sort()) {
    const match = /numRuns:\s*([\d_]+)/.exec(await readFile(new URL(file, domain), 'utf8'));
    if (match) runs.push(Number(match[1]!.replaceAll('_', '')));
  }
  if (runs.length === 0 || new Set(runs).size !== 1) throw new Error(`property-based tests disagree on numRuns: ${runs.join(', ')}`);
  return {
    load: {
      date: load.date as string,
      accepted: load.accepted as number,
      lost: load.lost as number,
      normalPerHour: load.normal_per_hour as number,
      offeredPerHour: load.offered_per_hour as number,
      uploadP95Ms: load.upload_ms.p95 as number,
    },
    evals: { ci: manifest.cases.filter((each) => each.ci).length, cases: manifest.cases.length },
    propertyTests: { files: runs.length, runs: runs[0]! },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const evidence = await collectEvidence();
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(evidence);
}
